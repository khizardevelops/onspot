// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Android's system Back button, inside the Tauri app.
 *
 * Tauri's default is "go back in the WebView, or exit when there is no
 * history", so Back with a menu or sheet open on the first screen quit the
 * app. While something closable is open, this registers a Back listener
 * (which suspends that default) and Back closes the topmost open thing. When
 * nothing is open the listener is removed and Android's normal behaviour
 * (previous page, then leave the app) returns. No-op on web and desktop.
 *
 * The same stack serves the header's Back button on every platform
 * (`navigation/back.svelte.ts`), so both close the same thing first.
 */
import { onBackButtonPress } from '@tauri-apps/api/app';
import type { PluginListener } from '@tauri-apps/api/core';
import { currentRuntime } from './runtime';

const isAndroidApp = currentRuntime() === 'android';

/** Something Back can close, while it is open. */
interface BackEntry {
	isOpen: () => boolean;
	close: () => void;
}

const stack: BackEntry[] = [];
let listener: Promise<PluginListener> | null = null;

function sync(): void {
	if (!isAndroidApp) return;
	if (stack.length && !listener) {
		listener = onBackButtonPress(() => closeTopmost()).catch((error) => {
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

/**
 * Closes the most recently opened thing that is still open.
 *
 * An entry stays on the stack until its component has updated, so one that
 * closed a moment ago (a menu a tap outside just put away) is skipped.
 *
 * @returns False when nothing was open.
 */
export function closeTopmost(): boolean {
	const entry = stack.findLast((candidate) => candidate.isOpen());
	if (!entry) return false;
	entry.close();
	return true;
}

/** Pushes something Back can close; returns a function that removes it. */
export function pushBackHandler(isOpen: () => boolean, close: () => void): () => void {
	const entry: BackEntry = { isOpen, close };
	stack.push(entry);
	sync();
	return () => {
		const index = stack.lastIndexOf(entry);
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
		return pushBackHandler(isOpen, close);
	});
}
