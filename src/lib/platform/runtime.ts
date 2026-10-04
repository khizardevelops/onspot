/**
 * Which build the app is running in. The desktop and Android apps are Tauri
 * webviews; anything else is the browser build.
 */
export type Runtime = 'desktop' | 'android' | 'web';

export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function currentRuntime(): Runtime {
	if (!isTauri()) return 'web';
	return /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
}
