import { get, writable } from 'svelte/store';
import { synthesizeSpeech } from '#lib/speech/tts/service.js';
import { getVoice, requireLanguage } from '#lib/languages/index.js';
import { createProcessingChain, peakOf, type ProcessingChain } from '#lib/utils/audioEffects.js';
import { appSettings, voiceTuning, type AppSettings } from './settings';
import { openaiApiKey } from './secrets';
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

/**
 * Piper's medium voices render at 22.05 kHz. Running the live graph at the
 * same rate as `processPcm` keeps the filters' response identical.
 */
const PREVIEW_SAMPLE_RATE = 22050;

let context: AudioContext | null = null;
let clip: { selection: string; buffer: AudioBuffer; peak: number } | null = null;
let source: AudioBufferSourceNode | null = null;
let chain: ProcessingChain | null = null;
let inflight: Promise<AudioBuffer | null> | null = null;
let inflightSelection = '';

/**
 * Tuning is deliberately not part of the selection: the preview is the raw
 * voice with the processing applied live, so moving a fader never invalidates
 * or regenerates it.
 */
function selectionKey(settings: AppSettings): string {
	return `${settings.ttsMode}:${settings.targetLanguage}:${settings.ttsVoice}`;
}

function currentSelection(): string {
	return selectionKey(get(appSettings));
}

function audioContext(): AudioContext {
	if (context && context.state !== 'closed') return context;
	try {
		context = new AudioContext({ sampleRate: PREVIEW_SAMPLE_RATE });
	} catch {
		context = new AudioContext();
	}
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
				openaiApiKey: get(openaiApiKey) || undefined,
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
			clip = { selection, buffer, peak: peakOf(buffer.getChannelData(0)) };
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

function start(buffer: AudioBuffer): void {
	const ctx = audioContext();
	releaseSource();
	const settings = get(appSettings);
	const node = ctx.createBufferSource();
	node.buffer = buffer;
	node.loop = get(store).loop;

	// Cloud voices are not processed; local voices get their profile + tuning.
	if (settings.ttsMode === 'local') {
		const profile = getVoice(settings.targetLanguage, settings.ttsVoice)?.processing;
		chain = createProcessingChain(
			ctx,
			profile,
			voiceTuning(settings, settings.ttsVoice),
			clip?.peak ?? 1
		);
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
	if (buffer && currentSelection() === get(store).selection) start(buffer);
}

export function pauseVoicePreview(): void {
	if (!source) return;
	void context?.suspend();
	store.update((state) => ({ ...state, playing: false }));
}

export function stopVoicePreview(): void {
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
	chain?.setTuning(voiceTuning(settings, settings.ttsVoice));
});
