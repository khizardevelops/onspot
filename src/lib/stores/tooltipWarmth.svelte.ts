// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a tooltip has only just closed. Going along a row of keys, the
 * pointer leaves one and reaches the next within moments: the next key's
 * tooltip then opens at once and replaces the last, instead of waiting for the
 * pointer to rest and popping in again after a blink of nothing.
 *
 * Reactive state rather than a timestamp: neo-svelte reads a tooltip's rest
 * delay inside a `$derived`, which only recomputes when a signal changes.
 */

/** A tooltip opened this soon after another one closed counts as moving along the row. */
const NEIGHBOUR_WINDOW_MS = 300;

let justClosed = $state(false);
let cooling: ReturnType<typeof setTimeout> | undefined;

/** True for a moment after a tooltip closes. Reactive. */
export function tooltipJustClosed(): boolean {
	return justClosed;
}

/** Records that a tooltip closed. */
export function noteTooltipClosed(): void {
	justClosed = true;
	clearTimeout(cooling);
	cooling = setTimeout(() => (justClosed = false), NEIGHBOUR_WINDOW_MS);
}
