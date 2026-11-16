// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver side of the core's host requests.
 *
 * The Rust core owns the state machines and the backup format. Microphone
 * capture, speech engines, the legacy LLM evaluation, the file dialogs and the
 * database engine stay in the webview on both runtimes, so the core sends one
 * request event and this module performs it with the same adapters the legacy
 * stores use.
 */

import { get } from 'svelte/store';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import { transcribeSpeech } from '#lib/speech/stt/service.js';
import { VoiceRecorder } from '#lib/utils/recorder.js';
import { isTauri } from '#lib/platform/runtime.js';
import { fetchWithTimeout } from '#lib/platform/fetchWithTimeout.js';
import { readLlmKey, SECRET_PREFIX, type LlmKeySlot } from './secrets.js';
import { appSettings } from '#lib/stores/settings.js';
import { groqApiKey } from '#lib/stores/secrets.js';
import type { CoreClient } from './transport.js';

/** One captured take, in the shape the core's `AudioFrame` expects. */
interface HostAudioFrame {
	pcm: number[];
	sampleRate: number;
	blob: { mime: string; bytes: number[] };
	durationSec: number;
}

interface HostAudioBlob {
	mime: string;
	bytes: number[];
}

/** A host request as the transport delivers it. */
export interface HostRequestEvent {
	id: number;
	method: string;
	payload: string;
}

/** The methods the core may call while a take runs or a backup moves. */
export interface CoreHost {
	handle(method: string, payload: unknown): Promise<unknown>;
	cancel(): void;
}

const SQLITE_MIME = 'application/vnd.sqlite3';
const SQLITE_EXTENSIONS = ['.sqlite'];
const SQLITE_MIME_TYPES = [SQLITE_MIME, 'application/x-sqlite3', 'application/octet-stream'];
const TAURI_SQLITE_FILTERS = [{ name: 'SQLite database', extensions: ['sqlite'] }];
const BROWSER_SQLITE_FILTERS = {
	extensions: SQLITE_EXTENSIONS,
	mimeTypes: SQLITE_MIME_TYPES,
	description: 'SQLite database'
};

/** Device values the core keeps (the usage ledger) share the app's storage prefix. */
const DEVICE_PREFIX = 'onspot.';

/**
 * Guards the core's device store: only onspot's own keys, and never a key
 * slot, so a device value can never overwrite or read an API key.
 */
function deviceKey(key: string): string {
	if (!key.startsWith(DEVICE_PREFIX) || key.startsWith(SECRET_PREFIX)) {
		throw Object.assign(new Error(`The core may not use the storage key "${key}".`), {
			code: 'core.device_key_refused'
		});
	}
	return key;
}

function readDeviceValue(key: string): string | null {
	try {
		return localStorage.getItem(deviceKey(key));
	} catch (error) {
		if ((error as { code?: unknown }).code) throw error;
		// Private mode or blocked storage: the core starts from nothing.
		return null;
	}
}

function writeDeviceValue(key: string, value: string): void {
	try {
		localStorage.setItem(deviceKey(key), value);
	} catch (error) {
		if ((error as { code?: unknown }).code) throw error;
		throw Object.assign(new Error('This browser did not keep the usage record (storage full or blocked).'), {
			code: 'core.device_storage_failed'
		});
	}
}

/** Base64 for bytes that cross the JSON bridge (backups can be large). */
function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** The learner's file dialogs on both runtimes. */
async function saveFile(fileName: string, bytes: Uint8Array): Promise<boolean> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const path = await save({ defaultPath: fileName, filters: TAURI_SQLITE_FILTERS });
		if (!path) return false;
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		await writeFile(path, bytes);
		return true;
	}

	const { fileSave } = await import('browser-fs-access');
	try {
		await fileSave(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: SQLITE_MIME }), {
			fileName,
			...BROWSER_SQLITE_FILTERS
		});
		return true;
	} catch (error) {
		if (isAbort(error)) return false;
		throw error;
	}
}

async function pickFile(): Promise<{ fileName: string; bytesBase64: string } | null> {
	if (isTauri()) {
		const { open } = await import('@tauri-apps/plugin-dialog');
		const selection = await open({
			multiple: false,
			directory: false,
			filters: TAURI_SQLITE_FILTERS
		});
		if (!selection || Array.isArray(selection)) return null;
		const { readFile } = await import('@tauri-apps/plugin-fs');
		const bytes = await readFile(selection);
		const fileName = selection.split(/[\\/]/).pop() ?? 'onspot-backup.sqlite';
		return { fileName, bytesBase64: encodeBase64(bytes) };
	}

	const { fileOpen } = await import('browser-fs-access');
	try {
		const file = await fileOpen({ multiple: false, ...BROWSER_SQLITE_FILTERS });
		if (!file) return null;
		const bytes = new Uint8Array(await file.arrayBuffer());
		return { fileName: file.name, bytesBase64: encodeBase64(bytes) };
	} catch (error) {
		if (isAbort(error)) return null;
		throw error;
	}
}

/** Errors cross the host boundary with the stable code the core records. */
function hostError(code: string, error: unknown): Error & { code: string } {
	const message = error instanceof Error ? error.message : String(error);
	return Object.assign(new Error(message), { code });
}

function audioBlob(handle: HostAudioBlob): Blob {
	return new Blob([new Uint8Array(handle.bytes)], { type: handle.mime });
}

function frameOf(recording: {
	pcm: Float32Array;
	blob: Blob;
	durationSec: number;
}): HostAudioFrame {
	return {
		pcm: Array.from(recording.pcm),
		sampleRate: 16_000,
		blob: {
			mime: recording.blob.type || 'audio/webm',
			bytes: []
		},
		durationSec: recording.durationSec
	};
}

/**
 * Creates the practice host over the page's existing speech and LLM adapters.
 *
 * @param client The bridge client, used for progress and level commands.
 * @returns The handler and a cancel that discards an in-flight microphone take.
 */
export function createCoreHost(client: CoreClient): CoreHost {
	let recorder: VoiceRecorder | null = null;
	let lastFrame: HostAudioFrame | null = null;
	/** Tears down whichever language-data worker is currently fetching. */
	let cancelLanguageFetch: (() => void) | null = null;

	return {
		cancel() {
			recorder?.cancel();
			recorder = null;
		},
		async handle(method: string, payload: unknown): Promise<unknown> {
			switch (method) {
				case 'capture.start': {
					const next = new VoiceRecorder();
					next.onLevel = (level) => {
						void client
							.command('practice.audio_level', { level })
							.catch(() => undefined);
					};
					try {
						await next.start();
					} catch (error) {
						throw hostError('practice.microphone_unavailable', error);
					}
					recorder = next;
					return {};
				}
				case 'capture.stop': {
					const active = recorder;
					recorder = null;
					if (!active) throw hostError('practice.recording_failed', 'No recording was in progress.');
					try {
						const recording = await active.stop();
						const frame = frameOf(recording);
						// The compressed take is read as bytes for storage; the PCM is already
						// the recognizer's input.
						frame.blob.bytes = Array.from(new Uint8Array(await recording.blob.arrayBuffer()));
						URL.revokeObjectURL(recording.url);
						lastFrame = frame;
						return frame;
					} catch (error) {
						throw hostError('practice.recording_failed', error);
					}
				}
				case 'capture.cancel': {
					recorder?.cancel();
					recorder = null;
					lastFrame = null;
					return {};
				}
				case 'stt.transcribe': {
					const request = payload as { options: { languageId: string } };
					const frame = lastFrame;
					if (!frame) throw hostError('practice.transcription_failed', 'No take was captured.');
					const settings = get(appSettings);
					try {
						const text = await transcribeSpeech({
							audio16kMono: Float32Array.from(frame.pcm),
							recording: audioBlob(frame.blob),
							mode: settings.sttMode,
							languageId: request.options.languageId,
							groqApiKey: get(groqApiKey) || undefined,
							onProgress: (progress) => {
								void client
									.command('practice.stt_progress', { progress })
									.catch(() => undefined);
							}
						});
						return { text };
					} catch (error) {
						throw hostError('practice.transcription_failed', error);
					}
				}
				case 'fs.save': {
					const request = payload as { fileName: string; bytesBase64: string };
					try {
						return { saved: await saveFile(request.fileName, decodeBase64(request.bytesBase64)) };
					} catch (error) {
						throw hostError('export.failed', error);
					}
				}
				case 'fs.pick': {
					try {
						return { file: await pickFile() };
					} catch (error) {
						throw hostError('restore.failed', error);
					}
				}
				case 'db.export_bytes': {
					try {
						const database = await getDatabaseAdapter();
						const bytes = await database.exportSqliteFile();
						return { bytesBase64: encodeBase64(bytes) };
					} catch (error) {
						throw hostError('storage.export_failed', error);
					}
				}
				case 'db.import_bytes': {
					const request = payload as { bytesBase64: string };
					try {
						// Dynamic import: `utils/export.ts` imports the practice store,
						// which imports this module; a static edge would be a cycle.
						const { restoreSqliteBytes } = await import('#lib/utils/export.js');
						const result = await restoreSqliteBytes(decodeBase64(request.bytesBase64));
						return { sessions: result.sessions, attempts: result.attempts };
					} catch (error) {
						throw hostError('storage.restore_failed', error);
					}
				}
				case 'language.download_stt': {
					const request = payload as { languageId: string };
					const { prepareLocalStt, cancelLocalSttPrepare } = await import(
						'#lib/speech/stt/service.js'
					);
					cancelLanguageFetch = () => cancelLocalSttPrepare();
					try {
						await prepareLocalStt(request.languageId, (progress) => {
							void client
								.command('language.download_progress', { progress })
								.catch(() => undefined);
						});
						return {};
					} catch (error) {
						throw hostError('language.download_failed', error);
					} finally {
						cancelLanguageFetch = null;
					}
				}
				case 'language.download_voice': {
					const request = payload as { voiceId: string };
					const { preloadLocalVoice, cancelLocalVoiceDownload } = await import(
						'#lib/speech/tts/service.js'
					);
					cancelLanguageFetch = () => cancelLocalVoiceDownload();
					try {
						await preloadLocalVoice(request.voiceId, (progress) => {
							void client
								.command('language.download_progress', { progress })
								.catch(() => undefined);
						});
						return {};
					} catch (error) {
						throw hostError('language.download_failed', error);
					} finally {
						cancelLanguageFetch = null;
					}
				}
				case 'language.cancel': {
					cancelLanguageFetch?.();
					cancelLanguageFetch = null;
					return {};
				}
				case 'http.request': {
					const request = payload as {
						method: string;
						url: string;
						headers: Record<string, string>;
						body: string;
						provider?: LlmKeySlot | null;
						timeoutMs?: number;
					};
					const headers = { ...request.headers };
					if (request.provider) {
						const key = readLlmKey(request.provider);
						if (key) headers.Authorization = `Bearer ${key}`;
					}
					const response = await fetchWithTimeout(
						request.url,
						{
							method: request.method,
							headers,
							// A GET (the model list) must not carry a body, even an empty one.
							body: request.method === 'GET' ? undefined : request.body
						},
						{ timeoutMs: request.timeoutMs }
					);
					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.text()
					};
				}
				case 'device.read': {
					const { key } = payload as { key: string };
					return { value: readDeviceValue(key) };
				}
				case 'device.write': {
					const { key, value } = payload as { key: string; value: string };
					writeDeviceValue(key, value);
					return {};
				}
				case 'http.sync': {
					const request = payload as {
						method: string;
						url: string;
						headers: Record<string, string>;
						bodyBase64: string;
					};
					const requestFetch = isTauri()
						? (await import('@tauri-apps/plugin-http')).fetch
						: fetch;
					const response = await requestFetch(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.bodyBase64
							? (decodeBase64(request.bodyBase64) as Uint8Array<ArrayBuffer>)
							: undefined
					});
					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						bodyBase64: encodeBase64(new Uint8Array(await response.arrayBuffer()))
					};
				}
				case 'oauth.access_token': {
					const request = payload as { forceRefresh?: boolean };
					const { googleAccessToken } = await import('#lib/adapters/sync/google/oauth.js');
					return { accessToken: await googleAccessToken(request.forceRefresh ?? false) };
				}
				case 'oauth.connect': {
					const { connectGoogleDrive } = await import('#lib/adapters/sync/google/oauth.js');
					const account = await connectGoogleDrive();
					return { label: account.label };
				}
				case 'oauth.account': {
					const { googleAccount } = await import('#lib/adapters/sync/google/oauth.js');
					return { label: googleAccount()?.label ?? null };
				}
				case 'oauth.disconnect': {
					const { disconnectGoogleDrive } = await import('#lib/adapters/sync/google/oauth.js');
					disconnectGoogleDrive();
					return {};
				}
				default:
					throw hostError(
						'core.host_unsupported',
						`The practice driver does not implement ${method}.`
					);
			}
		}
	};
}
