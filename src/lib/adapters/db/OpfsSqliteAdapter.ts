import { SqlDatabaseAdapter } from './SqlDatabaseAdapter';
import { DatabaseImportError, type SqlDriver, type SqlStatement, type SqlValue } from './types';
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



/** Promise-based request/response wrapper around the SQLite Worker. */
class WorkerSqlDriver implements SqlDriver {
	private readonly worker: Worker;
	private readonly pending = new Map<
		number,
		{ resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }
	>();
	private nextId = 1;

	constructor() {
		this.worker = new SqliteWorker();
		this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const response = event.data;
			const entry = this.pending.get(response.id);
			if (!entry) return;
			this.pending.delete(response.id);
			if (response.ok) entry.resolve(response);
			else if (response.rolledBack !== undefined)
				entry.reject(
					new DatabaseImportError(
						response.error ?? 'The backup could not be restored.',
						Boolean(response.storage),
						response.rolledBack,
						response.bytes,
						Boolean(response.invalid)
					)
				);
			else entry.reject(new Error(response.error ?? 'SQLite worker error'));
		};
		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'SQLite worker crashed');
			for (const { reject } of this.pending.values()) reject(error);
			this.pending.clear();
		};
	}

	private request(
		op: 'execute' | 'select' | 'export' | 'import' | 'batch',
		sql = '',
		params: SqlValue[] = [],
		bytes?: Uint8Array,
		statements?: SqlStatement[]
	): Promise<WorkerResponse> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ id, op, sql, params, bytes, statements }, bytes ? [bytes.buffer] : []);
		});
	}

	/** The worker runs the whole list inside one transaction. */
	async batch(statements: SqlStatement[]): Promise<void> {
		await this.request('batch', '', [], undefined, statements);
	}

	async execute(sql: string, params: SqlValue[] = []): Promise<void> {
		await this.request('execute', sql, params);
	}

	async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
		const response = await this.request('select', sql, params);
		return (response.rows ?? []) as T[];
	}

	/** The whole database as a standard SQLite file, serialized by sqlite-wasm. */
	async exportDatabase(): Promise<Uint8Array> {
		const response = await this.request('export');
		if (!response.bytes) throw new Error('SQLite export returned no data.');
		return response.bytes;
	}

	/** Replaces the OPFS database file from a standard SQLite image. */
	async importDatabase(bytes: Uint8Array): Promise<void> {
		await this.request('import', '', [], bytes);
	}

	async close(): Promise<void> {
		this.worker.terminate();
	}
}

/**
 * Web storage: `@sqlite.org/sqlite-wasm` persisted in OPFS, executed in a
 * Worker. Requires cross-origin isolation (COOP/COEP) for the OPFS primitives.
 */
export class OpfsSqliteAdapter extends SqlDatabaseAdapter {
	readonly kind = 'opfs-sqlite' as const;

	async exportSqliteFile(): Promise<Uint8Array> {
		const driver = (await this.sql()) as WorkerSqlDriver;
		return driver.exportDatabase();
	}

	async importSqliteFile(data: Uint8Array): Promise<void> {
		const driver = (await this.sql()) as WorkerSqlDriver;
		await driver.importDatabase(data);
		// The imported schema may predate this build; migrate it before the next
		// query reaches the restored database.
		await this.init();
	}

	protected async openDriver(): Promise<SqlDriver> {
		if (typeof Worker === 'undefined') {
			throw new Error('Web Workers are unavailable in this environment.');
		}
		if (!('storage' in navigator) || !navigator.storage?.getDirectory) {
			throw new Error('OPFS is unavailable in this browser.');
		}
		return new WorkerSqlDriver();
	}
}
