// SPDX-License-Identifier: AGPL-3.0-or-later

import { writable, type Writable } from 'svelte/store';

/**
 * BYOK secrets, stored in `localStorage` and deliberately **not** in the
 * database. The database is what gets backed up and synced to Google
 * Drive/WebDAV, and API keys must never leave the device that way.
 *
 * Access is guarded so a stray server-side import cannot throw on `localStorage`.
 */
const PREFIX = 'onspot.key.';

const hasStorage = typeof localStorage !== 'undefined';

function read(name: string): string {
	if (!hasStorage) return '';
	try {
		return localStorage.getItem(PREFIX + name) ?? '';
	} catch {
		return '';
	}
}

function persist(name: string, value: string): void {
	if (!hasStorage) return;
	try {
		if (value) localStorage.setItem(PREFIX + name, value);
		else localStorage.removeItem(PREFIX + name);
	} catch {
		// Private mode / storage full: keep the in-memory value for this session.
	}
}

function secret(name: string): Writable<string> {
	const store = writable<string>(read(name));
	store.subscribe((value) => persist(name, value));
	return store;
}

export const groqApiKey = secret('llm.groq');
export const deepseekApiKey = secret('llm.deepseek');
export const customApiKey = secret('llm.custom');
/** Optional key for a local OpenAI-compatible correction server (LM Studio, llama.cpp, Ollama). */
export const localLlmApiKey = secret('llm.local');
/** ElevenLabs cloud read-back key. */
export const elevenLabsApiKey = secret('tts.elevenlabs');
/** OpenAI-compatible or local-server key for API read-back. */
export const openaiApiKey = secret('llm.openai');
/** HuggingFace token, kept only for the (remote) HF-hosted models. */
export const hfToken = secret('hf');

/** Google OAuth refresh token. Never written to the synced database. */
export const googleRefreshToken = secret('google.refresh');
/** WebDAV credentials. Never written to the synced database. */
export const webdavUsername = secret('webdav.username');
export const webdavPassword = secret('webdav.password');
