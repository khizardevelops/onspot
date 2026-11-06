// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Progressive Web App plumbing: service-worker registration and updates, and
 * the iPhone/iPad install state. `Runtime` still means *which build* this is;
 * "an Apple touch device in a browser" is a display context, not a fourth
 * runtime, so it lives here instead of overloading `runtime.ts`.
 */
import { resolve } from '$app/paths';
import { writable } from 'svelte/store';
import { currentRuntime, isTauri } from './runtime';

/** The app root with its trailing slash (`/` or `/onspot/`), never `./`. */
const APP_BASE = resolve('/');

/** True when a new service worker is installed and waiting for a reload. */
export const pwaUpdateReady = writable(false);

let registration: ServiceWorkerRegistration | null = null;
let registering = false;

function watchForUpdate(workerRegistration: ServiceWorkerRegistration): void {
	workerRegistration.addEventListener('updatefound', () => {
		const worker = workerRegistration.installing;
		if (!worker) return;

		worker.addEventListener('statechange', () => {
			// A worker installed while this page is controlled is an update, not
			// the first install; the first one must not prompt for a reload.
			if (worker.state === 'installed' && navigator.serviceWorker.controller) {
				pwaUpdateReady.set(true);
			}
		});
	});
}

/**
 * Registers the production service worker. It is deliberately skipped in the
 * dev server (a stale shell would hide the author's edits), in every Tauri
 * build, and wherever the browser has no service-worker support.
 */
export async function registerPwa(): Promise<void> {
	if (import.meta.env.DEV || registering || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
		return;
	}
	if (currentRuntime() !== 'web') return;

	registering = true;
	try {
		// Reuse the existing registration: registering again on every deep link
		// makes the browser fetch the script (and fail offline) for no reason.
		const existing = await navigator.serviceWorker.getRegistration();
		if (existing) {
			registration = existing;
			watchForUpdate(existing);
			if (existing.waiting && navigator.serviceWorker.controller) pwaUpdateReady.set(true);
			return;
		}

		// Absolute URLs: a base-path build plus a relative resolve would otherwise
		// register `/history/service-worker.js` on a deep link.
		const scriptUrl = new URL(`${APP_BASE}service-worker.js`, location.origin).href;
		const scopeUrl = new URL(APP_BASE, location.origin).href;
		registration = await navigator.serviceWorker.register(scriptUrl, {
			scope: scopeUrl
		});
		watchForUpdate(registration);

		// A worker left waiting by an earlier visit is still an update.
		if (registration.waiting && navigator.serviceWorker.controller) pwaUpdateReady.set(true);
	} catch (error) {
		console.warn('[pwa] service worker registration failed', error);
		registering = false;
	}
}

/**
 * Activates the waiting worker and reloads once it controls this page. Call
 * only from the update prompt's Reload action, never automatically: a swap in
 * the middle of a recording or a feedback request would be hostile.
 */
export async function applyPwaUpdate(): Promise<void> {
	const waiting = registration?.waiting ?? (await navigator.serviceWorker.getRegistration())?.waiting;
	if (!waiting) {
		location.reload();
		return;
	}

	let reloading = false;
	const reload = () => {
		if (reloading) return;
		reloading = true;
		location.reload();
	};

	navigator.serviceWorker.addEventListener('controllerchange', reload);
	waiting.postMessage({ type: 'SKIP_WAITING' });
	// A worker that fails to take over must not leave Reload looking dead.
	setTimeout(reload, 3_000);
}

const INSTALL_DISMISSED_KEY = 'onspot.pwa.installDismissed';

/** True on an iPhone or iPad, including iPadOS reporting a Mac user agent. */
export function isAppleTouchDevice(): boolean {
	if (typeof navigator === 'undefined') return false;

	const touchMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
	return touchMac || /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** True when the page is running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;

	const installed = (navigator as Navigator & { standalone?: boolean }).standalone === true;
	return installed || matchMedia('(display-mode: standalone)').matches;
}

/** True on an Apple touch device in a browser tab, where installing is still useful. */
export function isIosBrowser(): boolean {
	return !isTauri() && isAppleTouchDevice() && !isStandalone();
}

/** The browser name to name in the install steps. */
export function iosBrowserName(): string {
	if (typeof navigator === 'undefined') return 'your browser';

	const agent = navigator.userAgent;
	if (/CriOS/.test(agent)) return 'Chrome';
	if (/FxiOS/.test(agent)) return 'Firefox';
	if (/EdgiOS/.test(agent)) return 'Edge';
	return 'Safari';
}

/** Whether the learner put the first-run install card away. */
export function iosInstallDismissed(): boolean {
	try {
		return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
	} catch {
		return false;
	}
}

/** Puts the install card away for this device. */
export function dismissIosInstall(): void {
	try {
		localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
	} catch {
		// The card still disappears for this visit.
	}
}

/** Brings the install card back from Settings. */
export function clearIosInstallDismissal(): void {
	try {
		localStorage.removeItem(INSTALL_DISMISSED_KEY);
	} catch {
		// Nothing to clear.
	}
}
