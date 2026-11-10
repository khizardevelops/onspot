// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The on-device voice library in Settings: which role's library is open,
 * which voices are on this device, a download started from it, and the voice
 * being tried. `VoiceLibraryPanel.svelte` shows it; the Settings page decides
 * whether it sits beside the settings or over them.
 */
import { get, writable } from 'svelte/store';
import { VOICE_MODELS, VOICE_SAMPLE_SENTENCES, type VoiceModelInfo } from '#lib/languages/voices.js';
import type { LanguageVoice, VoiceEngine } from '#lib/languages/index.js';
import { PIPER_VOICES_BASE, voiceAssets } from '#lib/speech/tts/local/assets.js';
import { isCached } from '#lib/speech/tts/local/cachedFetch.js';
import { cancelLocalVoiceDownload, preloadLocalVoice, synthesizeVoiceSample } from '#lib/speech/tts/service.js';
import { refreshLanguageData } from './languageData';
import { stopAudio } from './audio';
import { stopVoicePreview } from './ttsPreview';

/** Which voice a library chooses: the target language's read-back voice, or the explanation voice. */
export type VoiceRole = 'target' | 'explanation';

export interface VoiceDownloadProgress {
	/** 0–100. */
	progress: number;
	status: string;
}

export interface VoiceTrial {
	voiceId: string;
	status: 'loading' | 'playing';
}

export interface VoiceLibraryState {
	/** The library on screen, or null when it is closed. */
	open: VoiceRole | null;
	/** Whether each download (by `downloadKeyOf`) is on this device; absent until checked. */
	installed: Record<string, boolean>;
	/** The one download running from the library, if any. */
	download: { key: string; progress: VoiceDownloadProgress } | null;
	/** The last failure per download key or voice id, shown on the row that caused it. */
	errors: Record<string, string>;
	trial: VoiceTrial | null;
}

const initial: VoiceLibraryState = { open: null, installed: {}, download: null, errors: {}, trial: null };

const store = writable<VoiceLibraryState>({ ...initial });
export const voiceLibrary = { subscribe: store.subscribe };

// ------------------------------------------------------------- Grouping ---

/** The voices of one model, as the library lists them. */
export interface VoiceGroup {
	engine: VoiceEngine;
	model: VoiceModelInfo;
	voices: LanguageVoice[];
	/** One download serves every voice in the group (Supertonic), so it is offered once, for the group. */
	sharedDownload: boolean;
}

/**
 * What identifies a voice's download: its files. Voices that share every file
 * (the Supertonic voices) share the key, so they are installed and downloaded
 * together.
 */
export function downloadKeyOf(voice: LanguageVoice): string {
	return voiceAssets(voice)
		.map((asset) => asset.url)
		.join('\n');
}

/**
 * Groups voices by the model that speaks them, in the order the voices come.
 *
 * @param voices One language's voices.
 * @returns One group per model.
 */
export function groupVoicesByModel(voices: readonly LanguageVoice[]): VoiceGroup[] {
	const byEngine = new Map<VoiceEngine, LanguageVoice[]>();
	for (const voice of voices) byEngine.set(voice.engine, [...(byEngine.get(voice.engine) ?? []), voice]);

	return [...byEngine].map(([engine, members]) => {
		const downloadKeys = new Set(members.map(downloadKeyOf));
		return {
			engine,
			model: VOICE_MODELS[engine],
			voices: members,
			sharedDownload: members.length > 1 && downloadKeys.size === 1
		};
	});
}

/** The sentence a voice is tried with, in its language. */
export function sampleSentenceFor(languageCode: string): string | undefined {
	return VOICE_SAMPLE_SENTENCES[languageCode];
}

// --------------------------------------------------------- Open / close ---

/** Shows the library for one role (and closes a trial of the other). */
export function openVoiceLibrary(role: VoiceRole): void {
	stopTrial();
	store.update((state) => ({ ...state, open: role, errors: {} }));
}

/** Hides the library; a running download carries on. */
export function closeVoiceLibrary(): void {
	stopTrial();
	store.update((state) => ({ ...state, open: null }));
}

// ------------------------------------------------------------ Installed ---

async function isInstalled(voice: LanguageVoice): Promise<boolean> {
	const cached = await Promise.all(voiceAssets(voice).map((asset) => isCached(asset.url)));
	return cached.every(Boolean);
}

/** Re-checks which of these voices are on this device. */
export async function refreshInstalled(voices: readonly LanguageVoice[]): Promise<void> {
	const voicePerKey = new Map(voices.map((voice) => [downloadKeyOf(voice), voice]));
	const checked = await Promise.all(
		[...voicePerKey].map(async ([key, voice]) => [key, await isInstalled(voice)] as const)
	);
	store.update((state) => ({ ...state, installed: { ...state.installed, ...Object.fromEntries(checked) } }));
}

// ------------------------------------------------------------- Download ---

/** Set while a cancelled download winds down, so its rejection is not shown as a failure. */
let cancelling = false;

/**
 * Downloads a voice (for a shared download, every voice that shares it) and
 * loads it once, so it is ready to try. One download at a time.
 *
 * @param voice The voice to download.
 */
export async function downloadVoice(voice: LanguageVoice): Promise<void> {
	if (get(store).download) return;

	const key = downloadKeyOf(voice);
	cancelling = false;
	store.update((state) => ({
		...state,
		download: { key, progress: { progress: 0, status: 'Starting the download…' } },
		errors: withoutKey(state.errors, key)
	}));

	try {
		await preloadLocalVoice(voice.id, (progress) => {
			store.update((state) =>
				state.download?.key === key ? { ...state, download: { key, progress: { progress: progress.progress, status: progress.status } } } : state
			);
		});
		store.update((state) => ({ ...state, installed: { ...state.installed, [key]: true } }));
	} catch (error) {
		if (!cancelling) {
			const message = error instanceof Error ? error.message : String(error);
			store.update((state) => ({ ...state, errors: { ...state.errors, [key]: message } }));
		}
	} finally {
		cancelling = false;
		store.update((state) => ({ ...state, download: null }));
		// Settings' install states (Ready / Install) read the same cache.
		void refreshLanguageData();
	}
}

/** Stops the running download (it ends the voice worker, as Language data's Cancel does). */
export function cancelVoiceDownload(): void {
	if (!get(store).download) return;
	cancelling = true;
	cancelLocalVoiceDownload();
}

// ---------------------------------------------------------------- Trial ---

let trialContext: AudioContext | null = null;
let trialSource: AudioBufferSourceNode | null = null;
/** Bumped by every trial and stop, so a slow generation never plays over a newer choice. */
let trialToken = 0;

function trialAudioContext(): AudioContext {
	if (!trialContext || trialContext.state === 'closed') trialContext = new AudioContext();
	return trialContext;
}

/**
 * Plays a voice: one sentence spoken on this device when the voice is
 * installed, otherwise its hosted sample (Piper voices have one). Call it
 * from the click: the audio context is resumed there, so playback is allowed
 * after the voice has taken a few seconds to speak.
 *
 * @param voice The voice to try.
 * @param languageCode The language it speaks, for the sentence.
 * @param installed Whether its download is on this device.
 * @param pace How fast it speaks (the learner's pace for a target voice; 1 for an explanation voice).
 */
export async function tryVoice(voice: LanguageVoice, languageCode: string, installed: boolean, pace: number): Promise<void> {
	stopTrial();
	const token = ++trialToken;
	const context = trialAudioContext();
	void context.resume();
	stopAudio();
	stopVoicePreview();

	store.update((state) => ({ ...state, trial: { voiceId: voice.id, status: 'loading' }, errors: withoutKey(state.errors, voice.id) }));

	try {
		const bytes = installed ? await spokenSample(voice, languageCode, pace) : await hostedSample(voice);
		const buffer = await context.decodeAudioData(bytes);
		if (token !== trialToken) return;

		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.onended = () => {
			if (token === trialToken) stopTrial();
		};
		trialSource = source;
		source.start();
		store.update((state) => ({ ...state, trial: { voiceId: voice.id, status: 'playing' } }));
	} catch (error) {
		if (token !== trialToken) return;
		const message = error instanceof Error ? error.message : String(error);
		store.update((state) => ({ ...state, trial: null, errors: { ...state.errors, [voice.id]: message } }));
	}
}

/** Stops the voice being tried. */
export function stopTrial(): void {
	trialToken++;
	if (trialSource) {
		trialSource.onended = null;
		try {
			trialSource.stop();
		} catch {
			// Already stopped.
		}
		trialSource.disconnect();
		trialSource = null;
	}
	store.update((state) => (state.trial ? { ...state, trial: null } : state));
}

async function spokenSample(voice: LanguageVoice, languageCode: string, pace: number): Promise<ArrayBuffer> {
	const sentence = sampleSentenceFor(languageCode);
	if (!sentence) throw new Error('There is no sample sentence for this language yet.');

	const clip = await synthesizeVoiceSample(voice.id, sentence, pace);
	try {
		return await (await fetch(clip.url)).arrayBuffer();
	} finally {
		URL.revokeObjectURL(clip.url);
	}
}

async function hostedSample(voice: LanguageVoice): Promise<ArrayBuffer> {
	if (!voice.samplePath) throw new Error('Download this voice to try it.');

	const response = await fetch(`${PIPER_VOICES_BASE}${voice.samplePath}`);
	if (!response.ok) throw new Error(`The sample could not be loaded (HTTP ${response.status}).`);
	return response.arrayBuffer();
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
	return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
