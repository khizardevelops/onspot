#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P2 browser contract check.
 *
 * Starts the dev server with the core backend selected, opens the app in real
 * Chrome and waits for the dev-only `CoreStorageCheck` readout: the wasm bridge
 * boots, the Rust migration runs over the SQLite worker, and `settings.*` /
 * `history.*` round-trip. Uses a fresh browser profile, so OPFS starts empty.
 *
 * Prerequisites: `bun run bridge:wasm` (the package is gitignored). Set
 * `CHROME_PATH` when Chrome is not in a standard location.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright-core';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;

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

if (!existsSync('static/core-bridge/onspot_bridge.js')) {
	console.error('Missing static/core-bridge/onspot_bridge.js — run `bun run bridge:wasm` first.');
	process.exit(1);
}

const server = spawn('bun', ['run', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
	env: { ...process.env },
	stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const profile = mkdtempSync(join(tmpdir(), 'onspot-storage-check-'));
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({ executablePath: chromePath(), headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(BASE, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('[data-storage-check="pass"], [data-storage-check="fail"]', {
		timeout: 120_000
	});

	const result = await page.$eval('[data-storage-check]', (element) => ({
		status: element.getAttribute('data-storage-check'),
		detail: element.getAttribute('data-storage-detail')
	}));

	if (result.status !== 'pass') {
		throw new Error(`storage check ${result.status}: ${result.detail || 'no detail'}`);
	}

	// Reload: settings written by the first load must still be there, and the
	// history write/rename/delete cycle must work on the reopened connection.
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForSelector('[data-storage-check="pass"], [data-storage-check="fail"]', {
		timeout: 120_000
	});
	const reloaded = await page.$eval('[data-storage-check]', (element) => ({
		status: element.getAttribute('data-storage-check'),
		detail: element.getAttribute('data-storage-detail')
	}));
	if (reloaded.status !== 'pass' || !reloaded.detail?.includes('persisted')) {
		throw new Error(`settings did not survive reload: ${reloaded.status} ${reloaded.detail ?? ''}`);
	}
	if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
	console.log(`storage bridge pass · ${result.detail} · reload persisted`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	console.error(serverLog.split('\n').slice(-12).join('\n'));
	process.exitCode = 1;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	rmSync(profile, { recursive: true, force: true });
}
