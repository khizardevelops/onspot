// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from 'svelte/store';
import {
	defaultVoiceOf,
	getExplanationVoice,
	getLanguage,
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
import { isCached } from '#lib/speech/tts/local/cachedFetch.js';
import { voiceAssets } from '#lib/languages/voices.js';
import { notify } from '#lib/platform/notifications.js';
import { useCore } from '#lib/core-client/backend.js';
import { getCoreClient } from '#lib/core-client/client.js';
import {
	languageCancelDownloadCore,
	languageDownloadCore,
	languagePlanCore,
	type LanguagePlanInput
} from '#lib/core-client/language.js';
import { isTauri } from '#lib/platform/runtime.js';
import { appSettings } from './settings';
import { toast } from './toast';

export type LanguageDataStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

/** Which local engines the learner's current processing choices need. */
export interface LanguageParts {
	stt: boolean;
	voice: boolean;
	/**
	 * The instruction-language voice that reads explanations on the device, once
	 * one is chosen. Practice does not wait for it; only explanation audio does.
	 */
	explanationVoice: boolean;
}

export interface LanguageDataState {
	languageId: string;
	status: LanguageDataStatus;
	/** What a running download is fetching, e.g. "French data and the Piper Ryan (M, US) voice". */
	downloading: string;
	/** Combined 0–100 progress across the required local parts. */
	progress: number;
	statusText: string;
	error: string | null;
	/**
	 * Bytes still to download for the required parts (`null` until checked).
	 * A part that is not required is zero, not missing.
	 */
	pending: PendingBytes | null;
	/** What the current processing choices need from the device. */
	required: LanguageParts;
	/** Which required parts are already cached. */
	installed: LanguageParts;
}

export interface PendingBytes {
	/** Required Whisper weights; 0 when not required or already cached. */
	stt: number;
	/** Required voice assets; 0 when not required or already cached. */
	voice: number;
	/** The chosen explanation voice; 0 when not chosen or already cached. */
	explanationVoice: number;
	/** Extra storage the missing parts will take on this device. */
	storage: number;
	/** What downloading the missing parts costs over the network. */
	transfer: number;
}

const initial: LanguageDataState = {
	languageId: '',
	status: 'checking',
	downloading: '',
	progress: 0,
	statusText: '',
	error: null,
	pending: null,
	required: { stt: false, voice: false, explanationVoice: false },
	installed: { stt: false, voice: false, explanationVoice: false }
};

const store = writable<LanguageDataState>({ ...initial });
export const languageData = { subscribe: store.subscribe };

let checkToken = 0;
let jobToken = 0;
let running: Promise<void> | null = null;
/** Which part of the running download is in flight; Cancel tears down only that worker. */
let phase: 'stt' | 'voice' | null = null;
/** The core emits `download_progress`; subscribe once per page. */
let coreEventsStarted = false;

/** The local parts the current processing choices require. */
function requiredParts(): LanguageParts {
	const settings = get(appSettings);
	const language = getLanguage(settings.targetLanguage);
	const localStt = settings.sttMode === 'local' && language?.local.stt !== false;
	const localTts = settings.ttsMode === 'local' && language?.local.tts !== false;

	return {
		stt: localStt,
		voice: localTts,
		explanationVoice: localTts && getExplanationVoice(settings.instructionLanguage, settings.explanationVoice) !== undefined
	};
}

/**
 * Chosen voice for a language: the user's saved voice when it belongs to that
 * language, otherwise the registry default (which is the listening-test winner).
 */
function preferredVoice(language: LanguageDefinition): LanguageVoice | undefined {
	return getVoice(language.id, get(appSettings).ttsVoice) ?? defaultVoiceOf(language);
}

/** The voice the learner chose for explanations in their language of instruction, if any. */
function chosenExplanationVoice(): LanguageVoice | undefined {
	const settings = get(appSettings);
	return getExplanationVoice(settings.instructionLanguage, settings.explanationVoice);
}

/** What a download fetches, in words: the language's own data, the explanation voice, or both. */
function downloadContents(language: LanguageDefinition, languageParts: boolean, explanationVoice?: LanguageVoice): string {
	const parts = [languageParts ? `${language.name} data` : '', explanationVoice ? `the ${explanationVoice.name} voice` : ''];
	return parts.filter(Boolean).join(' and ') || `${language.name} data`;
}

/** True when every required part is cached. */
function allInstalled(installed: LanguageParts): boolean {
	return installed.stt && installed.voice && installed.explanationVoice;
}

/**
 * Tells the learner a download ended. The in-app toast is the primary notice;
 * when the app is in the background, the device notification reaches them too
 * (if they allowed notifications), because the progress bar is out of sight.
 */
function announceDownloadFinished(message: string): void {
	toast(message, 6000);
	if (typeof document !== 'undefined' && document.hidden) notify('onspot', message);
}

/** A voice's cache state: whether all of it is on the device, and what is left to download. */
interface VoiceCacheState {
	installed: boolean;
	/** Missing bytes on the device, leaving out downloads already counted for another voice. */
	bytes: number;
	/** Missing bytes over the network, counted the same way. */
	transfer: number;
	/** Asset URLs already cached, so the core prices only what is left. */
	cachedUrls: string[];
}

const NO_VOICE_NEEDED: VoiceCacheState = { installed: true, bytes: 0, transfer: 0, cachedUrls: [] };

/**
 * Which of the voice's downloads are not cached yet (a Japanese voice also
 * needs its dictionary). Downloads in `alreadyCounted` belong to a voice
 * counted before this one (two Supertonic voices share one model), so their
 * bytes are left out and the estimate counts them once.
 *
 * @param voice The voice; none means no voice is available (nothing can be installed).
 * @param alreadyCounted URLs whose bytes were already counted.
 * @returns Whether the voice is fully cached, and its own missing bytes.
 */
async function voiceCacheState(
	voice: LanguageVoice | undefined,
	alreadyCounted: ReadonlySet<string> = new Set()
): Promise<VoiceCacheState> {
	if (!voice) {
		return {
			installed: false,
			bytes: Number.POSITIVE_INFINITY,
			transfer: Number.POSITIVE_INFINITY,
			cachedUrls: []
		};
	}

	const assets = voiceAssets(voice);
	const cached = await Promise.all(assets.map((asset) => isCached(asset.url)));
	const missing = assets.filter((_, index) => !cached[index]);
	const missingHere = missing.filter((asset) => !alreadyCounted.has(asset.url));

	return {
		installed: missing.length === 0,
		bytes: missingHere.reduce((total, asset) => total + asset.bytes, 0),
		transfer: missingHere.reduce((total, asset) => total + asset.transferBytes, 0),
		cachedUrls: assets.filter((_, index) => cached[index]).map((asset) => asset.url)
	};
}

interface LanguageCheck {
	required: LanguageParts;
	installed: LanguageParts;
	pending: PendingBytes;
	/** Cached asset URLs, so the core can price a partially cached part exactly. */
	cachedAssets: string[];
}

/** The input the core planner needs, from the driver's cache check. */
function corePlanInput(language: LanguageDefinition, check: LanguageCheck): LanguagePlanInput {
	const settings = get(appSettings);
	const voice = check.required.voice ? preferredVoice(language) : undefined;
	const explanationVoice = check.required.explanationVoice
		? chosenExplanationVoice()
		: undefined;
	return {
		languageId: language.id,
		instructionLanguageId: settings.instructionLanguage,
		native: isTauri(),
		required: check.required,
		installed: check.installed,
		voiceId: voice?.id ?? null,
		explanationVoiceId: explanationVoice?.id ?? null,
		cachedAssets: check.cachedAssets
	};
}

/** Starts the one core event subscription the progress bar needs. */
async function ensureCoreDownloadEvents(): Promise<void> {
	if (coreEventsStarted) return;
	const client = await getCoreClient();
	coreEventsStarted = true;
	client.subscribe((event) => {
		if (event.event !== 'download_progress') return;
		if (!running) return;
		store.update((state) => ({
			...state,
			status: 'downloading',
			progress: event.progress,
			statusText: event.label || state.statusText
		}));
	});
}

/**
 * Checks only the parts the current processing choices need. Cloud-only (or
 * local-correction-only) setups therefore need no speech downloads at all.
 */
async function checkLanguage(language: LanguageDefinition): Promise<LanguageCheck> {
	const required = requiredParts();
	const targetVoice = required.voice ? preferredVoice(language) : undefined;
	const targetVoiceUrls = new Set(targetVoice ? voiceAssets(targetVoice).map((asset) => asset.url) : []);

	const [sttMissing, voiceMissing, explanationMissing] = await Promise.all([
		required.stt ? missingLocalSttBytes(language.id) : Promise.resolve(0),
		required.voice ? voiceCacheState(targetVoice) : Promise.resolve(NO_VOICE_NEEDED),
		required.explanationVoice ? voiceCacheState(chosenExplanationVoice(), targetVoiceUrls) : Promise.resolve(NO_VOICE_NEEDED)
	]);

	return {
		required,
		installed: {
			stt: !required.stt || sttMissing === 0,
			voice: voiceMissing.installed,
			explanationVoice: explanationMissing.installed
		},
		pending: {
			stt: sttMissing,
			voice: voiceMissing.bytes,
			explanationVoice: explanationMissing.bytes,
			storage: sttMissing + voiceMissing.bytes + explanationMissing.bytes,
			transfer: sttMissing + voiceMissing.transfer + explanationMissing.transfer
		},
		cachedAssets: [...voiceMissing.cachedUrls, ...explanationMissing.cachedUrls]
	};
}

/** Re-reads the required cache state for a language and updates the store. */
export async function refreshLanguageData(
	languageId: string = get(appSettings).targetLanguage
): Promise<void> {
	// A running download owns the store and re-checks the current selection when it ends;
	// a check now would flip a live download back to "missing".
	if (running) return;
	const language = languageId ? requireLanguage(languageId) : undefined;
	if (!language) {
		store.set({ ...initial, status: 'missing', required: requiredParts() });
		return;
	}

	const token = ++checkToken;
	store.update((state) => ({
		...state,
		languageId: language.id,
		status: 'checking',
		progress: 0,
		statusText: 'Checking installed language data…',
		error: null,
		required: requiredParts(),
		installed: { stt: false, voice: false, explanationVoice: false }
	}));

	const check = await checkLanguage(language);
	if (token !== checkToken) return;

	let pending = check.pending;
	let ready = allInstalled(check.installed);
	if (useCore('language')) {
		try {
			const plan = await languagePlanCore(corePlanInput(language, check));
			pending = plan.pending;
			ready = plan.ready;
		} catch {
			// The driver's own cache check stays the fallback if planning fails.
		}
		if (token !== checkToken) return;
	}
	const nothingRequired = !check.required.stt && !check.required.voice;

	store.update((state) => ({
		...state,
		status: ready ? 'ready' : 'missing',
		progress: ready ? 100 : 0,
		statusText: ready
			? nothingRequired
				? 'No local speech data is needed for this setup.'
				: 'Language data installed.'
			: '',
		error: null,
		pending,
		required: check.required,
		installed: check.installed
	}));
}

export function isLanguageDataReady(): boolean {
	return get(store).status === 'ready';
}

/**
 * Downloads and initializes only the local parts the current processing choices
 * need, reporting one combined progress figure. In-flight work is shared.
 */
export function downloadLanguageData(languageId?: string): Promise<void> {
	if (running) return running;
	const language = requireLanguage(languageId ?? get(appSettings).targetLanguage);
	const required = requiredParts();
	const voice = preferredVoice(language);
	const explanationVoice = chosenExplanationVoice();

	if (!required.stt && !required.voice) {
		void refreshLanguageData(language.id);
		return Promise.resolve();
	}

	if ((required.stt && !language.local.stt) || (required.voice && !language.local.tts)) {
		store.update((state) => ({
			...state,
			languageId: language.id,
			status: 'error',
			error: `${language.name} is cloud-only for now; no local speech data is offered.`
		}));
		return Promise.resolve();
	}

	if (required.voice && !voice) {
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
		downloading: `${language.name} data`,
		progress: 0,
		statusText: `Preparing ${language.name} data…`,
		error: null,
		pending: known.languageId === language.id ? known.pending : null,
		required,
		installed: { stt: !required.stt, voice: !required.voice, explanationVoice: !required.explanationVoice }
	});

	running = (async () => {
		try {
			const check = await checkLanguage(language);
			if (token !== jobToken) return;

			if (allInstalled(check.installed)) {
				running = null;
				phase = null;
				await refreshLanguageData(language.id);
				return;
			}

			const missingStt = required.stt ? check.pending.stt : 0;
			const missingVoice = required.voice ? check.pending.voice : 0;
			const missingExplanation = required.explanationVoice ? check.pending.explanationVoice : 0;
			const missing = missingStt + missingVoice + missingExplanation;
			store.update((state) => ({
				...state,
				downloading: downloadContents(language, missingStt + missingVoice > 0, missingExplanation > 0 ? explanationVoice : undefined)
			}));
			if (useCore('language')) {
				await ensureCoreDownloadEvents();
				if (token !== jobToken) return;
				const result = await languageDownloadCore(corePlanInput(language, check));
				if (token !== jobToken) return;
				running = null;
				phase = null;
				if (result.status === 'cancelled') return;
				await refreshLanguageData(language.id);
				announceDownloadFinished(`${language.name} data is ready. You can practise offline now.`);
				return;
			}

			const sttShare = missing > 0 ? (missingStt / missing) * 100 : 0;
			const voiceShare = missing > 0 ? (missingVoice / missing) * 100 : 0;
			const explanationShare = missing > 0 ? (missingExplanation / missing) * 100 : 0;

			if (required.stt && missingStt > 0) {
				phase = 'stt';
				await prepareLocalStt(language.id, (progress) => {
					if (token !== jobToken) return;
					store.update((state) => ({
						...state,
						progress: (progress.progress / 100) * sttShare,
						statusText: progress.status || `Downloading ${language.name} speech model…`
					}));
				});
			}

			if (token !== jobToken) return;

			// Only what is missing: loading an installed voice here would only cost time.
			if (required.voice && voice && missingVoice > 0) {
				phase = 'voice';
				await preloadLocalVoice(voice.id, (progress) => {
					if (token !== jobToken) return;
					store.update((state) => ({
						...state,
						progress: sttShare + (progress.progress / 100) * voiceShare,
						statusText: progress.status || `Downloading ${language.name} voice…`
					}));
				});
			}

			if (token !== jobToken) return;

			if (required.explanationVoice && explanationVoice && missingExplanation > 0) {
				phase = 'voice';
				await preloadLocalVoice(explanationVoice.id, (progress) => {
					if (token !== jobToken) return;
					store.update((state) => ({
						...state,
						progress: sttShare + voiceShare + (progress.progress / 100) * explanationShare,
						statusText: progress.status || `Downloading the ${explanationVoice.name} explanation voice…`
					}));
				});
			}

			if (token !== jobToken) return;
			running = null;
			phase = null;
			await refreshLanguageData();
			announceDownloadFinished(`${language.name} data is ready. You can practise offline now.`);
		} catch (error) {
			if (token !== jobToken) return;
			const message = error instanceof Error ? error.message : 'Language data download failed.';
			store.update((state) => ({
				...state,
				status: 'error',
				statusText: '',
				error: message
			}));
			announceDownloadFinished(`Language data download failed: ${message}`);
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

	if (useCore('language')) {
		jobToken++;
		running = null;
		phase = null;
		void languageCancelDownloadCore().catch(() => undefined);
		store.update((state) => ({
			...state,
			status: 'missing',
			progress: 0,
			statusText: '',
			error: null
		}));
		void refreshLanguageData();
		return;
	}

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
 * Re-checks the cache whenever the studied language, voice or processing choice
 * changes, so the installed/missing status follows Settings from anywhere.
 */
let knownSelection = '';
appSettings.subscribe((settings) => {
	const selection = `${settings.targetLanguage}:${settings.instructionLanguage}:${settings.ttsVoice}:${settings.explanationVoice}:${settings.sttMode}:${settings.ttsMode}`;
	if (selection === knownSelection) return;
	knownSelection = selection;
	if (settings.targetLanguage) void refreshLanguageData(settings.targetLanguage);
});
