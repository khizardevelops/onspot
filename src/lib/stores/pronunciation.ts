import { get } from 'svelte/store';
import { appSettings } from './settings';
import { openaiApiKey } from './secrets';
import { synthesizeSpeech } from '$lib/adapters/tts/service';

/**
 * Per-word pronunciation.
 *
 * Approach: synthesize each word on demand and cache the resulting WAV.
 * Splitting a whole-sentence recording into words would need forced alignment
 * and would fight French liaisons and the absence of inter-word silence.
 * Piper's VITS is deterministic, so synthesizing a word once and caching it is
 * equivalent, alignment-free, and instant on repeat.
 */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_WORD_CACHE = 48;
let current: HTMLAudioElement | null = null;
let playToken = 0;

/** Lowercases and strips surrounding punctuation so "Lyon," and "Lyon" share audio. */
export function normalizeWord(word: string): string {
	// Any script's letters count (œ, æ and kana fell outside the old a-zà-ÿ range,
	// so "œuvre" was spoken as "uvre" and Japanese words were dropped).
	return word
		.toLowerCase()
		.replace(/[’]/g, "'")
		.replace(/^[^\p{L}\p{M}\p{N}']+|[^\p{L}\p{M}\p{N}']+$/gu, '');
}

export function isPronounceable(word: string): boolean {
	const letters = normalizeWord(word).replace(/[^\p{L}\p{M}]/gu, '');
	// One CJK character is a word; a single Latin letter is usually an article/filler.
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(letters) ? letters.length >= 1 : letters.length >= 2;
}

async function synthesize(word: string): Promise<string> {
	const text = normalizeWord(word);
	const settings = get(appSettings);
	// Changing voice or engine must not replay a word rendered with the old one.
	const key = `${settings.ttsMode}:${settings.targetLanguage}:${settings.ttsVoice}:${text}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const running = inflight.get(key);
	if (running) return running;

	const promise = synthesizeSpeech({
		text,
		mode: settings.ttsMode,
		languageId: settings.targetLanguage,
		voice: settings.ttsVoice,
		openaiApiKey: get(openaiApiKey) || undefined
	})
		.then((speech) => {
			if (cache.size >= MAX_WORD_CACHE) {
				const oldest = cache.entries().next().value as [string, string] | undefined;
				if (oldest) {
					cache.delete(oldest[0]);
					URL.revokeObjectURL(oldest[1]);
				}
			}
			cache.set(key, speech.url);
			inflight.delete(key);
			return speech.url;
		})
		.catch((error) => {
			inflight.delete(key);
			throw error;
		});

	inflight.set(key, promise);
	return promise;
}

/** Cancels any pending playback. */
export function cancelHover(): void {
	playToken++;
}

/** Plays a word immediately (click / keyboard). */
export function playWord(word: string): void {
	if (!isPronounceable(word)) return;
	const token = ++playToken;
	void synthesize(word)
		.then((url) => {
			if (token !== playToken) return;
			current?.pause();
			current = new Audio(url);
			void current.play().catch(() => {
				// Autoplay policy can reject without a gesture; the click path works.
			});
		})
		.catch((error) => console.warn('[pronunciation] failed', error));
}

/** Pre-synthesizes words (e.g. for an attempt), sequentially and quietly. */
export async function preloadWords(words: string[]): Promise<void> {
	const unique = [...new Set(words.map(normalizeWord).filter(isPronounceable))];
	for (const word of unique) {
		try {
			await synthesize(word);
		} catch {
			// Stop on the first failure (usually the voice is not loaded yet).
			return;
		}
	}
}
