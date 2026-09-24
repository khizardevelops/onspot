/**
 * Browser storage quota helpers for the web build.
 *
 * Firefox gives a site (eTLD+1, so every `localhost` port together) a
 * "best-effort" allowance derived from free disk space, and at that limit OPFS
 * writes come back short instead of throwing — sqlite-wasm then reports
 * `Unknown write() failure.` / `SQLITE_IOERR`. Sites the user grants
 * persistent storage are not held to that shared allowance.
 */

export interface StorageRoom {
	quota: number;
	usage: number;
	free: number;
	persisted: boolean;
}

/**
 * Asks for persistent storage. Call from a click handler: Firefox shows its
 * permission prompt only in response to user activation.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export async function storageRoom(): Promise<StorageRoom | null> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
	try {
		const { quota = 0, usage = 0 } = await navigator.storage.estimate();
		const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
		return { quota, usage, free: Math.max(0, quota - usage), persisted };
	} catch {
		return null;
	}
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

/** The browser refused to store data for this site: explains why and what to do. */
export class StorageFullError extends Error {
	constructor(room: StorageRoom | null, needed: number, detail = '') {
		const numbers = room ? ` (${mb(room.free)} free of ${mb(room.quota)}; this needs about ${mb(needed)})` : '';
		const firefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
		const advice = firefox
			? 'Firefox shares one storage allowance across every localhost app and sizes it from free disk space. Allow persistent storage if Firefox asks, clear site data for localhost ports you no longer use, or free up disk space, then try again.'
			: 'Free up disk space or clear data for sites you no longer use, then try again.';
		super(`The browser ran out of storage for this site${numbers}. ${advice}${detail ? ` ${detail}` : ''}`);
		this.name = 'StorageFullError';
	}
}
