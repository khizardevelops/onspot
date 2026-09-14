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
	op: 'execute' | 'select';
	sql: string;
	params?: SqlValue[];
}

interface Response {
	id: number;
	ok: boolean;
	rows?: Record<string, unknown>[];
	error?: string;
}

interface SqliteHandle {
	sqlite3: any;
	db: any;
}

let handlePromise: Promise<SqliteHandle> | null = null;

async function getHandle(): Promise<SqliteHandle> {
	if (!handlePromise) {
		handlePromise = (async () => {
			const sqlite3: any = await initSqlite();
			const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'onspot-pool' });
			// The filename is virtual within the SAH pool's OPFS directory.
			const db = new pool.OpfsSAHPoolDb('/onspot.db');
			return { sqlite3, db };
		})();
	}
	return handlePromise;
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const { id, op, sql, params } = event.data;
	try {
		const { db } = await getHandle();

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
