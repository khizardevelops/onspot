// SPDX-License-Identifier: AGPL-3.0-or-later

import { writable, type Writable } from 'svelte/store';
import { readSecret, writeSecret, type SecretName } from '#lib/core-client/secrets.js';

/**
 * BYOK secrets, stored by the host's `SecretStore` (browser storage on both
 * runtimes) and deliberately **not** in the database. The database is what gets
 * backed up and synced to Google Drive/WebDAV, and API keys must never leave
 * the device that way.
 *
 * The store API stays the same for components; only the storage implementation
 * moved.
 */
function secret(name: SecretName): Writable<string> {
	const store = writable<string>(readSecret(name));
	store.subscribe((value) => writeSecret(name, value));
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
