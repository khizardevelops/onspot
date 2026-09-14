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
export const openaiApiKey = secret('llm.openai');
/** HuggingFace token, kept only for the (remote) HF-hosted models. */
export const hfToken = secret('hf');
