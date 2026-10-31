// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The app's light or dark appearance. It is resolved when this module loads,
 * before the first render, because NeoThemeProvider must start on the right
 * theme (see NeoThemeSync), and is remembered in this browser only.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'onspot.theme';

function storedTheme(): Theme {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(STORAGE_KEY);
	} catch {
		// Storage may be disabled.
	}
	if (stored === 'dark' || stored === 'light') return stored;
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current = $state<Theme>(storedTheme());
document.documentElement.setAttribute('data-theme', current);

/** The current appearance, readable reactively as `theme.current`. */
export const theme = {
	get current(): Theme {
		return current;
	}
};

/** Switches to a theme and remembers it. */
export function applyTheme(next: Theme): void {
	current = next;
	document.documentElement.setAttribute('data-theme', next);
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Storage may be disabled.
	}
}

/** Flips between light and dark, cross-fading the page where the browser can. */
export function toggleTheme(): void {
	const next = current === 'dark' ? 'light' : 'dark';
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const doc = document as Document & {
		startViewTransition?: (update: () => void) => { finished: Promise<void> };
	};
	if (!reduced && doc.startViewTransition) doc.startViewTransition(() => applyTheme(next));
	else applyTheme(next);
}
