// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `SecretStore` host implementation (P2).
 *
 * Keys deliberately do not cross the bridge or enter SQLite: the database is
 * what gets backed up and synced, and an API key must never leave the device
 * that way (invariant I3). Both the browser and the Tauri webview are
 * JavaScript hosts with the same `localStorage`, so this one implementation
 * keeps today's persistence on both runtimes and an existing key survives the
 * upgrade.
 *
 * If a future runtime has no browser storage, it supplies its own
 * `SecretStore`; screens only use these functions, never `localStorage`
 * directly.
 */

const PREFIX = 'onspot.key.';

/** The names are stable: they are the stored keys, not display names. */
export type SecretName =
	| 'llm.groq'
	| 'llm.deepseek'
	| 'llm.custom'
	| 'llm.local'
	| 'llm.openai'
	| 'tts.elevenlabs'
	| 'hf'
	| 'google.refresh'
	| 'webdav.username'
	| 'webdav.password';

/** Everything a settings/export path must never reveal. */
export const SECRET_PREFIX = PREFIX;

export interface SecretStore {
	get(name: string): string;
	set(name: string, value: string): void;
}

const hasStorage = typeof localStorage !== 'undefined';

/** Browser storage, guarded so a stray server-side import cannot throw. */
export const browserSecretStore: SecretStore = {
	get(name) {
		if (!hasStorage) return '';
		try {
			return localStorage.getItem(PREFIX + name) ?? '';
		} catch {
			return '';
		}
	},
	set(name, value) {
		if (!hasStorage) return;
		try {
			if (value) localStorage.setItem(PREFIX + name, value);
			else localStorage.removeItem(PREFIX + name);
		} catch {
			// Private mode / storage full: the in-memory store keeps the value
			// for this session.
		}
	}
};

/** Reads one secret from the active store. */
export function readSecret(name: SecretName): string {
	return browserSecretStore.get(name);
}

/** Writes or clears one secret (an empty value removes it). */
export function writeSecret(name: SecretName, value: string): void {
	browserSecretStore.set(name, value);
}

/**
 * Whether a value looks like key material, for regression checks on
 * settings/exports. Matches the legacy prefix only; keys are never stored
 * under any other name.
 */
export function containsSecretMaterial(text: string): boolean {
	return text.includes(PREFIX);
}
