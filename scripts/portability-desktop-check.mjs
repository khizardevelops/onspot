#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P7 portability desktop check.
 *
 * Drives the real release app under Xvfb/WebKitWebDriver, clicks the Settings
 * Data buttons, and answers the native GTK Save/Open dialogs with xdotool:
 * export the database, close nothing (the same profile is restored), pick the
 * exported file, confirm the replace, and read the history back. This is the
 * dialog path the browser check cannot cover and the capability bug that made
 * **Restore .sqlite** do nothing (`dialog:allow-open` was missing).
 *
 * Prerequisites: `bunx tauri build --no-bundle`, `WebKitWebDriver`, `Xvfb` and
 * `xdotool`. It uses display `:98` and driver port `4457`, so it can run beside
 * `test:sync:desktop` (`:99`/`4455`).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const WEBDRIVER_PORT = 4457;
const DISPLAY = ':98';
const APP = resolve('target/release/onspot');
const BASE = `http://127.0.0.1:${WEBDRIVER_PORT}`;
const PROFILE = mkdtempSync(join(tmpdir(), 'onspot-portability-desktop-'));
const BACKUP_DIR = join(PROFILE, 'export');
const BACKUP_NAME = join(BACKUP_DIR, 'desktop-export');

function childEnvironment() {
	const env = {
		...process.env,
		DISPLAY,
		GDK_BACKEND: 'x11',
		TAURI_WEBVIEW_AUTOMATION: 'true',
		WEBKIT_DISABLE_DMABUF_RENDERER: '1',
		XDG_CONFIG_HOME: join(PROFILE, 'config'),
		XDG_DATA_HOME: join(PROFILE, 'data'),
		XDG_CACHE_HOME: join(PROFILE, 'cache')
	};
	delete env.WAYLAND_DISPLAY;
	return env;
}

async function webdriver(method, path, body, timeoutMs = 60_000) {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	const raw = await response.text();
	const reply = (() => {
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	})();

	if (!response.ok || reply.value?.error) {
		throw new Error(`webdriver ${method} ${path} failed (HTTP ${response.status}): ${raw.slice(0, 800)}`);
	}
	return reply.value;
}

async function waitForWebdriver() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(`${BASE}/status`);
			if (response.ok) return;
		} catch {
			// still starting
		}
		await Bun.sleep(250);
	}
	throw new Error('WebKitWebDriver did not start');
}

/** Runs one async WebDriver script, tolerating the unload of a navigation. */
async function execute(sessionId, script, tolerateUnload = false) {
	try {
		const value = await webdriver(
			'POST',
			`/session/${sessionId}/execute/async`,
			{ script, args: [] },
			180_000
		);
		return value;
	} catch (error) {
		if (tolerateUnload && /no such window|unload/i.test(String(error))) return null;
		throw error;
	}
}

/** xdotool on the Xvfb display. */
function xdotool(args) {
	return spawnSync('xdotool', args, {
		env: { ...process.env, DISPLAY },
		encoding: 'utf8'
	});
}

/** Visible windows on the display, with their names. */
function windows() {
	const ids = xdotool(['search', '--onlyvisible', '--name', '.*'])
		.stdout.trim()
		.split('\n')
		.filter(Boolean);
	return ids.map((id) => ({
		id,
		name: xdotool(['getwindowname', id]).stdout.trim()
	}));
}

async function waitForWindow(pattern, timeoutMs = 15_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const found = windows().find((window) => pattern.test(window.name));
		if (found) return found;
		await Bun.sleep(250);
	}
	return null;
}

/**
 * Focuses a native dialog without a window manager.
 *
 * A bare Xvfb has no WM, so `windowactivate` leaves the focus on the app and
 * the keys never reach the chooser; `windowfocus` sets the X input focus.
 */
function focusWindow(window) {
	xdotool(['windowraise', window.id]);
	xdotool(['windowfocus', '--sync', window.id]);
	const focused = xdotool(['getwindowfocus']).stdout.trim();
	if (focused !== window.id) {
		throw new Error(`could not focus ${window.name} (${window.id}), focus is ${focused}`);
	}
}

/** Types a path into the GTK chooser's location bar and accepts it. */
async function choosePath(window, path, extraReturn) {
	focusWindow(window);
	xdotool(['key', '--clearmodifiers', 'ctrl+l']);
	await Bun.sleep(300);
	xdotool(['type', '--delay', '20', path]);
	await Bun.sleep(200);
	xdotool(['key', '--clearmodifiers', 'Return']);
	await Bun.sleep(800);
	if (extraReturn) {
		xdotool(['key', '--clearmodifiers', 'Return']);
		await Bun.sleep(500);
	}
}

/** Clicks a button by its visible text in the app page. */
function clickButtonScript(predicate) {
	return `
const done = arguments[arguments.length - 1];
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const button = Array.from(document.querySelectorAll('button')).find(${predicate});
    if (button) {
      button.click();
      return done({ clicked: true });
    }
    await wait(250);
  }
  done({ clicked: false, text: document.body.innerText.slice(0, 600) });
})();`;
}

const DATA_TAB = clickButtonScript(
	'(button) => (button.textContent || "").trim() === "Data"'
);
const EXPORT = clickButtonScript(
	'(button) => /Export \\.sqlite/.test(button.textContent || "")'
);
const RESTORE = `
const done = arguments[arguments.length - 1];
const button = document.querySelector('.restore-db-button');
if (!button) done({ clicked: false });
else {
  button.click();
  done({ clicked: true });
}`;
const CONFIRM = clickButtonScript('(button) => /Replace database/.test(button.textContent || "")');

let xvfb = null;
let driver = null;
let sessionId = null;

try {
	if (!existsSync(APP)) {
		throw new Error(`Missing ${APP} — run \`bunx tauri build --no-bundle\` first.`);
	}
	mkdirSync(BACKUP_DIR, { recursive: true });
	for (const directory of ['config', 'data', 'cache', join('config', 'app.onspot.desktop')]) {
		mkdirSync(join(PROFILE, directory), { recursive: true });
	}

	const env = childEnvironment();
	xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '1400x1100x24'], { stdio: 'ignore' });
	await Bun.sleep(800);
	driver = spawn('/usr/bin/WebKitWebDriver', [`--port=${WEBDRIVER_PORT}`], {
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let driverLog = '';
	driver.stdout.on('data', (chunk) => (driverLog += chunk));
	driver.stderr.on('data', (chunk) => (driverLog += chunk));

	try {
		await waitForWebdriver();
		const session = await webdriver(
			'POST',
			'/session',
			{ capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary: APP, args: [] } } } },
			120_000
		);
		sessionId = session.sessionId;
		await webdriver('POST', `/session/${sessionId}/timeouts`, {
			implicit: 0,
			pageLoad: 300_000,
			script: 180_000
		});
	} catch (error) {
		throw new Error(`${error.message}\n${driverLog.slice(-1_500)}`);
	}

	const openSettings = `
const done = arguments[arguments.length - 1];
(async () => {
  localStorage.setItem('onspot.key.llm.groq', 'test-key');
  localStorage.setItem('onspot.onboarding.v1', 'skipped');
  location.assign('/settings');
  done({});
})();`;
	await execute(sessionId, openSettings, true).catch(() => undefined);
	await Bun.sleep(2_500);

	const tab = await execute(sessionId, DATA_TAB);
	if (!tab?.clicked) throw new Error(`the Data settings tab did not appear: ${JSON.stringify(tab)}`);

	// A setting the export will carry and the restore must bring back. The app's
	// in-memory store is not touched, so the value is a property of the file.
	const writeSetting = (value) => `const done = arguments[arguments.length - 1];
(async () => {
  const result = await window.__TAURI_INTERNALS__.invoke('core_command', {
    cmd: 'settings.set',
    payload: { key: 'onspot.setting.showWordPos', value: '"${value}"' }
  });
  done({ result });
})();`;
	await execute(sessionId, writeSetting('true'));
	await Bun.sleep(300);

	// Export through the real button and the native save dialog.
	const exportClick = await execute(sessionId, EXPORT);
	if (!exportClick?.clicked) throw new Error(`the export button did not appear: ${JSON.stringify(exportClick)}`);
	const saveDialog = await waitForWindow(/Save File/i);
	if (!saveDialog) throw new Error('the native save dialog did not open');
	await choosePath(saveDialog, BACKUP_NAME, true);
	await Bun.sleep(1_200);

	const backup = [BACKUP_NAME, `${BACKUP_NAME}.sqlite`].find((candidate) => existsSync(candidate));
	if (!backup) throw new Error('the native save dialog did not write a file');
	const bytes = readFileSync(backup);
	if (!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3\0')) {
		throw new Error(`the saved file is not SQLite: ${backup}`);
	}

	// Restore through the real button, the native open dialog and the confirm.
	await execute(sessionId, writeSetting('false'));
	await Bun.sleep(300);

	// Restore through the real button, the native open dialog and the confirm.
	const restoreClick = await execute(sessionId, RESTORE);
	if (!restoreClick?.clicked) throw new Error(`the restore button did not appear: ${JSON.stringify(restoreClick)}`);
	const openDialog = await waitForWindow(/Open File/i);
	if (!openDialog) throw new Error('the native open dialog did not open');
	await choosePath(openDialog, backup, false);

	const confirm = await execute(sessionId, CONFIRM);
	if (!confirm?.clicked) throw new Error(`the restore confirmation did not appear: ${JSON.stringify(confirm)}`);
	await Bun.sleep(2_500);

	const result = await execute(
		sessionId,
		`const done = arguments[arguments.length - 1]; (async () => {
		  const history = await window.__TAURI_INTERNALS__.invoke('core_command', { cmd: 'history.list', payload: null });
		  const settings = await window.__TAURI_INTERNALS__.invoke('core_command', { cmd: 'settings.list', payload: null });
		  const marker = settings.settings.find((row) => row.key === 'onspot.setting.showWordPos');
		  done({ sessions: history.sessions.length, marker: marker?.value ?? null });
		})();`
	);
	if (result.sessions !== 0) {
		throw new Error(`the restored history was unexpected: ${JSON.stringify(result)}`);
	}
	if (result.marker !== '"true"') {
		throw new Error(`the restored setting was not the exported one: ${JSON.stringify(result)}`);
	}

	console.log(
		`desktop portability check passed: native save (${bytes.length} bytes) → native open → confirm → restore (marker restored)`
	);
} catch (error) {
	console.error(String(error));
	process.exitCode = 1;
} finally {
	if (sessionId) await webdriver('DELETE', `/session/${sessionId}`).catch(() => undefined);
	driver?.kill('SIGTERM');
	xvfb?.kill('SIGTERM');
	rmSync(PROFILE, { recursive: true, force: true });
}
