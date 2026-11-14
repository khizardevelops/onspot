#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P7 sync desktop check.
 *
 * Launches the release Tauri app on a throwaway profile under Xvfb, drives it
 * through WebKitWebDriver and runs the whole-database round trip against an
 * in-memory WebDAV server: connect, first upload (native SQLite image), a no-op
 * second sync, a touched cloud copy that asks, an explicit cloud restore
 * (rusqlite online backup), and a foreign remote that must be refused before it
 * reaches the device database.
 *
 * This drives the bridge commands directly, so it covers what the web check
 * cannot: the Tauri host shims, the native `DatabaseFile`, and the plugin HTTP
 * transport. `useCore('sync')` wiring itself is shared TypeScript and is
 * exercised by `bun run test:sync`.
 *
 * Prerequisites: `bunx tauri build --no-bundle` and WebKitWebDriver
 * (`/usr/bin/WebKitWebDriver`). No extra npm packages.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { startWebdavServer } from './lib/webdav-fixture.mjs';

const WEBDRIVER_PORT = 4455;
const DAV_PORT = 4334;
const DISPLAY = ':99';
const APP = resolve('target/release/onspot');
const DAV = `http://127.0.0.1:${DAV_PORT}/dav`;
const SNAPSHOT_PATH = '/backup/onspot.sqlite';
const DAV_URL = `${DAV}${SNAPSHOT_PATH}`;
const WEBDRIVER = `http://127.0.0.1:${WEBDRIVER_PORT}`;

async function displayAnswers() {
	'use strict';
	const probe = spawn('/usr/bin/xdpyinfo', ['-display', DISPLAY], { stdio: 'ignore' });
	return new Promise((done) => probe.on('exit', (code) => done(code === 0)));
}

async function webdriver(method, path, body, timeoutMs = 30_000) {
	const response = await fetch(`${WEBDRIVER}${path}`, {
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
		throw new Error(
			`webdriver ${method} ${path} failed (HTTP ${response.status}): ${(raw || 'empty body').slice(0, 800)}`
		);
	}

	return reply.value;
}

async function waitForWebdriver(timeoutMs = 30_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`${WEBDRIVER}/status`);
			if (response.ok) return;
		} catch {
			// the driver is still starting
		}
		await Bun.sleep(250);
	}
	throw new Error('WebKitWebDriver did not start');
}

/** Opens a session for the app using `webkitgtk:browserOptions.binary`. */
async function openSession() {
	// WebKitWebDriver matches a `webkitgtk:browserOptions.binary` session by
	// launching that binary; if the W3C `alwaysMatch` form is rejected it falls
	// back to the JSON Wire Protocol form next.
	const attempts = [
		{
			'webkitgtk:browserOptions': { binary: APP, args: [] }
		},
		{
			'webkitgtk:browserOptions': { binary: APP }
		}
	];
	let lastError = null;
	for (const capabilities of attempts) {
		let value;
		try {
			value = await webdriver('POST', '/session', { capabilities: { alwaysMatch: capabilities } }, 90_000);
		} catch (error) {
			lastError = error;
			continue;
		}
		if (value == null) {
			continue;
		}
		const sessionId = value.sessionId ?? value['sessionId'];
		if (sessionId) return sessionId;
		lastError = new Error(`no session id in ${JSON.stringify(value)}`);
	}

	throw lastError ?? new Error('WebKitWebDriver refused a session');
}

async function execute(sessionId, script, args = []) {
	const value = await webdriver(
		'POST',
		`/session/${sessionId}/execute/async`,
		{ script, args },
		180_000
	);
	if (value?.error) throw new Error(value.error);
	return value;
}

const READY_SCRIPT = `
const done = arguments[arguments.length - 1];
const deadline = Date.now() + 120000;
let lastError = null;
const describe = (error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
const firstScreenIsShowing = () =>
  Boolean(document.querySelector('.prompt-text')) ||
  /Set up onspot|WELCOME/.test(document.body.innerText);
const tick = async () => {
  try {
    const reply = await window.__TAURI_INTERNALS__.invoke('core_command', {
      cmd: 'core.ping',
      payload: { note: null }
    });
    // Settings hydration awaits the shared core client, so the first screen
    // means the driver host is installed and ready for sync host calls.
    if (reply && reply.appVersion && firstScreenIsShowing()) {
      return done({ ready: true, version: reply.appVersion, bridgeVersion: reply.bridgeVersion, href: location.href });
    }
    lastError = reply && reply.appVersion ? 'waiting for the first screen' : 'core.ping returned ' + JSON.stringify(reply);
  } catch (error) {
    lastError = describe(error);
  }
  if (Date.now() > deadline) return done({ ready: false, href: location.href, lastError, internals: typeof window.__TAURI_INTERNALS__, text: document.body.innerText.slice(0, 400) });
  setTimeout(tick, 300);
};
tick();
`;

const FIRST_RUN_SCRIPT = `
const done = arguments[arguments.length - 1];
const target = arguments[0];
(async () => {
  const invoke = (cmd, payload) => window.__TAURI_INTERNALS__.invoke('core_command', { cmd, payload });
  const describe = (error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
  try {
    const connected = await invoke('sync.connect', target);
    done({ connected });
  } catch (error) {
    done({ error: describe(error) });
  }
})();
`;

const SYNC_SCRIPT = `
const done = arguments[arguments.length - 1];
const target = arguments[0];
(async () => {
  const invoke = (cmd, payload) => window.__TAURI_INTERNALS__.invoke('core_command', { cmd, payload });
  const describe = (error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
  try {
    const first = await invoke('sync.now', { ...target, revision: 0, syncedRevision: null });
    const second = await invoke('sync.now', { ...target, revision: 0, syncedRevision: 0 });
    done({ first, second });
  } catch (error) {
    done({ error: describe(error) });
  }
})();
`;

const RESTORE_SCRIPT = `
const done = arguments[arguments.length - 1];
const target = arguments[0];
(async () => {
  const invoke = (cmd, payload) => window.__TAURI_INTERNALS__.invoke('core_command', { cmd, payload });
  const describe = (error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
  try {
    const conflict = await invoke('sync.now', { ...target, revision: 0, syncedRevision: 0 });
    const applied = await invoke('sync.now', { ...target, revision: 0, syncedRevision: 0, choice: 'download' });
    const ping = await invoke('core.ping', { note: null });
    done({ conflict, applied, ping });
  } catch (error) {
    done({ error: describe(error) });
  }
})();
`;

const FOREIGN_SCRIPT = `
const done = arguments[arguments.length - 1];
const target = arguments[0];
(async () => {
  const invoke = (cmd, payload) => window.__TAURI_INTERNALS__.invoke('core_command', { cmd, payload });
  const describe = (error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error));
  let message = null;
  try {
    await invoke('sync.now', { ...target, revision: 0, syncedRevision: null, choice: 'download' });
  } catch (error) {
    message = describe(error);
  }
  let history = null;
  try {
    history = await invoke('history.list', null);
  } catch (error) {
    history = { error: describe(error) };
  }
  done({ message, sessions: Array.isArray(history?.sessions) ? history.sessions.length : null, historyError: history?.error ?? null });
})();
`;

function summarize(outcome) {
	return {
		decision: outcome.decision,
		completed: outcome.completed,
		replacedLocal: outcome.replacedLocal ?? null,
		remoteEtag: outcome.comparison?.remote?.etag ?? null
	};
}

if (!existsSync(APP)) {
	console.error(`Missing ${APP} — run \`bunx tauri build --no-bundle\` first.`);
	process.exit(1);
}
if (!existsInPath('WebKitWebDriver')) {
	console.error('WebKitWebDriver not found at /usr/bin/WebKitWebDriver.');
	process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'onspot-sync-desktop-'));
for (const directory of ['config', 'data', 'cache', join('config', 'app.onspot.desktop')]) {
	mkdirSync(join(profile, directory), { recursive: true });
}
const env = {
	...process.env,
	DISPLAY,
	GDK_BACKEND: 'x11',
	TAURI_WEBVIEW_AUTOMATION: 'true',
	WEBKIT_DISABLE_DMABUF_RENDERER: '1',
	XDG_CONFIG_HOME: join(profile, 'config'),
	XDG_DATA_HOME: join(profile, 'data'),
	XDG_CACHE_HOME: join(profile, 'cache')
};
delete env.WAYLAND_DISPLAY;

const dav = startWebdavServer({ port: DAV_PORT });
let xvfb = null;
let driver = null;
let sessionId = null;

try {
	if (!await displayAnswers()) {
		xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '1400x900x24'], { stdio: 'ignore' });
		for (let attempt = 0; attempt < 20 && !await displayAnswers(); attempt += 1) {
			await Bun.sleep(250);
		}
		if (!await displayAnswers()) {
			throw new Error('Xvfb did not come up');
		}
	}

	driver = spawn('/usr/bin/WebKitWebDriver', [`--port=${WEBDRIVER_PORT}`], {
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let driverLog = '';
	driver.stdout.on('data', (chunk) => (driverLog += chunk));
	driver.stderr.on('data', (chunk) => (driverLog += chunk));

	try {
		await waitForWebdriver();
		console.log('webdriver ready, opening the app window…');
		sessionId = await openSession();
		console.log(`session ${sessionId} opened`);
		await webdriver('POST', `/session/${sessionId}/timeouts`, {
			implicit: 0,
			pageLoad: 300_000,
			script: 180_000
		});
	} catch (error) {
		throw new Error(`${error.message}\n${driverLog.slice(-1_500)}`);
	}

	const ready = await execute(sessionId, READY_SCRIPT);
	console.log(`app ready: ${JSON.stringify(ready).slice(0, 200)}`);
	if (!ready.ready) {
		throw new Error(`the app did not boot its bridge: ${JSON.stringify(ready)}`);
	}

	const target = {
		provider: 'webdav',
		webdav: {
			baseUrl: DAV,
			path: SNAPSHOT_PATH,
			username: 'tester',
			password: 'secret'
		}
	};

	const first = await execute(sessionId, FIRST_RUN_SCRIPT, [target]);
	if (first.error) throw new Error(`first sync failed: ${first.error}`);
	if (first.connected.label !== `127.0.0.1:${DAV_PORT}`) {
		throw new Error(`the WebDAV label was unexpected: ${JSON.stringify(first.connected)}`);
	}

	const sync = await execute(sessionId, SYNC_SCRIPT, [target]);
	if (sync.error) throw new Error(`the round trip failed: ${sync.error}`);
	if (sync.first.decision !== 'upload' || !sync.first.completed) {
		throw new Error(`the first sync did not upload: ${JSON.stringify(sync.first)}`);
	}
	if (sync.second.decision !== 'up-to-date' || sync.second.completed) {
		throw new Error(`the second sync was not a no-op: ${JSON.stringify(sync.second)}`);
	}

	// Another device rewrites the same bytes: etag changes, content does not.
	const remote = await fetch(DAV_URL, { headers: { authorization: dav.credentials } });
	const bytes = new Uint8Array(await remote.arrayBuffer());
	const touched = await fetch(DAV_URL, {
		method: 'PUT',
		headers: { authorization: dav.credentials, 'content-type': 'application/vnd.sqlite3' },
		body: bytes
	});
	if (!touched.ok) throw new Error(`the smoke could not touch the remote copy: ${touched.status}`);

	const restore = await execute(sessionId, RESTORE_SCRIPT, [target]);
	if (restore.error) throw new Error(`the restore step failed: ${restore.error}`);
	if (restore.conflict.decision !== 'needs-choice' || restore.conflict.completed) {
		throw new Error(`a touched cloud copy did not ask: ${JSON.stringify(restore.conflict)}`);
	}
	if (restore.applied.decision !== 'download' || !restore.applied.completed || !restore.applied.replacedLocal) {
		throw new Error(`the cloud restore did not replace the device: ${JSON.stringify(restore.applied)}`);
	}
	if (!restore.ping?.appVersion) throw new Error('the bridge did not survive the restore');

	const corrupt = await fetch(DAV_URL, {
		method: 'PUT',
		headers: { authorization: dav.credentials, 'content-type': 'application/vnd.sqlite3' },
		body: new TextEncoder().encode('definitely not a database')
	});
	if (!corrupt.ok) throw new Error(`the smoke could not corrupt the remote copy: ${corrupt.status}`);

	const foreign = await execute(sessionId, FOREIGN_SCRIPT, [target]);
	if (!foreign.message || !/sync\.invalid_backup|not an onspot backup|not a SQLite database/.test(foreign.message)) {
		throw new Error(`a foreign cloud copy was not refused: ${JSON.stringify(foreign)}`);
	}
	if (foreign.sessions === null) {
		throw new Error(`the device database is unreadable after the refusal: ${JSON.stringify(foreign)}`);
	}

	console.log(
		`sync desktop check passed: ${ready.version} on ${ready.href}, connect ${first.connected.label}, upload (${summarize(sync.first).remoteEtag}) → no-op → conflict → native restore (${summarize(restore.applied).remoteEtag}), foreign remote refused, ${foreign.sessions} sessions visible`
	);
} catch (error) {
	console.error(String(error));
	process.exitCode = 1;
} finally {
	if (sessionId) {
		await webdriver('DELETE', `/session/${sessionId}`).catch(() => undefined);
	}
	driver?.kill('SIGTERM');
	xvfb?.kill('SIGTERM');
	dav.stop();
	rmSync(profile, { recursive: true, force: true });
}

function existsInPath(binary) {
	return ['/usr/bin', '/usr/local/bin', '/bin'].some((directory) => existsSync(join(directory, binary)));
}
