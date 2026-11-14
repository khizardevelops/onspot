<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Development readout for P2: proves the wasm bridge can drive the real
	 * SQLite worker through the Rust migration, settings and history commands.
	 * Mounted only in dev; the production bundle contains none of it.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import initSqlite from '@sqlite.org/sqlite-wasm';
	import fixtureUrl from '../../../crates/adapters/repo-sql/tests/fixtures/onspot-v0.2.4.sqlite?url';
	import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
	import { coreBackend } from './backend';
	import { getCoreClient } from './client';

	type CheckState = 'idle' | 'running' | 'pass' | 'fail' | 'skipped';

	let status = $state<CheckState>('idle');
	let detail = $state('');

	/**
	 * Opens the checked-in v9 fixture in an in-memory SQLite instance, hands it
	 * to the wasm bridge as the SQL host, and lets the Rust migration run. This
	 * is the browser half of the P2 fixture gate: the legacy file must reach
	 * schema 12 without losing rows. The host is the same shape the worker
	 * supplies, so no test-only code exists in the production bridge.
	 */
	async function checkFixtureMigration(): Promise<string> {
		const bytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
		const sqlite3: any = await (initSqlite as any)();
		const db = new sqlite3.oo1.DB(':memory:');
		try {
			const capi = sqlite3.capi;
			const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
			const rc = capi.sqlite3_deserialize(
				db.pointer,
				'main',
				pointer,
				bytes.byteLength,
				bytes.byteLength,
				1 | 2
			);
			if (rc !== capi.SQLITE_OK) {
				sqlite3.wasm.dealloc(pointer);
				throw new Error(`could not open the v9 fixture (SQLite error ${rc})`);
			}

			const host = {
				async execute(sql: string, params: unknown[] = []) {
					db.exec({ sql, bind: params });
				},
				async select(sql: string, params: unknown[] = []) {
					return db.exec({
						sql,
						bind: params,
						rowMode: 'object',
						returnValue: 'resultRows'
					}) as Record<string, unknown>[];
				},
				async batch(statements: { sql: string; params?: unknown[] }[]) {
					db.transaction(() => {
						for (const statement of statements) {
							db.exec({ sql: statement.sql, bind: statement.params ?? [] });
						}
					});
				},
				async close() {
					// The check owns this in-memory database and closes it below.
				}
			};

			// A separate module instance: the fixture boot must not replace the page's
			// core or its event sink. The query string gives wasm-bindgen its own
			// thread-local `CORE` and memory for this check.
			const url = `${resolve('/')}core-bridge/onspot_bridge.js?fixture=1`;
			const bridge = (await import(/* @vite-ignore */ url)) as {
				default(): Promise<unknown>;
				init_core_wasm(
					config: unknown,
					callback: (event: unknown) => void,
					sqlHost: unknown
				): Promise<unknown>;
			};
			await bridge.default();
			await bridge.init_core_wasm({ appVersion: 'fixture-check' }, () => undefined, host);

			const scalar = async (sql: string): Promise<number> => {
				const rows = await host.select(sql);
				return Number(rows[0]?.value);
			};
			const version = await scalar('SELECT MAX(version) AS value FROM schema_migrations');
			const sessions = await scalar('SELECT COUNT(*) AS value FROM sessions');
			const attempts = await scalar('SELECT COUNT(*) AS value FROM attempts');
			const corrections = await scalar('SELECT COUNT(*) AS value FROM corrections');
			if (version !== 12) throw new Error(`fixture migrated to schema ${version}, expected 12`);
			if (sessions !== 2 || attempts !== 3 || corrections !== 1) {
				throw new Error(
					`fixture rows changed: ${sessions} sessions, ${attempts} attempts, ${corrections} corrections`
				);
			}
			return `v9→${version} · ${sessions} sessions · ${attempts} attempts`;
		} finally {
			db.close();
		}
	}

	onMount(() => {
		if (!import.meta.env.DEV || coreBackend !== 'core') {
			status = 'skipped';
			return;
		}
		status = 'running';

		void (async () => {
			try {
				const fixture = await checkFixtureMigration();

				const client = await getCoreClient();

				// `settings.load`/`settings.patch` drive the typed document. Toggle a
				// preference and put it back so the check is repeatable and the
				// normalised core document (not the raw rows) is what the store sees.
				const loaded = await client.command<{ settings: { showWordPos: boolean } }>(
					'settings.load'
				);
				if (typeof loaded.settings.showWordPos !== 'boolean') {
					throw new Error('settings.load did not return a typed document');
				}
				const patched = await client.command<{
					settings: { showWordPos: boolean };
					changed: boolean;
				}>('settings.patch', {
					patch: { showWordPos: JSON.stringify(!loaded.settings.showWordPos) }
				});
				if (!patched.changed || patched.settings.showWordPos === loaded.settings.showWordPos) {
					throw new Error('settings.patch did not apply the changed field');
				}
				const restored = await client.command<{ changed: boolean }>('settings.patch', {
					patch: { showWordPos: JSON.stringify(loaded.settings.showWordPos) }
				});
				if (!restored.changed) throw new Error('settings.patch did not restore the field');

				const key = 'onspot.dev.storage-check';
				// A reload keeps OPFS and this browser's storage: seeing the value
				// written by the previous load proves settings survive a restart.
				const before = await client.command<{ value: string | null }>('settings.get', { key });
				const persisted = before.value === JSON.stringify('done');
				await client.command('settings.set', { key, value: JSON.stringify('ok') });
				const read = await client.command<{ value: string | null }>('settings.get', { key });
				if (read.value !== '"ok"') throw new Error(`settings.get returned ${read.value}`);

				await client.command('settings.set', { key, value: JSON.stringify('done') });
				const listed = await client.command<{ settings: { key: string; value: string }[] }>(
					'settings.list'
				);
				if (!listed.settings.some((row) => row.key === key && row.value === '"done"')) {
					throw new Error('settings.list did not return the written row');
				}

				const history = await client.command<{ sessions: unknown[] }>('history.list');
				if (!Array.isArray(history.sessions)) throw new Error('history.list did not return a list');

				// Write a synthetic session through the legacy adapter, then rename and
				// delete it through the bridge; the row must be gone afterwards.
				const db = await getDatabaseAdapter();
				const sessionId = 'dev-storage-check';
				const now = new Date().toISOString();
				await db.putSession({
					id: sessionId,
					title: 'Storage check',
					mode: 'casual',
					startedAt: now,
					endedAt: null,
					createdAt: now,
					updatedAt: now,
					setup: null
				});
				await client.command('history.rename', { sessionId, title: 'Storage check renamed' });
				const renamed = await client.command<{ sessions: { session: { id: string; title: string } }[] }>(
					'history.list'
				);
				if (
					!renamed.sessions.some(
						(entry) => entry.session.id === sessionId && entry.session.title === 'Storage check renamed'
					)
				)
					throw new Error('history.rename did not reach the database');
				await client.command('history.delete', { sessionId });
				const deleted = await client.command<{ sessions: { session: { id: string } }[] }>(
					'history.list'
				);
				if (deleted.sessions.some((entry) => entry.session.id === sessionId))
					throw new Error('history.delete did not remove the session');

				const search = await client.command<{ sessions: unknown[] }>('history.search', {
					query: '^x',
					regex: true,
					caseSensitive: false
				});
				if (!Array.isArray(search.sessions)) throw new Error('history.search did not return a list');

				// I3 regression: a BYOK key lives in browser storage and must not be
				// reachable through settings or appear in a whole-database export.
				const secretKey = 'onspot.key.dev-check';
				localStorage.setItem(secretKey, 'secret-value');
				const secret = await client.command<{ value: string | null }>('settings.get', {
					key: secretKey
				});
				if (secret.value !== null) throw new Error('a secret surfaced through settings.get');
				const dump = new TextDecoder().decode(await db.export());
				if (dump.includes('secret-value')) throw new Error('a secret leaked into the database export');
				localStorage.removeItem(secretKey);

				// P7: the planner returns plain numbers (not BigInt) and the
				// catalog sizes reach the driver in the shape the bar consumes.
				const plan = await client.command<{
					pending: { stt: number; voice: number; storage: number };
					ready: boolean;
				}>('language.plan', {
					input: {
						languageId: 'fr',
						instructionLanguageId: 'en',
						native: false,
						required: { stt: true, voice: true, explanationVoice: false },
						installed: { stt: false, voice: false, explanationVoice: true },
						voiceId: null,
						explanationVoiceId: null
					}
				});
				if (typeof plan.pending.storage !== 'number' || plan.pending.storage <= 0)
					throw new Error('language.plan returned no numeric pending bytes');
				if (plan.pending.stt <= 0 || plan.pending.voice <= 0)
					throw new Error('language.plan did not size the missing parts');
				if (plan.ready) throw new Error('language.plan called a missing setup ready');

				detail = `${fixture} · ${persisted ? 'persisted · ' : ''}${listed.settings.length} settings · ${history.sessions.length} sessions · plan ${plan.pending.storage} B`;
				status = 'pass';
			} catch (error) {
				status = 'fail';
				detail = error instanceof Error ? error.message : String(error);
			}
		})();
	});
</script>

<aside class="storage-check" data-storage-check={status} data-storage-detail={detail}>
	<strong>storage bridge · {status}</strong>
	{#if detail}<p>{detail}</p>{/if}
</aside>

<style>
	.storage-check {
		position: fixed;
		right: 8px;
		bottom: 8px;
		z-index: 60;
		max-width: min(92vw, 26rem);
		padding: 6px 8px;
		border: 1px solid var(--sheet-line);
		border-radius: 6px;
		background: var(--card);
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.45;
		pointer-events: none;
	}
	.storage-check strong {
		color: var(--foreground);
		font-weight: 600;
	}
	.storage-check p {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
