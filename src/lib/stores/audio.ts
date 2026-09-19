import { get, writable } from 'svelte/store';

/**
 * Single shared audio player for attempt read-back, segments and recordings.
 *
 * Before this, playback was fire-and-forget `new Audio(url)` calls with no
 * play/pause, seek, speed or loop, and no way to tell which segment was
 * playing. All playback now goes through one element so the UI can show state.
 */
export type AudioKind = 'attempt' | 'segment' | 'recording' | 'correction' | 'preview';

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
	element.addEventListener('loadedmetadata', () => {
		const duration = Number.isFinite(element?.duration) ? (element as HTMLAudioElement).duration : 0;
		store.update((state) => ({ ...state, duration }));
	});
	element.addEventListener('play', () => {
		store.update((state) => ({ ...state, playing: true }));
		activityStore.update((state) => ({ ...state, playing: true }));
	});
	element.addEventListener('pause', () => {
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

/** Plays a track, reusing the element if the same URL is already loaded. */
export function playTrack(track: AudioTrack): void {
	const audio = ensureElement();
	const state = get(store);
	if (state.track?.url === track.url) {
		void audio.play().catch(() => {});
		return;
	}
	audio.pause();
	revokeObjectUrl(state.track?.url);
	audio.src = track.url;
	audio.playbackRate = state.rate;
	audio.loop = state.loop;
	store.set({ ...state, track, currentTime: 0, duration: 0, playing: false, loading: false });
	activityStore.set({ track, playing: false, loading: false });
	void audio.play().catch(() => {});
}

export function togglePlay(): void {
	const audio = ensureElement();
	if (audio.paused) void audio.play().catch(() => {});
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
