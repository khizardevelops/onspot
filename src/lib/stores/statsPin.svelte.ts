// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the session stats are pinned open in the Feedback panel. Unpinned,
 * they are a sheet that a tap anywhere else in the panel puts away; pinned,
 * they are part of the panel, open from the start and kept open, for learners
 * who want them in view all the time. Remembered in this browser only, like
 * the appearance.
 */

const STORAGE_KEY = 'onspot.feedback.statsPinned';

function storedPin(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		// Storage may be disabled.
		return false;
	}
}

let pinned = $state(storedPin());

/** The pin, readable reactively as `statsPin.pinned`. */
export const statsPin = {
	get pinned(): boolean {
		return pinned;
	}
};

/** Pins or unpins the stats and remembers it. */
export function setStatsPinned(next: boolean): void {
	pinned = next;
	try {
		localStorage.setItem(STORAGE_KEY, String(next));
	} catch {
		// Storage may be disabled.
	}
}
