#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P7 portability and first-run browser check.
 *
 * Covers the walkthroughs that the core unit tests cannot: the driver side of
 * whole-database export/restore, the fresh-database setup guide, and a due
 * reminder reaching the system-notification path.
 *
 * The export/restore leg uses two browser contexts so the "wipe" is real: one
 * context creates a session, exports the database through the core's save host
 * (a browser download), the context is closed, and a fresh context stages the
 * downloaded file through the pick host (a file chooser) and confirms it. The
 * restored history is then read back through the core.
 *
 * Prerequisites: `bun run bridge:wasm`. Set `CHROME_PATH` when Chrome is not in
 * a standard location.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright-core';

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const TRANSCRIPT = 'Bonjour je vais au marché ce matin';
const SESSION_ID = 'portability-check-session';

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

/**
 * Creates a context whose file APIs take the plain download/input path.
 *
 * Headless Chrome has no File System Access API, and removing `showPicker`
 * makes `browser-fs-access` click the hidden input, which Playwright can
 * answer with `filechooser` without a user gesture.
 *
 * @param browser The launched browser.
 * @param options.llmKey Seed a Groq key so a fresh database skips setup.
 */
async function newAppContext(browser, { llmKey = true } = {}) {
	const context = await browser.newContext({
		permissions: ['microphone', 'notifications'],
		acceptDownloads: true
	});
	await context.addInitScript(
		({ withKey }) => {
			if (withKey) localStorage.setItem('onspot.key.llm.groq', 'test-key');
			try {
				// The save/open pickers need user activation and hide behind a native
				// dialog; force browser-fs-access onto the download/input path.
				delete window.showOpenFilePicker;
				delete window.showSaveFilePicker;
				delete HTMLInputElement.prototype.showPicker;
			} catch {
				// Older engines may not expose them.
			}
		},
		{ withKey: llmKey }
	);
	const page = await context.newPage();
	return { context, page };
}

/** Waits for the practice surface (the layout only mounts it after settings). */
async function waitForPractice(page) {
	await page.waitForFunction(
		() => Boolean(document.querySelector('.prompt-text')?.textContent?.trim()),
		undefined,
		{ timeout: 120_000 }
	);
}

/** One session and one take inserted through the app's own database adapter. */
async function seedHistory(page) {
	return page.evaluate(async () => {
		const { getDatabaseAdapter } = await import('/src/lib/adapters/db/index.ts');
		const database = await getDatabaseAdapter();
		const now = new Date().toISOString();
		await database.putSession({
			id: 'portability-check-session',
			title: 'Portability check',
			mode: 'exam',
			startedAt: now,
			endedAt: null,
			createdAt: now,
			updatedAt: now,
			setup: null
		});
		await database.putAttempt({
			id: 'portability-check-attempt',
			sessionId: 'portability-check-session',
			promptId: null,
			promptText: 'Racontez votre matinée au marché.',
			transcript: 'Bonjour je vais au marché ce matin',
			correctedText: 'Bonjour, je vais au marché ce matin.',
			translation: null,
			translations: null,
			ttsVoice: null,
			explanation: null,
			followUp: null,
			wordGlosses: null,
			durationSec: 1.2,
			wordCount: 7,
			audioKey: null,
			createdAt: now,
			updatedAt: now
		});
		return {
			sessions: (await database.listSessions()).length,
			attempts: (await database.listAttempts('portability-check-session')).length
		};
	});
}

/** Exports through the core and captures the browser download. */
async function exportThroughCore(page, destination) {
	const downloadPromise = page
		.waitForEvent('download', { timeout: 60_000 })
		.catch(() => null);
	let outcome;
	try {
		outcome = await page.evaluate(async () => {
			const { exportDatabaseCore } = await import('/src/lib/core-client/export.ts');
			return exportDatabaseCore();
		});
	} catch (error) {
		throw new Error(`the core export failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const download = await downloadPromise;
	if (!download) {
		throw new Error(`the core export returned ${JSON.stringify(outcome)} but no download started`);
	}
	await download.saveAs(destination);
	return download.suggestedFilename();
}

/** Picks and confirms a backup through the core, answering the file chooser. */
async function restoreThroughCore(page, backupPath) {
	const chooserPromise = page.waitForEvent('filechooser', { timeout: 60_000 });
	const pickPromise = page.evaluate(async () => {
		const { restorePickCore, restoreConfirmCore } = await import(
			'/src/lib/core-client/export.ts'
		);
		const picked = await restorePickCore();
		return { picked, restored: picked.fileName ? await restoreConfirmCore() : null };
	});
	const chooser = await chooserPromise;
	await chooser.setFiles(backupPath);
	return pickPromise;
}

/** Exports, wipes and restores one database. */
async function exportRestoreCheck(browser, profile) {
	let first = await newAppContext(browser);
	try {
		await first.page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await waitForPractice(first.page);

		const seeded = await seedHistory(first.page);
		if (seeded.sessions !== 1 || seeded.attempts !== 1) {
			throw new Error(`the fixture history was not written: ${JSON.stringify(seeded)}`);
		}

		const backupPath = join(profile, 'onspot-backup.sqlite');
		const fileName = await exportThroughCore(first.page, backupPath);
		const bytes = readFileSync(backupPath);
		if (!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3\0')) {
			throw new Error(`the exported file is not SQLite: ${fileName}`);
		}
		if (bytes.includes(Buffer.from('test-key'))) {
			throw new Error('the exported database contains the driver secret');
		}
	} finally {
		await first.context.close();
	}

	const second = await newAppContext(browser);
	try {
		await second.page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await waitForPractice(second.page);

		const before = await second.page.evaluate(async () => {
			const { getCoreClient } = await import('/src/lib/core-client/client.ts');
			const client = await getCoreClient();
			const history = await client.command('history.list', null);
			return history.sessions.length;
		});
		if (before !== 0) throw new Error('the fresh context was not empty before restoring');

		const restore = await restoreThroughCore(second.page, join(profile, 'onspot-backup.sqlite'));
		if (!restore.picked.fileName) throw new Error('the core did not stage the picked backup');
		if (restore.restored.sessions !== 1 || restore.restored.attempts !== 1) {
			throw new Error(`the restore counts were unexpected: ${JSON.stringify(restore)}`);
		}

		const restored = await second.page.evaluate(async (sessionId) => {
			const { getCoreClient } = await import('/src/lib/core-client/client.ts');
			const client = await getCoreClient();
			const history = await client.command('history.list', null);
			const markdown = await client.command('export.session_markdown', { sessionId });
			return { sessions: history.sessions.length, markdown: markdown.markdown };
		}, SESSION_ID);

		if (restored.sessions !== 1 || !restored.markdown.includes('Bonjour je vais au marché ce matin')) {
			throw new Error(`the restored history is incomplete: ${JSON.stringify(restored).slice(0, 500)}`);
		}
	} finally {
		await second.context.close();
	}
}

/** Skips the setup guide on a fresh database and proves the redirect stops. */
async function onboardingCheck(browser) {
	const { context, page } = await newAppContext(browser, { llmKey: false });
	try {
		await page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await page.waitForURL((url) => url.pathname.endsWith('/welcome/'), { timeout: 60_000 });
		await page.getByRole('button', { name: /Skip for now/ }).click();
		await page.waitForURL((url) => !url.pathname.includes('/welcome'), { timeout: 60_000 });

		const result = await page.evaluate(async () => {
			const { shouldOfferOnboarding } = await import('/src/lib/onboarding.ts');
			return {
				stored: localStorage.getItem('onspot.onboarding.v1'),
				offers: await shouldOfferOnboarding()
			};
		});
		if (result.stored !== 'skipped' || result.offers) {
			throw new Error(`the setup guide did not stay dismissed: ${JSON.stringify(result)}`);
		}
	} finally {
		await context.close();
	}
}

/** Makes a reminder due and proves a system notification is constructed. */
async function reminderCheck(browser) {
	const { context, page } = await newAppContext(browser, { llmKey: false });
	try {
		await page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await page.waitForURL((url) => url.pathname.endsWith('/welcome/'), { timeout: 60_000 });

		const result = await page.evaluate(async () => {
			const notifications = [];
			class FakeNotification {
				static permission = 'granted';
				constructor(title, options) {
					notifications.push({ title, body: options?.body ?? '' });
				}
				static requestPermission() {
					return Promise.resolve('granted');
				}
			}
			Object.defineProperty(window, 'Notification', {
				configurable: true,
				value: FakeNotification
			});
			Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
			localStorage.setItem(
				'onspot.reminder.practisedAt',
				new Date(Date.now() - 2 * 86_400_000).toISOString()
			);

			const { appSettings } = await import('/src/lib/stores/settings.ts');
			let current;
			const stopSettings = appSettings.subscribe((value) => (current = value));
			stopSettings();
			appSettings.set({ ...current, practiceReminders: true, reminderFrequency: 'frequent' });

			const { reminders, refreshReminders } = await import('/src/lib/stores/reminders.ts');
			// The boot check may still be in flight; the second call runs after it.
			await refreshReminders();
			await new Promise((resolve) => setTimeout(resolve, 300));
			await refreshReminders();

			let state;
			const stopReminders = reminders.subscribe((value) => (state = value));
			stopReminders();
			return { state, notifications };
		});

		if (!result.state.due || !result.state.nextAt) {
			throw new Error(`the reminder was not due: ${JSON.stringify(result.state)}`);
		}
		if (result.notifications.length === 0) {
			throw new Error('a due reminder did not construct a system notification');
		}
	} finally {
		await context.close();
	}
}

if (!existsSync('static/core-bridge/onspot_bridge.js')) {
	console.error('Missing static/core-bridge/onspot_bridge.js — run `bun run bridge:wasm` first.');
	process.exit(1);
}

const server = spawn(
	'bun',
	['run', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
	{
		env: { ...process.env, VITE_CORE_BACKEND: 'core' },
		stdio: ['ignore', 'pipe', 'pipe']
	}
);
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const profile = mkdtempSync(join(tmpdir(), 'onspot-portability-check-'));
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({
		executablePath: chromePath(),
		headless: true,
		args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
	});

	await exportRestoreCheck(browser, profile);
	console.log('export → wipe → restore: history intact');
	await onboardingCheck(browser);
	console.log('fresh-database setup guide: skipped and stays dismissed');
	await reminderCheck(browser);
	console.log('reminder: due state reached the system-notification path');
	console.log(`portability check passed (${TRANSCRIPT.length} character transcript restored)`);
} catch (error) {
	console.error(String(error));
	if (serverLog) console.error(serverLog.slice(-4_000));
	process.exitCode = 1;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	rmSync(profile, { recursive: true, force: true });
}
