// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The web SQL host (P2).
 *
 * The Rust core holds the schema, migrations and repositories; the browser
 * keeps owning the engine. This object is the only crossing point: Rust sends
 * SQL text and parameters, and every call lands on the existing worker driver
 * through `getDatabaseAdapter()`, so there is still exactly one OPFS
 * connection and one migration owner on the page.
 */

import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import type { SqlStatement, SqlValue } from '#lib/adapters/db/types.js';

/** The methods the wasm module looks up on the object passed to `init_core_wasm`. */
export interface CoreSqlHost {
	execute(sql: string, params: SqlValue[]): Promise<void>;
	select(sql: string, params: SqlValue[]): Promise<Record<string, unknown>[]>;
	batch(statements: SqlStatement[]): Promise<void>;
	/** A no-op: the page's adapter outlives the core. */
	close(): Promise<void>;
}

/**
 * Builds the host over the page's already-open database. The adapter's
 * `init()` has run its own migration chain by the time this resolves, and the
 * Rust migration that follows finds every version applied and writes nothing.
 */
export async function createCoreSqlHost(): Promise<CoreSqlHost> {
	const adapter = await getDatabaseAdapter();
	const driver = await adapter.driver();
	return {
		execute: (sql, params) => driver.execute(sql, params),
		select: (sql, params) => driver.select<Record<string, unknown>>(sql, params),
		// The worker's batch is a real transaction; Tauri's plugin has none, so
		// the fallback keeps the documented order without pretending atomicity.
		batch: driver.batch
			? (statements) => driver.batch!(statements)
			: async (statements) => {
					for (const statement of statements) await driver.execute(statement.sql, statement.params);
				},
		close: async () => undefined
	};
}
