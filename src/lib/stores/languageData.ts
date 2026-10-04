import { get, writable } from 'svelte/store';
import {
	defaultVoiceOf,
	getVoice,
	requireLanguage,
	type LanguageDefinition,
	type LanguageVoice
} from '#lib/languages/index.js';
import {
	cancelLocalSttPrepare,
	missingLocalSttBytes,
	prepareLocalStt
} from '#lib/speech/stt/service.js';
import { cancelLocalVoiceDownload, preloadLocalVoice } from '#lib/speech/tts/service.js';
import { isCached } from '#lib/speech/tts/piper/cachedFetch.js';
import { voiceAssets } from '#lib/speech/tts/piper/assets.js';
import { appSettings } from './settings';

export type LanguageDataStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

export interface LanguageDataState {
	languageId: string;
	status: LanguageDataStatus;
	/** Combined 0–100 progress across STT weights and the selected voice. */
	progress: number;
	statusText: string;
	error: string | null;
	/**
	 * Bytes still to download, per part, from the last cache check (`null`
	 * until checked). Languages share assets — every language uses the same
	 * Whisper weights — so this is usually far less than the full size.
	 */
	pending: PendingBytes | null;
}

export interface PendingBytes {
	/** Whisper weights; 0 when another language already downloaded them. */
	stt: number;
	/** The voice and, for Japanese, its dictionary (only the missing parts). */
	voice: number;
	/** Extra storage the missing parts will take on this device. */
	storage: number;
	/** What downloading the missing parts costs over the network. */
	transfer: number;
}


const initial: LanguageDataState = {
	languageId: '',
	status: 'checking',
	progress: 0,
	statusText: '',
	error: null,
	pending: null
};

const store = writable<LanguageDataState>({ ...initial });
export const languageData = { subscribe: store.subscribe };

let checkToken = 0;
let jobToken = 0;
let running: Promise<void> | null = null;
/** Which part of the running download is in flight; Cancel tears down only that worker. */
let phase: 'stt' | 'voice' | null = null;

/**
 * Chosen voice for a language: the user's saved voice when it belongs to that
 * language, otherwise the registry default (which is the listening-test winner).
 */
function preferredVoice(language: LanguageDefinition): LanguageVoice | undefined {
	return getVoice(language.id, get(appSettings).ttsVoice) ?? defaultVoiceOf(language);
}

/** The voice's downloads that are not cached yet (a Japanese voice also needs its dictionary). */
async function missingVoice(voice: LanguageVoice | undefined): Promise<{ bytes: number; transfer: number }> {
	if (!voice) return { bytes: Number.POSITIVE_INFINITY, transfer: Number.POSITIVE_INFINITY };
	const assets = voiceAssets(voice);
	const cached = await Promise.all(assets.map((asset) => isCached(asset.url)));
	return assets.reduce(
		(sum, asset, index) =>
			cached[index] ? sum : { bytes: sum.bytes + asset.bytes, transfer: sum.transfer + asset.transferBytes },
		{ bytes: 0, transfer: 0 }
	);
}

/** What is still missing for a language, per part. */
async function pendingBytes(language: LanguageDefinition): Promise<PendingBytes> {
	const [stt, voice] = await Promise.all([
		missingLocalSttBytes(language.id),
		missingVoice(preferredVoice(language))
	]);
	return { stt, voice: voice.bytes, storage: stt + voice.bytes, transfer: stt + voice.transfer };
}

/** Re-reads the cache state for a language and updates the store. */
export async function refreshLanguageData(
	languageId: string = get(appSettings).targetLanguage
): Promise<void> {
	// A running download owns the store and re-checks the current selection when it ends;
	// a check now would flip a live download back to "missing".
	if (running) return;
	const language = languageId ? requireLanguage(languageId) : undefined;
	if (!language) {
		store.set({ ...initial, status: 'missing' });
		return;
	}

	const token = ++checkToken;
	store.update((state) => ({
		...state,
		languageId: language.id,
		status: 'checking',
		progress: 0,
		statusText: 'Checking installed language data…',
		error: null
	}));

	const pending = await pendingBytes(language);
	if (token !== checkToken) return;

	const ready = pending.stt === 0 && pending.voice === 0;
	store.update((state) => ({
		...state,
		status: ready ? 'ready' : 'missing',
		progress: ready ? 100 : 0,
		statusText: ready ? 'Language data installed.' : '',
		error: null,
		pending
	}));
}

export function isLanguageDataReady(): boolean {
	return get(store).status === 'ready';
}

/**
 * Downloads and initializes the approved STT weights and TTS voice for a
 * language, reporting one combined progress figure. In-flight work is shared:
 * a second call while downloading returns the same promise.
 */
export function downloadLanguageData(languageId?: string): Promise<void> {
	if (running) return running;
	const language = requireLanguage(languageId ?? get(appSettings).targetLanguage);
	const voice = preferredVoice(language);
	if (!voice) {
		// Callers fire and forget (`void download…`); report in the store, never throw.
		store.update((state) => ({
			...state,
			languageId: language.id,
			status: 'error',
			error: `No approved voice for ${language.name}.`
		}));
		return Promise.resolve();
	}

	const token = ++jobToken;
	const known = get(store);
	store.set({
		languageId: language.id,
		status: 'downloading',
		progress: 0,
		statusText: `Preparing ${language.name} data…`,
		error: null,
		pending: known.languageId === language.id ? known.pending : null
	});

	running = (async () => {
		try {
			// Weight the bar by what is actually missing: when the Whisper weights
			// are already cached (another language uses the same ones), loading
			// them takes seconds and the voice is nearly the whole download.
			const pending = await pendingBytes(language);
			if (token !== jobToken) return;
			const missing = pending.stt + pending.voice;
			const sttShare = missing > 0 ? (pending.stt / missing) * 100 : 50;
			const voiceShare = 100 - sttShare;
			phase = 'stt';
			await prepareLocalStt(language.id, (progress) => {
				if (token !== jobToken) return;
				store.update((state) => ({
					...state,
					progress: (progress.progress / 100) * sttShare,
					statusText: progress.status || `Downloading ${language.name} speech model…`
				}));
			});
			if (token !== jobToken) return;
			phase = 'voice';
			await preloadLocalVoice(voice.id, (progress) => {
				if (token !== jobToken) return;
				store.update((state) => ({
					...state,
					progress: sttShare + (progress.progress / 100) * voiceShare,
					statusText: progress.status || `Downloading ${language.name} voice…`
				}));
			});
			if (token !== jobToken) return;
			running = null;
			phase = null;
			await refreshLanguageData();
		} catch (error) {
			if (token !== jobToken) return;
			store.update((state) => ({
				...state,
				status: 'error',
				statusText: '',
				error: error instanceof Error ? error.message : 'Language data download failed.'
			}));
		} finally {
			if (token === jobToken) {
				running = null;
				phase = null;
			}
		}
	})();

	return running;
}

/** Aborts an in-flight download by terminating the workers fetching the bytes. */
export function cancelLanguageDownload(): void {
	if (!running) return;
	const cancelling = phase;
	jobToken++;
	running = null;
	phase = null;
	// Only the worker still fetching is torn down. Once the speech model has
	// loaded it may already be transcribing a take; killing it would fail that
	// take with a raw "STT worker disposed." error.
	if (cancelling === 'stt') cancelLocalSttPrepare();
	else if (cancelling === 'voice') cancelLocalVoiceDownload();
	store.update((state) => ({
		...state,
		status: 'missing',
		progress: 0,
		statusText: '',
		error: null
	}));
	// Part of the data (e.g. the speech model) may have finished; size what is left.
	void refreshLanguageData();
}

/**
 * Re-checks the cache whenever the studied language or chosen voice changes, so
 * the installed/missing status follows Settings from anywhere in the app.
 */
let knownSelection = '';
appSettings.subscribe((settings) => {
	const selection = `${settings.targetLanguage}:${settings.ttsVoice}`;
	if (selection === knownSelection) return;
	knownSelection = selection;
	if (settings.targetLanguage) void refreshLanguageData(settings.targetLanguage);
});
