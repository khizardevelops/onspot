// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A device-local counter of learner-data writes.
 *
 * Sync cannot compare database files byte for byte: SQLite's header change
 * counter and free-page contents differ on every export even when the data is
 * identical. A monotonic counter bumped by each content write answers "has this
 * device changed since its last sync?" exactly and in constant time.
 *
 * It lives in `localStorage` on purpose. It describes this device's unsynced
 * work, not learner data, and writing it into the database would itself count
 * as a content change.
 */

const REVISION_KEY = 'onspot.db.revision';
const SYNCED_PREFIX = 'onspot.sync.synced.';

let memoryRevision = 0;
const memorySynced = new Map<string, number>();

function storage(): Storage | null {
	if (typeof localStorage === 'undefined') return null;

	try {
		return localStorage;
	} catch {
		return null;
	}
}

function readInteger(key: string): number | null {
	const store = storage();
	if (!store) return null;

	try {
		const raw = store.getItem(key);
		if (raw === null) return null;

		const value = Number(raw);
		return Number.isSafeInteger(value) ? value : null;
	} catch {
		return null;
	}
}

function writeInteger(key: string, value: number): void {
	const store = storage();
	if (!store) return;

	try {
		store.setItem(key, String(value));
	} catch {
		// Private mode or a full store: the in-memory value still works this session.
	}
}

/** The device's current content revision. Starts at zero on a fresh device. */
export function currentRevision(): number {
	const stored = readInteger(REVISION_KEY) ?? 0;
	return Math.max(stored, memoryRevision);
}

/** Records that learner data was written. Sync metadata writes must not call this. */
export function markContentChanged(): void {
	const next = currentRevision() + 1;

	memoryRevision = next;
	writeInteger(REVISION_KEY, next);
}

/** The revision this device last synced with a provider, or null if never. */
export function getSyncedRevision(provider: string): number | null {
	const stored = readInteger(`${SYNCED_PREFIX}${provider}`);
	const memory = memorySynced.get(provider) ?? null;

	if (stored === null) return memory;
	if (memory === null) return stored;

	return Math.max(stored, memory);
}

/** Records that the provider now holds the given revision. */
export function setSyncedRevision(provider: string, revision: number): void {
	memorySynced.set(provider, revision);
	writeInteger(`${SYNCED_PREFIX}${provider}`, revision);
}
