// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import { isTauri } from '#lib/platform/runtime.js';
import { initSettings } from '#lib/stores/settings.js';
import { toast } from '#lib/stores/toast.js';
import { DatabaseImportError } from '#lib/adapters/db/types.js';
import { StorageFullError, requestPersistentStorage, storageRoom } from './storage';
import { getCoreClient } from '#lib/core-client/client.js';
import type { LegacyImportResult } from '#lib/core-client/types.gen.js';

const SQLITE_MIME = 'application/vnd.sqlite3';
const SQLITE_MAGIC = 'SQLite format 3\u0000';

/** True when the bytes start with SQLite's file-format header. */
export function isSqliteDatabase(data: Uint8Array): boolean {
	if (data.byteLength < SQLITE_MAGIC.length) return false;
	for (let i = 0; i < SQLITE_MAGIC.length; i++) {
		if (data[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
	}
	return true;
}

/** Tables every onspot database has; their schema text is stored in the file. */
const REQUIRED_TABLES = [
	'schema_migrations',
	'sessions',
	'attempts',
	'corrections',
	'audio_assets',
	'settings'
] as const;

/**
 * Rejects a foreign SQLite file before it can replace the local database.
 *
 * SQLite keeps each table's `CREATE TABLE` text in the file, so the schema is
 * visible without opening a connection. The web worker also validates the
 * restored database; this check is the guard for the native (Tauri) path.
 *
 * @param data A SQLite file image.
 * @returns True when every expected onspot table is declared.
 */
export function isOnspotDatabase(data: Uint8Array): boolean {
	const text = new TextDecoder('latin1').decode(data);

	return REQUIRED_TABLES.every((table) =>
		new RegExp(`CREATE TABLE\\s+(IF NOT EXISTS\\s+)?["']?${table}["']?`, 'i').test(text)
	);
}

/** How long a restore waits for the user to answer the persistent-storage prompt. */
const PERSIST_PROMPT_WAIT = 60_000;

/** Room kept free beyond the backup itself for SQLite's rewrite and OPFS bookkeeping. */
const SAFETY_MARGIN = 1_048_576;

/** Last-resort download of the previous database when a failed restore could not put it back. */
function saveRescueFile(bytes: Uint8Array): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: SQLITE_MIME }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `onspot-rescue-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite`;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Counts reported after a `.sqlite` backup replaces the local database. */
export interface SqliteRestoreResult {
	sessions: number;
	attempts: number;
}

/**
 * Replaces the local database image without touching the in-memory stores.
 *
 * Cloud sync rehydrates itself, and the core's restore command rehydrates in
 * the driver after the command returns; both want the same header check,
 * storage pre-check and rollback, but only one of them should reload settings
 * while a bridge command is still in flight.
 *
 * @param bytes A snapshot produced by `exportSqliteFile`.
 * @returns Session and attempt counts for the restore confirmation.
 */
export async function restoreSqliteBytes(bytes: Uint8Array): Promise<SqliteRestoreResult> {
	// Which step is running, so an unexpected browser error (Firefox's bare
	// "Unknown failure" DOMException, say) says where it came from.
	let step = 'starting the restore';
	try {
		// Ask first, while the confirm click still counts as user activation:
		// Firefox only prompts for persistent storage then, and a persisted site is
		// not held to the shared per-site allowance that makes restores fail there.
		// Not awaited: the promise only settles once the user answers the prompt.
		const web = !isTauri();
		const persisting = web ? requestPersistentStorage() : Promise.resolve(false);
		step = 'checking the backup format';
		if (!isSqliteDatabase(bytes)) {
			throw new RestoreError('This is not a SQLite database. Choose an onspot .sqlite backup.');
		}
		// The web worker validates the restored schema with SQLite itself. The
		// native path has no such check, so inspect the schema text there.
		if (isTauri() && !isOnspotDatabase(bytes)) {
			throw new RestoreError('This SQLite file is not an onspot backup. Nothing was changed.');
		}
		step = 'opening the local database';
		const db = await getDatabaseAdapter();
		step = 'measuring the local database';
		// The current database file is freed before the backup is written, so only
		// growth beyond it needs new room. A site already over its allowance has none.
		const current = web ? (await db.exportSqliteFile()).byteLength : 0;
		const needed = Math.max(0, bytes.byteLength - current) + SAFETY_MARGIN;
		if (web) {
			step = 'checking browser storage';
			let room = await storageRoom();
			if (room && room.free < needed && !room.persisted) {
				// Not enough room yet; the browser may be asking to allow persistent storage.
				toast('Allow persistent storage if your browser asks: this site needs more room to restore.', 8000);
				await Promise.race([persisting, new Promise((resolve) => setTimeout(resolve, PERSIST_PROMPT_WAIT))]);
				room = await storageRoom();
			}
			if (room && room.free < needed) throw new StorageFullError(room, needed, 'Nothing was changed.');
		}
		step = 'writing the backup into the local database';
		try {
			await db.importSqliteFile(bytes);
		} catch (error) {
			if (!(error instanceof DatabaseImportError)) throw error;
			if (error.invalid) throw new RestoreError(`${error.message} Nothing was changed.`);
			let outcome = 'Nothing was changed: your current data is still here.';
			if (!error.rolledBack) {
				if (error.rescue) saveRescueFile(error.rescue);
				outcome = error.rescue
					? 'Your previous data could not be written back, so it was downloaded as an onspot-rescue .sqlite file; restore that once there is space.'
					: 'Your previous data could not be written back.';
			}
			if (error.storage) throw new StorageFullError(await storageRoom(), needed, outcome);
			throw new RestoreError(`Restore failed while ${step} (${error.message}). ${outcome}`);
		}
		step = 'reloading the restored data';
		const [sessions, attempts] = await Promise.all([db.listSessions(), db.listAllAttempts()]);
		return { sessions: sessions.length, attempts: attempts.length };
	} catch (error) {
		if (error instanceof RestoreError || error instanceof StorageFullError) throw error;
		// Unexpected: keep the whole error for the console and name the step in the message.
		console.error(`[restore] failed while ${step}`, error);
		const kind = error instanceof Error && error.name && error.name !== 'Error' ? `${error.name}: ` : '';
		const detail = error instanceof Error ? error.message : String(error);
		throw new RestoreError(`Restore failed while ${step} (${kind}${detail || 'no details'}). Details are in the browser console.`);
	}
}

/** A restore failure whose message is already written for the learner. */
class RestoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RestoreError';
	}
}

/** Counts reported after a legacy JSON backup is merged into the current database. */
export type LegacyRestoreResult = LegacyImportResult;

/**
 * Merges the pre-SQLite-export JSON format into the current database. It never
 * clears unrelated local data, which makes it safe when recovering a browser
 * profile or moving from the web app to the desktop app.
 */
export async function importLegacyJsonBackup(file: File): Promise<LegacyRestoreResult> {
	const result = await (await getCoreClient()).command<LegacyRestoreResult>('restore.legacy_json', {
		json: await file.text(),
		now: new Date().toISOString()
	});
	// The in-memory settings must pick up restored values, or the next
	// preference change writes the old ones back.
	if (result.settings > 0) await initSettings();
	return result;
}
