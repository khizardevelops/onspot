// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Optional practice reminders: a gentle nudge when the learner has not spoken
 * for a while. The nudge is shown in Practice when they open onspot, and as a
 * system notification when the app is in the background and notifications are
 * allowed. Nothing is scheduled while the app is closed: the reminder is
 * checked when it opens, becomes visible again, or every few minutes.
 */
import { get, writable } from 'svelte/store';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import { getLanguage } from '#lib/languages/index.js';
import { notify } from '#lib/platform/notifications.js';
import { appSettings } from './settings';

export type ReminderFrequency = 'frequent' | 'infrequent';

export interface ReminderState {
	/** False until the first check has run, so no banner flashes on start-up. */
	ready: boolean;
	/** A reminder is waiting to be shown or acted on. */
	due: boolean;
	/** When the learner last finished a take, if there is a record. */
	lastPractisedAt: string | null;
	/** When the next reminder becomes due. */
	nextAt: string | null;
}

/**
 * How long after practice a reminder becomes due. "Frequent" is once a day;
 * "Infrequent" is a gap of a few days, closer to twice a week.
 */
const REMINDER_INTERVAL_DAYS: Record<ReminderFrequency, number> = {
	frequent: 1,
	infrequent: 3
};

const DAY_MS = 86_400_000;
/** The last completed take, kept on this device so a new one counts immediately. */
const PRACTISED_AT_KEY = 'onspot.reminder.practisedAt';
const SNOOZED_UNTIL_KEY = 'onspot.reminder.snoozedUntil';
/** The due period a system notification was already shown for. */
const NOTIFIED_FOR_KEY = 'onspot.reminder.notifiedFor';
/** Re-checks while the app stays open; the interval matters less than a visible, fresh state. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const initial: ReminderState = { ready: false, due: false, lastPractisedAt: null, nextAt: null };

const store = writable<ReminderState>({ ...initial });
export const reminders = { subscribe: store.subscribe };

let refreshJob: Promise<void> | null = null;
let started = false;

function storageGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		// Private modes and disabled storage: reminders still work within this visit.
		return null;
	}
}

function storageSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// The in-memory state is enough for now.
	}
}

function intervalMs(): number {
	return REMINDER_INTERVAL_DAYS[get(appSettings).reminderFrequency] * DAY_MS;
}

function parseTime(value: string | null): number | null {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

/** The newest saved session's time, which advances when the first take of a session is saved. */
async function lastSavedPracticeTime(): Promise<number | null> {
	try {
		const db = await getDatabaseAdapter();
		const sessions = await db.listSessions();
		const newest = sessions.at(0);
		if (!newest) return null;

		// `updatedAt` follows renames, so it cannot mark practice on its own; the
		// session's own start covers its first take, and attempts carry later ones.
		const attempts = await db.listAttempts(newest.id);
		const latestAttempt = attempts.at(-1);
		return Math.max(
			parseTime(newest.createdAt) ?? 0,
			parseTime(latestAttempt?.createdAt ?? null) ?? 0
		) || null;
	} catch {
		return null;
	}
}

/** A reminder is due, and the learner has not put it off for longer. */
function isDue(lastPractisedAt: number | null): boolean {
	if (lastPractisedAt === null) return false;

	const snoozedUntil = parseTime(storageGet(SNOOZED_UNTIL_KEY)) ?? 0;
	const dueAt = lastPractisedAt + intervalMs();
	const now = Date.now();
	return now >= dueAt && now >= snoozedUntil;
}

/** Shows a system notification once per due period, and only when the app is not in view. */
function notifyIfInBackground(nextAt: string | null): void {
	if (!nextAt || !document.hidden) return;
	if (storageGet(NOTIFIED_FOR_KEY) === nextAt) return;
	if (!notify(notificationTitle(), notificationBody())) return;

	storageSet(NOTIFIED_FOR_KEY, nextAt);
}

function notificationTitle(): string {
	const language = getLanguage(get(appSettings).targetLanguage);
	return language ? `Time to speak ${language.name}?` : 'Time to practise?';
}

function notificationBody(): string {
	return 'A few minutes of speaking keeps your words ready when you need them.';
}

/**
 * Re-reads practice activity and the chosen cadence and updates `reminders`.
 * Safe to call often; overlapping calls share the same work.
 */
export function refreshReminders(): Promise<void> {
	if (refreshJob) return refreshJob;

	refreshJob = (async () => {
		try {
			const enabled = get(appSettings).practiceReminders;
			const storedPractice = parseTime(storageGet(PRACTISED_AT_KEY));
			const savedPractice = enabled ? await lastSavedPracticeTime() : null;
			const lastPractisedAt = Math.max(storedPractice ?? 0, savedPractice ?? 0) || null;
			const dueAt = lastPractisedAt === null ? null : lastPractisedAt + intervalMs();

			store.set({
				ready: true,
				due: enabled && isDue(lastPractisedAt),
				lastPractisedAt: lastPractisedAt === null ? null : new Date(lastPractisedAt).toISOString(),
				nextAt: dueAt === null ? null : new Date(dueAt).toISOString()
			});

			if (get(store).due) notifyIfInBackground(get(store).nextAt);
		} finally {
			refreshJob = null;
		}
	})();

	return refreshJob;
}

/**
 * Marks a completed take: the reminder clock restarts, however it was queued.
 *
 * @param at The take's saved time; defaults to now.
 */
export function recordPracticeActivity(at: Date = new Date()): void {
	const iso = at.toISOString();
	storageSet(PRACTISED_AT_KEY, iso);
	store.update((state) => ({
		...state,
		ready: true,
		due: false,
		lastPractisedAt: iso,
		nextAt: new Date(at.getTime() + intervalMs()).toISOString()
	}));
}

/** Puts the nudge away until the next cadence has passed. */
export function snoozeReminders(): void {
	const until = Date.now() + intervalMs();
	storageSet(SNOOZED_UNTIL_KEY, new Date(until).toISOString());
	store.update((state) => ({ ...state, due: false }));
}

/**
 * Starts the reminder checks. Call once after settings have loaded: it watches
 * the learner's choices, returns from the background, and a slow interval while
 * the app stays open.
 */
export function initReminders(): void {
	if (started) return;
	started = true;

	void refreshReminders();
	appSettings.subscribe(() => void refreshReminders());
	document.addEventListener('visibilitychange', () => void refreshReminders());
	setInterval(() => void refreshReminders(), CHECK_INTERVAL_MS);
}
