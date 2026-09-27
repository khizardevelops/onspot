/**
 * Android's system Back button, inside the Tauri app.
 *
 * Tauri's default is "go back in the WebView, or exit when there is no
 * history", so Back with a menu or sheet open on the first screen quit the
 * app. While something closable is open, this registers a Back listener
 * (which suspends that default) and Back closes the topmost open thing. When
 * nothing is open the listener is removed and Android's normal behaviour
 * (previous page, then leave the app) returns. No-op on web and desktop.
 */
import { onBackButtonPress } from '@tauri-apps/api/app';
import type { PluginListener } from '@tauri-apps/api/core';

const isAndroidApp =
	typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);

const stack: Array<() => void> = [];
let listener: Promise<PluginListener> | null = null;

function sync(): void {
	if (!isAndroidApp) return;
	if (stack.length && !listener) {
		listener = onBackButtonPress(() => stack.at(-1)?.()).catch((error) => {
			console.warn('[back] could not listen for the Back button', error);
			listener = null;
			return { unregister: async () => undefined } as unknown as PluginListener;
		});
	} else if (!stack.length && listener) {
		const current = listener;
		listener = null;
		void current.then((handle) => handle.unregister()).catch(() => undefined);
	}
}

/** Pushes a close handler; returns a function that removes it. */
export function pushBackHandler(close: () => void): () => void {
	stack.push(close);
	sync();
	return () => {
		const index = stack.lastIndexOf(close);
		if (index !== -1) stack.splice(index, 1);
		sync();
	};
}

/**
 * Component helper: while `isOpen()` is true, Android Back calls `close()`
 * instead of leaving the page. Call during component initialisation.
 */
export function closeOnBack(isOpen: () => boolean, close: () => void): void {
	$effect(() => {
		if (!isOpen()) return;
		return pushBackHandler(close);
	});
}
