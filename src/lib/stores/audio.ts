// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from 'svelte/store';
import { pcmToWavUrl } from '#lib/utils/wav.js';
import { toast } from './toast';

/**
 * Single shared audio player for attempt read-back, segments and recordings.
 *
 * Before this, playback was fire-and-forget `new Audio(url)` calls with no
 * play/pause, seek, speed or loop, and no way to tell which segment was
 * playing. All playback now goes through one element so the UI can show state.
 */
export type AudioKind =
	/** An attempt's spoken tracks: what was said, the correct version, the explanation, its follow-up question. */
	| 'said'
	| 'corrected'
	| 'explanation'
	| 'followUp'
	| 'segment'
	| 'recording'
	| 'correction'
	| 'preview';

export interface AudioTrack {
	attemptId: string;
	kind: AudioKind;
	/** Present for `segment` tracks. */
	segmentIndex?: number;
	/** Sentence text for a segment, or a label for other kinds. */
	label: string;
	url: string;
}

export interface AudioState {
	track: AudioTrack | null;
	playing: boolean;
	/** True while a track is being synthesized, before `url` exists. */
	loading: boolean;
	currentTime: number;
	duration: number;
	rate: number;
	loop: boolean;
}

const initial: AudioState = {
	track: null,
	playing: false,
	loading: false,
	currentTime: 0,
	duration: 0,
	rate: 1,
	loop: false
};

const store = writable<AudioState>({ ...initial });
export const audioPlayer = { subscribe: store.subscribe };

/**
 * Low-frequency playback identity for card buttons. Keeping this separate from
 * currentTime prevents every historical attempt card from updating several
 * times per second while one audio bar is playing.
 */
const activityStore = writable({
	track: initial.track,
	playing: initial.playing,
	loading: initial.loading
});
export const audioActivity = { subscribe: activityStore.subscribe };

let element: HTMLAudioElement | null = null;

/** A tenth of a second of silence, played once inside a tap to unlock the element. */
const PRIMING_SAMPLE_RATE = 8_000;
const PRIMING_SAMPLES = 800;

/** True once the element has played anything, after which every engine lets it play again. */
let hasPlayed = false;
/** True while the silent priming clip runs; its play/pause must not reach the player state. */
let priming = false;

function revokeObjectUrl(url: string | undefined): void {
	if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

function ensureElement(): HTMLAudioElement {
	if (element) return element;
	element = new Audio();
	element.preload = 'auto';
	element.addEventListener('timeupdate', () => {
		store.update((state) => ({ ...state, currentTime: element?.currentTime ?? 0 }));
	});
	// A streamed clip has no length until it has fully arrived, so follow every change.
	const updateDuration = () => {
		const duration = Number.isFinite(element?.duration) ? (element as HTMLAudioElement).duration : 0;
		store.update((state) => ({ ...state, duration }));
	};
	element.addEventListener('loadedmetadata', updateDuration);
	element.addEventListener('durationchange', updateDuration);
	element.addEventListener('playing', () => {
		hasPlayed = true;
	});
	element.addEventListener('play', () => {
		if (priming) return;
		store.update((state) => ({ ...state, playing: true }));
		activityStore.update((state) => ({ ...state, playing: true }));
	});
	element.addEventListener('pause', () => {
		if (priming) return;
		store.update((state) => ({ ...state, playing: false }));
		activityStore.update((state) => ({ ...state, playing: false }));
	});
	element.addEventListener('ended', () => {
		store.update((state) => ({ ...state, playing: false, currentTime: 0 }));
		activityStore.update((state) => ({ ...state, playing: false }));
	});
	return element;
}

export function setAudioLoading(loading: boolean, track?: AudioTrack | null): void {
	store.update((state) => {
		if (loading && track) {
			element?.pause();
			revokeObjectUrl(state.track?.url);
			return { ...state, playing: false, loading, track, currentTime: 0, duration: 0 };
		}
		return { ...state, loading };
	});
	activityStore.update((state) => ({
		...state,
		loading,
		track: loading && track ? track : state.track,
		playing: loading && track ? false : state.playing
	}));
}

/**
 * Starts playback and says so when the browser refuses. A refused autoplay
 * used to fail silently, so the learner waited for a reply that never came.
 */
function startPlayback(audio: HTMLAudioElement): void {
	void audio.play().catch((error: unknown) => {
		// A newer track replacing this one aborts its play(); that is not a failure.
		if (error instanceof DOMException && error.name === 'NotAllowedError') {
			toast('The browser blocked sound until you tap. Tap ▶ to listen.', 5_000);
		}
	});
}

/**
 * Lets replies play by themselves after a take. Safari and the WebKit
 * webviews behind the desktop apps only let an element play sound on its own
 * once it has played inside a user gesture (Chromium and Firefox remember any
 * interaction with the page). So the Start and Stop taps play a tenth of a
 * second of silence on the shared element, once. Call it synchronously from
 * the tap handler, before anything is awaited.
 */
export function primeAudioPlayback(): void {
	const audio = ensureElement();
	if (hasPlayed || priming || get(store).track) return;

	priming = true;
	audio.src = pcmToWavUrl(new Float32Array(PRIMING_SAMPLES), PRIMING_SAMPLE_RATE);
	const silentUrl = audio.src;

	const finish = () => {
		audio.pause();
		priming = false;
		// Leave the element empty unless a real track arrived in the meantime.
		if (audio.src === silentUrl) audio.removeAttribute('src');
		URL.revokeObjectURL(silentUrl);
	};
	audio.play().then(finish, finish);
}

/** Plays a track, reusing the element if the same URL is already loaded. */
export function playTrack(track: AudioTrack): void {
	const audio = ensureElement();
	const state = get(store);
	if (state.track?.url === track.url) {
		startPlayback(audio);
		return;
	}
	audio.pause();
	revokeObjectUrl(state.track?.url);
	audio.src = track.url;
	audio.playbackRate = state.rate;
	audio.loop = state.loop;
	store.set({ ...state, track, currentTime: 0, duration: 0, playing: false, loading: false });
	activityStore.set({ track, playing: false, loading: false });
	startPlayback(audio);
}

export function togglePlay(): void {
	const audio = ensureElement();
	if (audio.paused) startPlayback(audio);
	else audio.pause();
}

export function seek(time: number): void {
	const audio = ensureElement();
	audio.currentTime = time;
	store.update((state) => ({ ...state, currentTime: time }));
}

export function setRate(rate: number): void {
	const audio = ensureElement();
	audio.playbackRate = rate;
	store.update((state) => ({ ...state, rate }));
}

export function toggleLoop(): void {
	const audio = ensureElement();
	audio.loop = !audio.loop;
	store.update((state) => ({ ...state, loop: audio.loop }));
}

export function stopAudio(): void {
	if (!element) return;
	element.pause();
	element.currentTime = 0;
	store.update((state) => ({ ...state, playing: false, currentTime: 0 }));
	activityStore.update((state) => ({ ...state, playing: false }));
}
