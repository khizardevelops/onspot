// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from 'svelte/store';
import { appSettings, setSetting } from './settings';
import { toast } from './toast';
import { hashText } from '#lib/utils/hash.js';
import {
	DEFAULT_ELEVENLABS_VOICE_ID,
	DEFAULT_ELEVENLABS_VOICE_NAME
} from '#lib/speech/tts/cloud/elevenLabsVoices.js';

/**
 * Keeps the ElevenLabs voice one the learner's plan can actually use.
 *
 * The free plan cannot use Voice Library voices through the API, and a key
 * restricted to text-to-speech cannot even read which plan it is on, so onspot
 * cannot always tell in advance. When ElevenLabs refuses a voice (HTTP 402),
 * the key is remembered as unable to use library voices (the picker then hides
 * them), and the saved voice is replaced with a premade one every plan can use.
 *
 * Keys are remembered by hash, in this browser only, like the keys themselves.
 */

const STORAGE_KEY = 'onspot.elevenlabs.libraryRefused';

/** How long the switch notice stays up: it names the new voice and where to change it. */
const SWITCH_NOTICE_MS = 7_000;

function keyIdOf(apiKey: string): string {
	return hashText(apiKey.trim());
}

function loadRefusedKeys(): Set<string> {
	try {
		const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []);
	} catch (error) {
		console.warn('[tts] ignoring an unreadable ElevenLabs refusal record', error);
		return new Set();
	}
}

const refusedKeys = writable<Set<string>>(loadRefusedKeys());

refusedKeys.subscribe((keys) => {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
	} catch (error) {
		console.warn('[tts] could not save the ElevenLabs refusal record', error);
	}
});

/** Hashes of the keys ElevenLabs refused a library voice for; changes when a new refusal arrives. */
export const libraryRefusedKeys = { subscribe: refusedKeys.subscribe };

/**
 * Whether ElevenLabs has refused a Voice Library voice for this key.
 *
 * @param apiKey The learner's ElevenLabs key.
 */
export function libraryVoicesRefused(apiKey: string): boolean {
	return Boolean(apiKey.trim()) && get(refusedKeys).has(keyIdOf(apiKey));
}

/**
 * Remembers that this key's plan cannot use Voice Library voices.
 *
 * @param apiKey The key ElevenLabs refused.
 */
export function noteLibraryVoiceRefused(apiKey: string): void {
	if (!apiKey.trim() || libraryVoicesRefused(apiKey)) return;
	refusedKeys.update((keys) => new Set([...keys, keyIdOf(apiKey)]));
}

/**
 * Replaces a saved voice the plan cannot use with the premade default, and
 * tells the learner which voice they now hear and where to pick another.
 *
 * @returns The voice id to speak with from now on.
 */
export function replaceUnusableElevenLabsVoice(): string {
	if (get(appSettings).elevenLabsVoiceId !== DEFAULT_ELEVENLABS_VOICE_ID) {
		setSetting('elevenLabsVoiceId', DEFAULT_ELEVENLABS_VOICE_ID);
		toast(
			`That ElevenLabs voice needs a paid plan, so onspot switched to ${DEFAULT_ELEVENLABS_VOICE_NAME}, ` +
				'which every plan can use. Pick another in Settings → Text-to-speech.',
			SWITCH_NOTICE_MS
		);
	}

	return DEFAULT_ELEVENLABS_VOICE_ID;
}
