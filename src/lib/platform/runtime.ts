// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which build the app is running in. The desktop, Android and iOS apps are Tauri
 * webviews; anything else is the browser build.
 */
export type Runtime = 'desktop' | 'android' | 'ios' | 'web';

export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function currentRuntime(): Runtime {
	if (!isTauri()) return 'web';
	if (/Android/i.test(navigator.userAgent)) return 'android';
	if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
	return 'desktop';
}
