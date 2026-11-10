// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { appSettings, type AppSettings } from './settings';
import { ttsApiOptions } from './ttsConfig';
import { synthesizeSpeech, type SynthesizeOptions } from '#lib/speech/tts/service.js';
import { tokenizeWords } from '#lib/utils/words.js';

/**
 * Per-word pronunciation.
 *
 * Approach: synthesize each word on demand and cache the resulting WAV.
 * Splitting a whole-sentence recording into words would need forced alignment
 * and would fight French liaisons and the absence of inter-word silence.
 * Piper's VITS is deterministic, so synthesizing a word once and caching it is
 * equivalent, alignment-free, and instant on repeat.
 *
 * A first tap still makes the word, which takes seconds with a high-quality
 * voice (about 5 s for Supertonic at its reference 8 steps), so the practice
 * store also prepares the words of the take being read in the background
 * (`wordSpeechOptions` keeps both on the same stored clip).
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

/**
 * How a word is spoken: the one place both a tap and the background
 * preparation take this from, so a prepared word is the clip a tap finds.
 *
 * @param word The word as written in the text.
 * @param settings The learner's settings (voice, mode, cloud endpoint).
 * @returns The options for `synthesizeSpeech`.
 */
export function wordSpeechOptions(word: string, settings: AppSettings): SynthesizeOptions {
	return {
		text: normalizeWord(word),
		mode: settings.ttsMode,
		languageId: settings.targetLanguage,
		voice: settings.ttsVoice,
		...ttsApiOptions(settings)
	};
}

/**
 * The words of a text a learner can tap, once each, in reading order.
 *
 * @param text A transcript, a corrected sentence or a question.
 * @returns The words as written (one per distinct pronunciation).
 */
export function pronounceableWords(text: string): string[] {
	const seen = new Set<string>();
	const words: string[] = [];
	for (const token of tokenizeWords(text)) {
		if (!token.word || !isPronounceable(token.text)) continue;
		const normalized = normalizeWord(token.text);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		words.push(token.text);
	}
	return words;
}

async function synthesize(word: string): Promise<string> {
	const text = normalizeWord(word);
	const settings = get(appSettings);
	const api = ttsApiOptions(settings);
	// Changing voice, engine or API endpoint must not replay a word rendered with the old one.
	const key = `${settings.ttsMode}:${settings.targetLanguage}:${settings.ttsVoice}:${api.apiProvider}:${api.apiBaseUrl}:${api.apiModel}:${api.apiVoice}:${text}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const running = inflight.get(key);
	if (running) return running;

	const promise = synthesizeSpeech(wordSpeechOptions(word, settings))
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
