// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from 'svelte/store';
import { synthesizeSpeech } from '#lib/speech/tts/service.js';
import { getVoice, requireLanguage } from '#lib/languages/index.js';
import { createProcessingChain, levelingGain, type ProcessingChain } from '#lib/utils/audioEffects.js';
import type { VoiceTuning } from '#lib/languages/index.js';
import { appSettings, voiceTuning, type AppSettings } from './settings';
import { ttsApiOptions } from './ttsConfig';
import { stopAudio } from './audio';

export type TtsPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TtsPreviewState {
	status: TtsPreviewStatus;
	/** True when the last generation came from the stored audio cache. */
	fromCache: boolean;
	progress: number;
	statusText: string;
	error: string | null;
	/** `mode:language:voice` the state belongs to. */
	selection: string;
	playing: boolean;
	loop: boolean;
}

const initial: TtsPreviewState = {
	status: 'idle',
	fromCache: false,
	progress: 0,
	statusText: '',
	error: null,
	selection: '',
	playing: false,
	loop: false
};

const store = writable<TtsPreviewState>({ ...initial });
export const ttsPreview = { subscribe: store.subscribe };

let context: AudioContext | null = null;
let clip: { selection: string; buffer: AudioBuffer } | null = null;
let source: AudioBufferSourceNode | null = null;
let chain: ProcessingChain | null = null;
let inflight: Promise<AudioBuffer | null> | null = null;
let inflightSelection = '';

/**
 * Tuning is deliberately not part of the selection: the preview is the raw
 * voice with the processing applied live, so moving a fader never invalidates
 * or regenerates it. The speaking pace is: the voice makes the audio at it.
 */
function selectionKey(settings: AppSettings): string {
	const api =
		settings.ttsMode === 'cloud'
			? settings.ttsCloudProvider === 'elevenlabs'
				? `:elevenlabs:${settings.elevenLabsModel}:${settings.elevenLabsVoiceId}`
				: `:openai:${settings.ttsApiBaseUrl}:${settings.ttsApiModel}:${settings.ttsApiVoice}`
			: '';
	const pace = settings.ttsMode === 'local' ? `:pace${settings.targetSpeechPace}` : '';
	return `${settings.ttsMode}:${settings.targetLanguage}:${settings.ttsVoice}${pace}${api}`;
}

function currentSelection(): string {
	return selectionKey(get(appSettings));
}

/**
 * The device's own rate. The preview used to run at 22.05 kHz to match Piper's
 * medium voices exactly, but that cut everything above 11 kHz from the 44.1 kHz
 * voices (Tom, Supertonic); the EQ's bands sit far below either Nyquist, so they
 * sound the same at any rate.
 */
function audioContext(): AudioContext {
	if (context && context.state !== 'closed') return context;
	context = new AudioContext();
	return context;
}

/** Synthesizes (or loads from the cache) the raw preview clip once per selection. */
async function loadClip(force: boolean): Promise<AudioBuffer | null> {
	const selection = currentSelection();
	if (!force && clip?.selection === selection) return clip.buffer;
	if (inflight && inflightSelection === selection) return inflight;

	const settings = get(appSettings);
	const language = requireLanguage(settings.targetLanguage);
	store.update((state) => ({
		...state,
		status: 'loading',
		progress: 0,
		statusText: '',
		error: null,
		selection
	}));

	inflightSelection = selection;
	inflight = (async () => {
		try {
			const speech = await synthesizeSpeech({
				text: language.preview,
				mode: settings.ttsMode,
				languageId: language.id,
				voice: settings.ttsVoice,
				...ttsApiOptions(settings),
				force,
				raw: true,
				onProgress: (progress) => {
					if (currentSelection() !== selection) return;
					store.update((state) => ({
						...state,
						progress: progress.progress,
						statusText: progress.status
					}));
				}
			});
			const bytes = await (await fetch(speech.url)).arrayBuffer();
			URL.revokeObjectURL(speech.url);
			const buffer = await audioContext().decodeAudioData(bytes);
			// The user changed voice/language/mode while the model was running;
			// discard this result rather than play the wrong voice.
			if (currentSelection() !== selection) return null;
			clip = { selection, buffer };
			store.update((state) => ({
				...state,
				status: 'ready',
				fromCache: speech.cached,
				progress: 100,
				statusText: ''
			}));
			return buffer;
		} catch (error) {
			if (currentSelection() === selection) {
				store.update((state) => ({
					...state,
					status: 'error',
					progress: 0,
					statusText: '',
					error: error instanceof Error ? error.message : 'Could not generate the preview.'
				}));
			}
			return null;
		} finally {
			if (inflightSelection === selection) {
				inflight = null;
				inflightSelection = '';
			}
		}
	})();
	return inflight;
}

function releaseSource(): void {
	if (source) {
		source.onended = null;
		try {
			source.stop();
		} catch {
			// Already stopped.
		}
		source.disconnect();
	}
	chain?.output.disconnect();
	source = null;
	chain = null;
}

/**
 * The gain that brings the preview to the shared loudness with the tone the
 * faders set, so the preview is as loud as the voice's read-backs. Worked out
 * from the clip, in a few milliseconds.
 */
function previewLeveling(buffer: AudioBuffer, tuning: VoiceTuning): Promise<number> {
	const settings = get(appSettings);
	const profile = getVoice(settings.targetLanguage, settings.ttsVoice)?.processing;
	return levelingGain(buffer.getChannelData(0), buffer.sampleRate, profile, tuning);
}

/** The faders that change the tone; the volume fader does not change the leveling. */
const TONE_FADERS = ['bassDb', 'bodyDb', 'presenceDb', 'trebleDb'] as const;

/** The tuning the running preview was leveled for. */
let leveledFor: VoiceTuning | null = null;
/** Counts leveling requests, so a slow one never overrides a newer one. */
let levelingRequests = 0;

/** Works the leveling out again after a tone fader moved, and applies it to the running preview. */
async function relevel(tuning: VoiceTuning): Promise<void> {
	const leveled = leveledFor;
	if (!clip || !chain || !leveled || TONE_FADERS.every((fader) => leveled[fader] === tuning[fader])) return;
	leveledFor = tuning;

	const request = ++levelingRequests;
	const running = chain;
	const gain = await previewLeveling(clip.buffer, tuning);
	if (request === levelingRequests && chain === running) running.setLeveling(gain);
}

/** Counts starts, so a start still working out its leveling gives way to a newer one. */
let startRequests = 0;

async function start(buffer: AudioBuffer): Promise<void> {
	const settings = get(appSettings);
	const isProcessed = settings.ttsMode === 'local';
	const tuning = voiceTuning(settings, settings.ttsVoice);

	const request = ++startRequests;
	const leveling = isProcessed ? await previewLeveling(buffer, tuning) : 1;
	if (request !== startRequests || clip?.buffer !== buffer) return;

	const ctx = audioContext();
	releaseSource();
	const node = ctx.createBufferSource();
	node.buffer = buffer;
	node.loop = get(store).loop;

	// Cloud voices are not processed; local voices get their profile, tuning and leveling.
	if (isProcessed) {
		const profile = getVoice(settings.targetLanguage, settings.ttsVoice)?.processing;
		chain = createProcessingChain(ctx, profile, tuning, leveling);
		leveledFor = tuning;
		node.connect(chain.input);
		chain.output.connect(ctx.destination);
	} else {
		node.connect(ctx.destination);
	}

	node.onended = () => {
		if (source !== node) return;
		releaseSource();
		store.update((state) => ({ ...state, playing: false }));
	};
	source = node;
	node.start();
	store.update((state) => ({ ...state, playing: true }));
}

/**
 * Plays the preview, resuming where a pause left it. The first play of a
 * selection generates the raw clip once; after that it is served from memory
 * or the database cache.
 */
export async function playVoicePreview(force = false): Promise<void> {
	// Resume inside the click so autoplay policy never blocks the preview,
	// even when generation takes a while.
	const ctx = audioContext();
	void ctx.resume();
	stopAudio();

	if (!force && source && get(store).selection === currentSelection()) {
		store.update((state) => ({ ...state, playing: true }));
		return;
	}
	const buffer = await loadClip(force);
	if (buffer && currentSelection() === get(store).selection) await start(buffer);
}

export function pauseVoicePreview(): void {
	if (!source) return;
	void context?.suspend();
	store.update((state) => ({ ...state, playing: false }));
}

export function stopVoicePreview(): void {
	startRequests++; // A start still working out its leveling must not play after this.
	releaseSource();
	store.update((state) => ({ ...state, playing: false }));
}

export function toggleVoicePreviewLoop(): void {
	store.update((state) => {
		const loop = !state.loop;
		if (source) source.loop = loop;
		return { ...state, loop };
	});
}

/** Deliberate, confirmed regeneration: reruns the model and replaces the cache. */
export function regenerateVoicePreview(): Promise<void> {
	stopVoicePreview();
	return playVoicePreview(true);
}

// A new voice/language/mode drops the clip; a tuning change only retunes the
// running graph, which is what makes the equalizer audible live.
let knownSelection = '';
appSettings.subscribe((settings) => {
	const selection = selectionKey(settings);
	if (selection !== knownSelection) {
		knownSelection = selection;
		releaseSource();
		clip = null;
		store.update((state) => ({ ...initial, loop: state.loop, selection }));
		return;
	}
	const tuning = voiceTuning(settings, settings.ttsVoice);
	chain?.setTuning(tuning);
	void relevel(tuning);
});
