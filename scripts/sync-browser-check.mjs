#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P7 sync browser check.
 *
 * Starts an in-memory WebDAV server with CORS, boots the wasm bridge in real
 * Chrome and runs the whole-database round trip through the app's own sync
 * service: connect, first upload, no-op second sync, a touched cloud copy that
 * opens the conflict decision, an explicit cloud restore, and a corrupt remote
 * that must be rejected before the device database is replaced.
 *
 * Prerequisites: `bun run bridge:wasm`. Set `CHROME_PATH` when Chrome is not in
 * a standard location.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright-core';
import { startWebdavServer } from './lib/webdav-fixture.mjs';

const PORT = 4323;
const DAV_PORT = 4333;
const BASE = `http://127.0.0.1:${PORT}`;
const DAV = `http://127.0.0.1:${DAV_PORT}/dav`;
const SNAPSHOT_PATH = '/backup/onspot.sqlite';
const DAV_URL = `${DAV}${SNAPSHOT_PATH}`;

function chromePath() {
	const candidates = [
		process.env.CHROME_PATH,
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/opt/google/chrome/chrome',
		'/usr/bin/chromium',
		'/snap/bin/chromium'
	].filter(Boolean);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error('Chrome not found; set CHROME_PATH.');
	return found;
}


function waitForServer(timeoutMs = 60_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tick = async () => {
			try {
				const response = await fetch(BASE);
				if (response.ok) return resolve();
			} catch {
				// not listening yet
			}
			if (Date.now() - started > timeoutMs) return reject(new Error('dev server did not start'));
			setTimeout(tick, 300);
		};
		void tick();
	});
}

let credentials = null;

async function remoteBytes() {
	const response = await fetch(DAV_URL, { headers: { authorization: credentials } });
	if (!response.ok) throw new Error(`the smoke could not read the remote copy: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function writeRemote(bytes) {
	const response = await fetch(DAV_URL, {
		method: 'PUT',
		headers: { authorization: credentials, 'content-type': 'application/vnd.sqlite3' },
		body: bytes
	});
	if (!response.ok) throw new Error(`the smoke could not write the remote copy: ${response.status}`);
}

function summarize(result) {
	return {
		decision: result.decision,
		completed: result.completed,
		remoteEtag: result.comparison?.remote?.etag ?? null,
		localSize: result.comparison?.localSize ?? null
	};
}

if (!existsSync('static/core-bridge/onspot_bridge.js')) {
	console.error('Missing static/core-bridge/onspot_bridge.js — run `bun run bridge:wasm` first.');
	process.exit(1);
}

const dav = startWebdavServer({ port: DAV_PORT });
credentials = dav.credentials;
const server = spawn(
	'bun',
	['run', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
	{
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe']
	}
);
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const profile = mkdtempSync(join(tmpdir(), 'onspot-sync-check-'));
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({
		executablePath: chromePath(),
		headless: true,
		args: ['--no-sandbox', '--mute-audio']
	});
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const text = message.text();
		const url = message.location()?.url ?? '';
		// The first sync probes a file that does not exist yet, so the browser
		// logs that expected 404 as a failed resource load.
		if (url.includes(`:${DAV_PORT}/`) && text.includes('Failed to load resource')) return;
		errors.push(url ? `${text} (${url})` : text);
	});

	await page.goto(BASE, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(
		() => Boolean(document.querySelector('.prompt-text')?.textContent?.trim()),
		undefined,
		{ timeout: 120_000 }
	);

	const setup = await page.evaluate(
		async ({ davUrl, username, password }) => {
			const settings = await import('/src/lib/stores/settings.ts');
			let current;
			const stop = settings.appSettings.subscribe((value) => (current = value));
			stop();
			settings.appSettings.set({
				...current,
				syncProvider: 'webdav',
				webdavUrl: davUrl,
				webdavPath: '/backup/onspot.sqlite'
			});
			const secrets = await import('/src/lib/stores/secrets.ts');
			secrets.webdavUsername.set(username);
			secrets.webdavPassword.set(password);

			const sync = await import('/src/lib/adapters/sync/index.ts');
			const provider = sync.createSyncProvider('webdav');
			if (!provider) throw new Error('the app did not create a WebDAV provider');
			const connected = await provider.connect();
			const first = await sync.syncNow(provider);
			const second = await sync.syncNow(provider);
			globalThis.__onspotSyncProvider = provider;
			globalThis.__onspotSyncNow = sync.syncNow;
			return { connected: connected.label, first, second };
		},
		{ davUrl: DAV, username: 'tester', password: 'secret' }
	);

	if (setup.first.decision !== 'upload' || !setup.first.completed) {
		throw new Error(`the first sync did not upload: ${JSON.stringify(setup.first)}`);
	}
	if (setup.second.decision !== 'up-to-date' || setup.second.completed) {
		throw new Error(`the second sync was not a no-op: ${JSON.stringify(setup.second)}`);
	}
	if (setup.connected !== `127.0.0.1:${DAV_PORT}`) {
		throw new Error(`the WebDAV label was unexpected: ${setup.connected}`);
	}

	// A second device rewrites the same bytes (the etag changes, content does
	// not), and this device writes a session, so both sides diverged.
	await writeRemote(await remoteBytes());
	await page.evaluate(async () => {
		const { getDatabaseAdapter } = await import('/src/lib/adapters/db/index.ts');
		const database = await getDatabaseAdapter();
		const now = new Date().toISOString();
		await database.putSession({
			id: 'diverged-local-session',
			title: 'Diverged local edit',
			mode: 'exam',
			startedAt: now,
			endedAt: null,
			createdAt: now,
			updatedAt: now,
			setup: null
		});
	});

	const conflict = await page.evaluate(async () => {
		const now = globalThis.__onspotSyncNow;
		const provider = globalThis.__onspotSyncProvider;
		const decision = await now(provider);
		const applied = await now(provider, 'download');
		return { decision, applied };
	});

	if (conflict.decision.decision !== 'needs-choice' || conflict.decision.completed) {
		throw new Error(`a touched cloud copy did not ask: ${JSON.stringify(conflict.decision)}`);
	}
	if (conflict.applied.decision !== 'download' || !conflict.applied.completed) {
		throw new Error(`the cloud restore did not run: ${JSON.stringify(conflict.applied)}`);
	}

	const healthy = await page.evaluate(async () => {
		const { getDatabaseAdapter } = await import('/src/lib/adapters/db/index.ts');
		const database = await getDatabaseAdapter();
		const metadata = await database.getSyncMetadata('webdav');
		const bytes = await database.exportSqliteFile();
		return { bytes: bytes.byteLength, etag: metadata?.etag ?? null, sessions: (await database.listSessions()).length };
	});
	if (healthy.bytes <= 0) throw new Error('the restored database is empty');
	if (healthy.sessions !== 0) throw new Error(`the cloud restore did not replace the diverged local edit: ${JSON.stringify(healthy)}`);
	if (healthy.etag !== conflict.applied.comparison.remote.etag) {
		throw new Error(`the restored revision was not recorded: ${JSON.stringify(healthy)}`);
	}

	await writeRemote(new TextEncoder().encode('definitely not a database'));

	const corrupt = await page.evaluate(async () => {
		const now = globalThis.__onspotSyncNow;
		const provider = globalThis.__onspotSyncProvider;
		let message = null;
		try {
			await now(provider, 'download');
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		const { getDatabaseAdapter } = await import('/src/lib/adapters/db/index.ts');
		const database = await getDatabaseAdapter();
		const bytes = await database.exportSqliteFile();
		return { message, bytes: bytes.byteLength };
	});

	if (!corrupt.message || !/not a SQLite/i.test(corrupt.message)) {
		throw new Error(`a corrupt remote copy was not rejected: ${JSON.stringify(corrupt)}`);
	}
	if (corrupt.bytes <= 0) throw new Error('the rejected restore left no local database');

	if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);

	console.log(
		`sync check passed: connect ${setup.connected}, upload → no-op → diverged conflict (local edit discarded) → restore, corrupt remote rejected`
	);
} catch (error) {
	console.error(String(error));
	if (serverLog) console.error(serverLog.slice(-4_000));
	process.exitCode = 1;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	dav.stop();
	rmSync(profile, { recursive: true, force: true });
}
