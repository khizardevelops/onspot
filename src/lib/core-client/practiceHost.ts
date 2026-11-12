// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver side of `practice.*` host requests (P3).
 *
 * The Rust core owns the practice state machine. Microphone capture, speech
 * engines and the legacy LLM evaluation stay in the webview on both runtimes,
 * so the core sends one request event and this module performs it, using the
 * same adapters the legacy practice store uses.
 */

import { get } from 'svelte/store';
import { evaluateAttempt } from '#lib/adapters/llm/index.js';
import { generatePromptTopic } from '#lib/adapters/llm/promptTopic.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	getInstructionLanguage,
	requireLanguage
} from '#lib/languages/index.js';
import { transcribeSpeech } from '#lib/speech/stt/service.js';
import { VoiceRecorder } from '#lib/utils/recorder.js';
import { isTauri } from '#lib/platform/runtime.js';
import { readSecret } from './secrets.js';
import { appSettings } from '#lib/stores/settings.js';
import { groqApiKey } from '#lib/stores/secrets.js';
import { llmConfigured, resolveLlmEndpoint } from '#lib/stores/llm.js';
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

/** The methods the core may call while a take runs. */
export interface PracticeHost {
	handle(method: string, payload: unknown): Promise<unknown>;
	cancel(): void;
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
export function createPracticeHost(client: CoreClient): PracticeHost {
	let recorder: VoiceRecorder | null = null;
	let lastFrame: HostAudioFrame | null = null;

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
				case 'evaluation.evaluate': {
					const request = payload as {
						transcript: string;
						prompt: string;
						mode: 'exam' | 'casual' | 'freeflow';
						level: string;
						language: string;
						translationTarget: string;
					};
					const settings = get(appSettings);
					try {
						return await evaluateAttempt({
							...request,
							endpoint: resolveLlmEndpoint(settings)
						});
					} catch (error) {
						throw hostError('practice.evaluation_failed', error);
					}
				}
				case 'http.request': {
					const request = payload as {
						method: string;
						url: string;
						headers: Record<string, string>;
						body: string;
						provider?: string | null;
					};
					const headers = { ...request.headers };
					if (request.provider) {
						const key = readSecret(`llm.${request.provider}` as never);
						if (key) headers.Authorization = `Bearer ${key}`;
					}
					const requestFetch = isTauri()
						? (await import('@tauri-apps/plugin-http')).fetch
						: fetch;
					const response = await requestFetch(request.url, {
						method: request.method,
						headers,
						body: request.body
					});
					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.text()
					};
				}
				case 'prompt.write': {
					if (!get(llmConfigured)) return null;
					const request = payload as {
						targetLanguageId: string;
						instructionLanguageId: string;
						level: string;
						mode: 'exam' | 'casual' | 'freeflow';
						avoidTopics: string[];
					};
					const settings = get(appSettings);
					try {
						return await generatePromptTopic({
							endpoint: resolveLlmEndpoint(settings),
							instructionLanguage: getInstructionLanguage(
								request.instructionLanguageId
							).name,
							instructionLanguageId:
								request.instructionLanguageId ?? DEFAULT_INSTRUCTION_LANGUAGE_ID,
							targetLanguage: requireLanguage(request.targetLanguageId).name,
							level: request.level,
							mode: request.mode,
							avoidTopics: request.avoidTopics
						});
					} catch {
						// The core falls back to stored/catalogue prompts; the learner is not
						// interrupted with a second failure while nothing was typed.
						return null;
					}
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
