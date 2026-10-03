/// <reference lib="webworker" />
/**
 * SQLite WASM host for the web build.
 *
 * OPFS uses synchronous access handles, which are only available in a Worker —
 * never on the main thread. So the database lives here and the UI talks to it
 * over `postMessage`. This also keeps the UI thread free during writes.
 *
 * The SAH (synchronous access handle) pool VFS is used rather than the
 * async-proxy `opfs` VFS: it avoids a second bundled proxy worker and is the
 * current recommended OPFS backend.
 */
import initSqlite from '@sqlite.org/sqlite-wasm';

type SqlValue = string | number | null;

interface Request {
	id: number;
	op: 'execute' | 'select' | 'export' | 'import' | 'batch';
	sql: string;
	params?: SqlValue[];
	/** `batch`: statements run as one transaction. */
	statements?: { sql: string; params?: SqlValue[] }[];
	/** A complete SQLite database image, for `import`. */
	bytes?: Uint8Array;
}

interface Response {
	id: number;
	ok: boolean;
	rows?: Record<string, unknown>[];
	/**
	 * A complete SQLite database image: the result of `export`, or — when an
	 * `import` failed and the previous database could not be written back —
	 * the previous database, so the caller can save it instead of losing it.
	 */
	bytes?: Uint8Array;
	error?: string;
	/** `import` only: the failure was a storage write (quota/disk), not a bad file. */
	storage?: boolean;
	/** `import` only: the previous database is back in place after a failure. */
	rolledBack?: boolean;
	/** `import` only: the file was rejected before anything was written. */
	invalid?: boolean;
}

interface SqliteHandle {
	sqlite3: any;
	pool: any;
	db: any;
}

let handlePromise: Promise<SqliteHandle> | null = null;

async function getHandle(): Promise<SqliteHandle> {
	if (!handlePromise) {
		handlePromise = (async () => {
			const sqlite3: any = await initSqlite();
			await removeLeakedSyncChecks();
			const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'onspot-pool' });
			// The filename is virtual within the SAH pool's OPFS directory.
			const db = new pool.OpfsSAHPoolDb('/onspot.db');
			return { sqlite3, pool, db };
		})();
	}
	return handlePromise;
}

/**
 * sqlite-wasm probes OPFS on every start by creating an empty
 * `.opfs-sahpool-sync-check-*` file in the origin root and deleting it. Firefox
 * refuses that delete (the access handle is still being released), so one file
 * leaks per page load — hundreds over time. They hold no data; clear them.
 */
async function removeLeakedSyncChecks(): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		const stale: string[] = [];
		for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
			if (name.startsWith('.opfs-sahpool-sync-check-')) stale.push(name);
		}
		await Promise.all(stale.map((name) => root.removeEntry(name).catch(() => undefined)));
	} catch {
		// Housekeeping only; never block opening the database.
	}
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const { id, op, sql, params, bytes, statements } = event.data;
	try {
		const handle = await getHandle();
		const { sqlite3, db } = handle;

		if (op === 'export') {
			// sqlite-wasm serializes the open database into a standard SQLite file:
			// every table, the schema version, recordings and the TTS cache.
			const exported: Uint8Array = sqlite3.capi.sqlite3_js_db_export(db.pointer);
			(self as unknown as Worker).postMessage({ id, ok: true, bytes: exported } satisfies Response, [
				exported.buffer
			]);
			return;
		}

		if (op === 'import') {
			if (!bytes?.byteLength) throw new Error('The database file is empty.');
			// Checked before anything is replaced: init() would happily add empty
			// onspot tables to any other SQLite file, silently wiping the learner's data.
			const invalid = checkBackup(sqlite3, bytes);
			if (invalid) {
				post({ id, ok: false, error: invalid, storage: false, rolledBack: true, invalid: true });
				return;
			}
			const failure = replaceDatabase(handle, bytes);
			if (!failure) {
				post({ id, ok: true });
				return;
			}
			const response: Response = {
				id,
				ok: false,
				error: failure.message,
				storage: failure.storage,
				rolledBack: failure.rolledBack,
				bytes: failure.rescue
			};
			(self as unknown as Worker).postMessage(response, failure.rescue ? [failure.rescue.buffer] : []);
			return;
		}

		if (op === 'batch') {
			// Messages are handled one at a time, so nothing interleaves with this
			// transaction; oo1 rolls back if any statement throws.
			db.transaction(() => {
				for (const statement of statements ?? []) db.exec({ sql: statement.sql, bind: statement.params ?? [] });
			});
			post({ id, ok: true });
			return;
		}

		if (op === 'select') {
			const rows = db.exec({
				sql,
				bind: params ?? [],
				rowMode: 'object',
				returnValue: 'resultRows'
			}) as Record<string, unknown>[];
			post({ id, ok: true, rows });
			return;
		}

		db.exec({ sql, bind: params ?? [] });
		post({ id, ok: true });
	} catch (error) {
		post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
	}
};

function post(message: Response) {
	(self as unknown as Worker).postMessage(message);
}

/** `sqlite3_deserialize` flags; the wasm build does not name them in JS. */
const DESERIALIZE_FREE_ON_CLOSE = 1;
const DESERIALIZE_RESIZEABLE = 2;

interface ImportFailure {
	message: string;
	/** A storage write failed (quota or disk full), rather than the backup being unreadable. */
	storage: boolean;
	/** The previous database was written back and is intact. */
	rolledBack: boolean;
	/** The previous database, when it could not be written back. */
	rescue?: Uint8Array;
}

/** sqlite-wasm reports a short OPFS write (Firefox at its storage quota) as an I/O error. */
function isStorageFailure(message: string): boolean {
	return /SQLITE_(IOERR|FULL)|disk I\/O|write\(\) failure|quota/i.test(message);
}

/**
 * Opens a copy of the image in memory and returns why it is not a restorable
 * onspot database, or null when it is.
 */
function checkBackup(sqlite3: any, bytes: Uint8Array): string | null {
	const capi = sqlite3.capi;
	const wasm = sqlite3.wasm;
	const probe = new sqlite3.oo1.DB(':memory:');
	try {
		const data = wasm.allocFromTypedArray(bytes);
		const rc = capi.sqlite3_deserialize(
			probe.pointer,
			'main',
			data,
			bytes.byteLength,
			bytes.byteLength,
			DESERIALIZE_FREE_ON_CLOSE | DESERIALIZE_RESIZEABLE
		);
		if (rc !== capi.SQLITE_OK) {
			wasm.dealloc(data);
			return `The backup could not be read (SQLite error ${rc}).`;
		}
		const tables = new Set(
			(probe.exec({
				sql: "SELECT name FROM sqlite_master WHERE type = 'table'",
				rowMode: 'array',
				returnValue: 'resultRows'
			}) as [string][]).map(([name]) => name)
		);
		if (!['sessions', 'attempts', 'corrections'].every((name) => tables.has(name))) {
			return 'This SQLite file is not an onspot backup. Choose a file exported from onspot.';
		}
		const check = probe.selectValue('PRAGMA quick_check');
		if (check !== 'ok') return `The backup is damaged (${check}).`;
		return null;
	} catch (error) {
		return `The backup could not be read (${error instanceof Error ? error.message : String(error)}).`;
	} finally {
		probe.close();
	}
}

/**
 * Replaces the whole database from a `.sqlite` image, and never loses the
 * current one: it is copied to memory first and, if writing the backup fails
 * (typically Firefox's per-site storage quota), written back. If even that
 * fails, the copy is returned so the page can save it as a rescue file.
 */
function replaceDatabase(handle: SqliteHandle, bytes: Uint8Array): ImportFailure | null {
	const original: Uint8Array = handle.sqlite3.capi.sqlite3_js_db_export(handle.db.pointer);
	try {
		writeImage(handle, bytes);
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const storage = isStorageFailure(message);
		try {
			writeImage(handle, original);
			return { message, storage, rolledBack: true };
		} catch {
			return { message, storage, rolledBack: false, rescue: original };
		}
	}
}

/**
 * Writes a database image to the OPFS file without writing the raw image into
 * OPFS. `pool.importDb()` writes the file directly and some browsers
 * short-write that large buffer (`Unknown write() failure.`); instead the image
 * is deserialized into the connection's in-memory main database, written back
 * with `VACUUM INTO` through the same VFS writes every query uses, and the
 * connection is then reopened on the file.
 */
function writeImage(handle: SqliteHandle, bytes: Uint8Array): void {
	const { sqlite3, pool, db } = handle;
	const capi = sqlite3.capi;
	const wasm = sqlite3.wasm;
	const data = wasm.allocFromTypedArray(bytes);
	const rc = capi.sqlite3_deserialize(
		db.pointer,
		'main',
		data,
		bytes.byteLength,
		bytes.byteLength,
		DESERIALIZE_FREE_ON_CLOSE | DESERIALIZE_RESIZEABLE
	);
	if (rc !== capi.SQLITE_OK) {
		wasm.dealloc(data);
		throw new Error(`The backup could not be read (SQLite error ${rc}).`);
	}

	// The connection is off the OPFS file now. Freeing the name truncates the
	// old file, and the rewrite below recreates it through the normal VFS.
	pool.unlink('/onspot.db');
	try {
		db.exec("VACUUM INTO '/onspot.db'");
	} finally {
		// Never keep serving the in-memory copy; the next request must reach the
		// written file (or, after a failure, whatever the caller writes next).
		db.close();
		handle.db = new pool.OpfsSAHPoolDb('/onspot.db');
	}
}
