// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The interface scale: how large the whole app reads on this device. It
 * scales text, cards, spacing and controls together, unlike the per-part Text
 * size settings, which stay independent multipliers.
 *
 * The scale is a CSS `zoom` on the root element, written here before the first
 * render and remembered in this browser only, like the theme. The few layout
 * values that depend on the viewport (the page height, fixed overlay widths)
 * read `--ui-zoom` too; see `app.css` and the root layout.
 */

export const UI_ZOOM_MIN = 0.8;
export const UI_ZOOM_MAX = 1.5;
export const UI_ZOOM_STEP = 0.05;
export const DEFAULT_UI_ZOOM = 1;

const STORAGE_KEY = 'onspot.ui-zoom.v1';
const ROOT_PROPERTY = '--ui-zoom';

/** A scale snapped to the control's 5% steps and clamped to its range. */
function snapZoom(value: number): number {
	const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, value));
	return Math.round(clamped * 20) / 20;
}

function storedZoom(): number {
	try {
		const stored = Number(localStorage.getItem(STORAGE_KEY));
		if (Number.isFinite(stored) && stored > 0) return snapZoom(stored);
	} catch {
		// Storage may be disabled; use the default.
	}
	return DEFAULT_UI_ZOOM;
}

function applyZoom(value: number): void {
	document.documentElement.style.setProperty(ROOT_PROPERTY, String(value));
}

let current = $state(storedZoom());
applyZoom(current);

/** The interface scale now. Reactive inside components and `$derived`. */
export function uiZoom(): number {
	return current;
}

/** Sets the interface scale (snapped to 5% steps). */
export function setUiZoom(value: number): void {
	if (!Number.isFinite(value)) return;

	const snapped = snapZoom(value);
	current = snapped;
	applyZoom(snapped);

	try {
		if (snapped === DEFAULT_UI_ZOOM) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, String(snapped));
	} catch {
		// Storage may be disabled; the scale still applies until the page reloads.
	}
}

/** Moves the interface scale one 5% step larger (+1) or smaller (−1). */
export function stepUiZoom(direction: 1 | -1): void {
	setUiZoom(current + direction * UI_ZOOM_STEP);
}

/** Back to 100%. */
export function resetUiZoom(): void {
	setUiZoom(DEFAULT_UI_ZOOM);
}

/** True while the interface scale is 100%. Reactive. */
export function uiZoomIsDefault(): boolean {
	return Math.abs(current - DEFAULT_UI_ZOOM) < UI_ZOOM_STEP / 2;
}
