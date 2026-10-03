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
		adapterPromise = openDatabaseAdapter();
		// Do not retain a rejected promise forever. A transient OPFS handoff error
		// must be retryable by the next route/action without a hard refresh.
		void adapterPromise.catch(() => {
			adapterPromise = null;
		});
	}
	return adapterPromise;
}

/** Drop the cached adapter. Intended for tests and full reloads. */
export function resetDatabaseAdapter(): void {
	adapterPromise = null;
}

async function protectBrowserStorage(): Promise<void> {
	if (isTauriRuntime() || typeof navigator === 'undefined' || !navigator.storage?.persist) return;
	try {
		if (!(await navigator.storage.persisted())) await navigator.storage.persist();
	} catch {
		// Private browsing and managed browsers can block this. The database still
		// works; Settings keeps export/restore available as the explicit backup.
	}
}

/**
 * OPFS access handles are exclusive: while another tab (or a page that is still
 * unloading) holds the database, opening it fails with `NoModificationAllowedError`.
 */
function isLockedElsewhere(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	return /NoModificationAllowed|No modification allowed|another open Access Handle/i.test(message);
}

/** Waits between attempts: short for ordinary hiccups, longer while a previous page lets go of the file. */
const RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];

async function openDatabaseAdapter(): Promise<IDatabaseAdapter> {
	const attempts = isTauriRuntime() ? 1 : RETRY_DELAYS_MS.length + 1;
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const adapter = isTauriRuntime()
			? new (await import('./TauriSqlAdapter')).TauriSqlAdapter()
			: new (await import('./OpfsSqliteAdapter')).OpfsSqliteAdapter();
		try {
			await adapter.init();
			// OPFS already survives refreshes and browser restarts for an origin, but
			// browsers may evict best-effort storage under pressure. Ask for durable
			// storage as soon as the learner's database exists. A browser may decline
			// this request, so it is a safeguard rather than a startup requirement.
			void protectBrowserStorage();
			return adapter;
		} catch (error) {
			lastError = error;
			await adapter.close().catch(() => undefined);
			// Only a lock is worth the long wait; other failures get two quick retries.
			const retryable = isLockedElsewhere(error) || attempt < 2;
			if (attempt + 1 < attempts && retryable) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
			} else break;
		}
	}
	if (isLockedElsewhere(lastError)) {
		throw new Error(
			'onspot is already open in another tab or window. Close it, then reload this page.'
		);
	}
	throw lastError instanceof Error ? lastError : new Error('Unable to open the local database.');
}
