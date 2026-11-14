// SPDX-License-Identifier: AGPL-3.0-or-later

/** Reminder due-state decisions through the Rust core (P7). */

import type { ReminderFrequency } from '#lib/stores/reminders.js';
import { getCoreClient } from './client.js';

export interface ReminderStateView {
	ready: boolean;
	due: boolean;
	lastPractisedAt: string | null;
	nextAt: string | null;
}

/**
 * Asks the core whether a reminder is due and when the next one is.
 *
 * @param input The stored practice time, snooze, cadence and current clock.
 * @returns The reminder state to publish.
 */
export async function reminderStateCore(input: {
	enabled: boolean;
	lastPractisedAtMs: number | null;
	snoozedUntilMs: number | null;
	frequency: ReminderFrequency;
	nowMs: number;
}): Promise<ReminderStateView> {
	const client = await getCoreClient();
	return client.command<ReminderStateView>('reminders.state', input);
}
