// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The web SQL host.
 *
 * The Rust core holds the schema, the migrations and the repositories; the
 * browser owns the engine. This object is the only crossing point: Rust sends
 * SQL text and parameters, and every call lands on the page's one SQLite
 * worker (`openBrowserDatabase`).
 */

import { openBrowserDatabase, type SqlStatement, type SqlValue } from '#lib/adapters/db/index.js';

/** The methods the wasm module looks up on the object passed to `init_core_wasm`. */
export interface CoreSqlHost {
	execute(sql: string, params: SqlValue[]): Promise<void>;
	select(sql: string, params: SqlValue[]): Promise<Record<string, unknown>[]>;
	batch(statements: SqlStatement[]): Promise<void>;
	/** A no-op: the page's database outlives the core. */
	close(): Promise<void>;
}

/** Builds the host over the page's database; the core migrates it on boot. */
export async function createCoreSqlHost(): Promise<CoreSqlHost> {
	const database = await openBrowserDatabase();
	return {
		execute: (sql, params) => database.execute(sql, params),
		select: (sql, params) => database.select<Record<string, unknown>>(sql, params),
		batch: (statements) => database.batch(statements),
		close: async () => undefined
	};
}
