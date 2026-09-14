import { SqlDatabaseAdapter } from './SqlDatabaseAdapter';
import type { SqlDriver, SqlValue } from './types';
import SqliteWorker from './sqlite.worker?worker';

interface WorkerResponse {
	id: number;
	ok: boolean;
	rows?: Record<string, unknown>[];
	error?: string;
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
			else entry.reject(new Error(response.error ?? 'SQLite worker error'));
		};
		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'SQLite worker crashed');
			for (const { reject } of this.pending.values()) reject(error);
			this.pending.clear();
		};
	}

	private request(
		op: 'execute' | 'select',
		sql: string,
		params: SqlValue[]
	): Promise<WorkerResponse> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ id, op, sql, params });
		});
	}

	async execute(sql: string, params: SqlValue[] = []): Promise<void> {
		await this.request('execute', sql, params);
	}

	async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
		const response = await this.request('select', sql, params);
		return (response.rows ?? []) as T[];
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
