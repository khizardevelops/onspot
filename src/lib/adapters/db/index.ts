/**
 * Database factory.
 *
 * Detects the runtime and returns the matching adapter:
 *  - Inside Tauri (`window.__TAURI_INTERNALS__` exists) → native SQLite.
 *  - In a browser tab → sqlite-wasm over OPFS in a Worker.
 *
 * The adapter is a process-wide singleton: both runtimes are costly to open and
 * both pool their own connections.
 */
import type { IDatabaseAdapter } from './types';

export * from './types';
export type { IDatabaseAdapter } from './types';

let adapterPromise: Promise<IDatabaseAdapter> | null = null;

/** True when running inside a Tauri webview. */
export function isTauriRuntime(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getDatabaseAdapter(): Promise<IDatabaseAdapter> {
	if (!adapterPromise) {
		adapterPromise = (async () => {
			const adapter = isTauriRuntime()
				? new (await import('./TauriSqlAdapter')).TauriSqlAdapter()
				: new (await import('./OpfsSqliteAdapter')).OpfsSqliteAdapter();
			await adapter.init();
			return adapter;
		})();
	}
	return adapterPromise;
}

/** Drop the cached adapter. Intended for tests and full reloads. */
export function resetDatabaseAdapter(): void {
	adapterPromise = null;
}
