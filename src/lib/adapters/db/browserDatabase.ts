// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The browser's SQLite engine: `@sqlite.org/sqlite-wasm` persisted in OPFS
 * and run in a Worker. This is the host side of the core's `SqlDriver` port
 * on the web, and nothing more: the schema, the migrations and every query
 * live in the Rust core (`onspot-adapter-repo-sql`), which runs them through
 * `core-client/sqlHost.ts`. The desktop and Android apps open the database
 * natively in Rust and never load this module.
 *
 * Requires cross-origin isolation (COOP/COEP) for the OPFS primitives.
 */

import { DatabaseImportError, type SqlStatement, type SqlValue } from './types';
import SqliteWorker from './sqlite.worker?worker';

interface WorkerResponse {
	id: number;
	ok: boolean;
	rows?: Record<string, unknown>[];
	bytes?: Uint8Array;
	error?: string;
	storage?: boolean;
	rolledBack?: boolean;
	invalid?: boolean;
}

type WorkerOperation = 'execute' | 'select' | 'export' | 'import' | 'batch';

/** The open browser database: SQL for the core, and whole-file export/import for backups. */
export interface BrowserDatabase {
	execute(sql: string, params?: SqlValue[]): Promise<void>;
	select<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
	/** Runs the statements as one transaction. */
	batch(statements: SqlStatement[]): Promise<void>;
	/** The whole database as a standard SQLite file. */
	exportBytes(): Promise<Uint8Array>;
	/**
	 * Replaces the database file with a standard SQLite image. The core
	 * migrates the restored schema afterwards.
	 *
	 * @throws DatabaseImportError with what happened to the previous data.
	 */
	importBytes(bytes: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

/** Promise-based request/response wrapper around the SQLite Worker. */
class WorkerDatabase implements BrowserDatabase {
	private readonly worker: Worker;
	private readonly pending = new Map<
		number,
		{ resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }
	>();
	private nextId = 1;

	constructor() {
		this.worker = new SqliteWorker();
		this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.settle(event.data);
		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'SQLite worker crashed');
			for (const { reject } of this.pending.values()) reject(error);
			this.pending.clear();
		};
	}

	private settle(response: WorkerResponse): void {
		const entry = this.pending.get(response.id);
		if (!entry) return;
		this.pending.delete(response.id);

		if (response.ok) {
			entry.resolve(response);
			return;
		}
		// An import failure says whether the previous data survived.
		const isImportFailure = response.rolledBack !== undefined;
		entry.reject(
			isImportFailure
				? new DatabaseImportError(
						response.error ?? 'The backup could not be restored.',
						Boolean(response.storage),
						Boolean(response.rolledBack),
						response.bytes,
						Boolean(response.invalid)
					)
				: new Error(response.error ?? 'SQLite worker error')
		);
	}

	private request(
		op: WorkerOperation,
		{ sql = '', params = [], bytes, statements }: { sql?: string; params?: SqlValue[]; bytes?: Uint8Array; statements?: SqlStatement[] } = {}
	): Promise<WorkerResponse> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ id, op, sql, params, bytes, statements }, bytes ? [bytes.buffer] : []);
		});
	}

	async execute(sql: string, params: SqlValue[] = []): Promise<void> {
		await this.request('execute', { sql, params });
	}

	async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
		const response = await this.request('select', { sql, params });
		return (response.rows ?? []) as T[];
	}

	async batch(statements: SqlStatement[]): Promise<void> {
		await this.request('batch', { statements });
	}

	async exportBytes(): Promise<Uint8Array> {
		const response = await this.request('export');
		if (!response.bytes) throw new Error('SQLite export returned no data.');
		return response.bytes;
	}

	async importBytes(bytes: Uint8Array): Promise<void> {
		await this.request('import', { bytes });
	}

	async close(): Promise<void> {
		this.worker.terminate();
	}
}

/** Waits between attempts: short for ordinary hiccups, longer while a previous page lets go of the file. */
const RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];

/** Quick retries for failures other than a lock held elsewhere. */
const QUICK_RETRIES = 2;

let opening: Promise<BrowserDatabase> | null = null;

/**
 * Opens the page's one database, shared by every caller. A failed open is not
 * kept, so a transient OPFS hand-off error can be retried without a reload.
 */
export function openBrowserDatabase(): Promise<BrowserDatabase> {
	if (!opening) {
		opening = openWithRetries();
		void opening.catch(() => {
			opening = null;
		});
	}
	return opening;
}

/**
 * OPFS access handles are exclusive: while another tab (or a page that is still
 * unloading) holds the database, opening it fails with `NoModificationAllowedError`.
 */
function isLockedElsewhere(error: unknown): boolean {
	const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	return /NoModificationAllowed|No modification allowed|another open Access Handle/i.test(message);
}

async function openWithRetries(): Promise<BrowserDatabase> {
	if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable in this environment.');
	if (!('storage' in navigator) || !navigator.storage?.getDirectory) throw new Error('OPFS is unavailable in this browser.');

	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		const database = new WorkerDatabase();
		try {
			// A trivial query proves the worker opened the OPFS file.
			await database.select('SELECT 1');
			void protectBrowserStorage();
			return database;
		} catch (error) {
			lastError = error;
			await database.close().catch(() => undefined);
			const retryable = isLockedElsewhere(error) || attempt < QUICK_RETRIES;
			if (attempt === RETRY_DELAYS_MS.length || !retryable) break;
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
		}
	}

	if (isLockedElsewhere(lastError)) {
		throw new Error('onspot is already open in another tab or window. Close it, then reload this page.');
	}
	throw lastError instanceof Error ? lastError : new Error('Unable to open the local database.');
}

/**
 * OPFS survives refreshes and restarts, but a browser may evict best-effort
 * storage under pressure, so ask for durable storage once the database
 * exists. A browser may decline; Settings keeps export/restore as the
 * explicit backup.
 */
async function protectBrowserStorage(): Promise<void> {
	if (!navigator.storage?.persist) return;
	try {
		if (!(await navigator.storage.persisted())) await navigator.storage.persist();
	} catch {
		// Private browsing and managed browsers can block this.
	}
}
