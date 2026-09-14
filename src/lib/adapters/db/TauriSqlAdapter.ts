import Database from '@tauri-apps/plugin-sql';
import { SqlDatabaseAdapter } from './SqlDatabaseAdapter';
import type { SqlDriver, SqlValue } from './types';

/**
 * `@tauri-apps/plugin-sql` documents `$1, $2` placeholders for SQLite. The
 * shared repository writes `?`, which SQLite also accepts, but translate at the
 * boundary so the driver matches the documented form.
 *
 * The translation is quote-aware: a `?` inside a string literal is left alone.
 */
function toNumberedPlaceholders(sql: string): string {
	let out = '';
	let inString = false;
	let index = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (inString) {
			out += ch;
			if (ch === "'") {
				if (sql[i + 1] === "'") out += sql[++i];
				else inString = false;
			}
		} else if (ch === "'") {
			inString = true;
			out += ch;
		} else if (ch === '?') {
			out += `$${++index}`;
		} else {
			out += ch;
		}
	}
	return out;
}

class TauriSqlDriver implements SqlDriver {
	constructor(private readonly db: Database) {}

	async execute(sql: string, params: SqlValue[] = []): Promise<void> {
		await this.db.execute(toNumberedPlaceholders(sql), params);
	}

	async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
		return this.db.select<T[]>(toNumberedPlaceholders(sql), params);
	}

	async close(): Promise<void> {
		await this.db.close();
	}
}

/**
 * Desktop storage: native SQLite through the Tauri SQL plugin. The database
 * lives in the app data directory (the plugin anchors `sqlite:` paths to
 * `BaseDirectory::App`).
 */
export class TauriSqlAdapter extends SqlDatabaseAdapter {
	readonly kind = 'tauri-sql' as const;

	protected async openDriver(): Promise<SqlDriver> {
		const db = await Database.load('sqlite:onspot.db');
		return new TauriSqlDriver(db);
	}
}
