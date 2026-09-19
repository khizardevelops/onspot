import { get, writable } from 'svelte/store';
import {
	getVoice,
	languageDownloadBytes,
	requireLanguage,
	type LanguageDefinition,
	type LanguageVoice
} from '$lib/languages';
import { cancelLocalSTTDownload, preloadLocalSTT } from '$lib/adapters/stt/service';
import { cancelLocalVoiceDownload, preloadLocalVoice } from '$lib/adapters/tts/service';
import { isCached } from '$lib/adapters/tts/cachedFetch';
import { appSettings } from './settings';

export type LanguageDataStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

export interface LanguageDataState {
	languageId: string;
	status: LanguageDataStatus;
	/** Combined 0–100 progress across STT weights and the selected voice. */
	progress: number;
	statusText: string;
	error: string | null;
}

const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

const initial: LanguageDataState = {
	languageId: '',
	status: 'checking',
	progress: 0,
	statusText: '',
	error: null
};

const store = writable<LanguageDataState>({ ...initial });
export const languageData = { subscribe: store.subscribe };

let checkToken = 0;
let jobToken = 0;
let running: Promise<void> | null = null;

/**
 * Chosen voice for a language: the user's saved voice when it belongs to that
 * language, otherwise the registry default (which is the listening-test winner).
 */
function preferredVoice(language: LanguageDefinition): LanguageVoice | undefined {
	return getVoice(language.id, get(appSettings).ttsVoice) ?? getVoice(language.id, language.defaultVoice) ?? language.voices[0];
}

/** The browser Cache API is per-origin; a cold cache means the data is absent. */
async function hasSttWeights(language: LanguageDefinition): Promise<boolean> {
	try {
		const cache = await caches.open('transformers-cache');
		const requests = await cache.keys();
		return requests.some((request) => request.url.includes(language.stt.modelRepoId));
	} catch {
		return false;
	}
}

async function hasVoiceWeights(voice: LanguageVoice | undefined): Promise<boolean> {
	if (!voice) return false;
	return isCached(`${VOICES_BASE}${voice.voicePath}`);
}

/** Re-reads the cache state for a language and updates the store. */
export async function refreshLanguageData(
	languageId: string = get(appSettings).targetLanguage
): Promise<void> {
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

	const [sttReady, voiceReady] = await Promise.all([
		hasSttWeights(language),
		hasVoiceWeights(preferredVoice(language))
	]);
	if (token !== checkToken) return;

	const ready = sttReady && voiceReady;
	store.update((state) => ({
		...state,
		status: ready ? 'ready' : 'missing',
		progress: ready ? 100 : 0,
		statusText: ready ? 'Language data installed.' : '',
		error: null
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
	if (!voice) throw new Error(`No approved voice for ${language.name}.`);

	const total = languageDownloadBytes(language);
	const sttShare = (language.stt.downloadBytes / total) * 100;
	const voiceShare = 100 - sttShare;
	const token = ++jobToken;

	store.set({
		languageId: language.id,
		status: 'downloading',
		progress: 0,
		statusText: `Preparing ${language.name} data…`,
		error: null
	});

	running = (async () => {
		try {
			await preloadLocalSTT(language.id, (progress) => {
				if (token !== jobToken) return;
				store.update((state) => ({
					...state,
					progress: (progress.progress / 100) * sttShare,
					statusText: progress.status || `Downloading ${language.name} speech model…`
				}));
			});
			await preloadLocalVoice(voice.id, (progress) => {
				if (token !== jobToken) return;
				store.update((state) => ({
					...state,
					progress: sttShare + (progress.progress / 100) * voiceShare,
					statusText: progress.status || `Downloading ${language.name} voice…`
				}));
			});
			if (token !== jobToken) return;
			await refreshLanguageData(language.id);
		} catch (error) {
			if (token !== jobToken) return;
			store.update((state) => ({
				...state,
				status: 'error',
				statusText: '',
				error: error instanceof Error ? error.message : 'Language data download failed.'
			}));
		} finally {
			if (token === jobToken) running = null;
		}
	})();

	return running;
}

/** Aborts an in-flight download by terminating the workers fetching the bytes. */
export function cancelLanguageDownload(): void {
	jobToken++;
	running = null;
	cancelLocalSTTDownload();
	cancelLocalVoiceDownload();
	store.update((state) => ({
		...state,
		status: 'missing',
		progress: 0,
		statusText: '',
		error: null
	}));
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
