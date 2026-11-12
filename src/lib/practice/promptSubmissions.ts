// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shares generated prompts with the shared prompt database while the learner
 * leaves prompt contributions on (the default).
 *
 * A generated prompt is written to a local outbox first, so a dropped
 * connection or a closed app never loses it. The outbox is flushed when the
 * prompt is generated, when the app starts, when the browser comes back
 * online and when the tab becomes visible again. The server deduplicates by
 * content, so retrying an accepted batch is harmless.
 *
 * Turning prompt contributions off stops queueing and sending; prompts
 * generated while it is off stay on the device. The payload is the prompt
 * itself (title, task, both languages, level and mode) and nothing else: no
 * transcripts, recordings, corrections, keys or device identifiers.
 */
import { get, writable } from 'svelte/store';
import { getDatabaseAdapter, type Prompt, type PromptSubmission } from '#lib/adapters/db/index.js';
import { appSettings, settingsReady, type AppSettings } from '#lib/stores/settings.js';

/** The deployed shared database. */
const DEPLOYED_ENDPOINT = 'https://onspot-prompt-submissions.khizardevelops.workers.dev';
/** Override for self-hosted builds; unset or empty uses the deployed service. */
const ENDPOINT = (import.meta.env?.VITE_PROMPT_SUBMISSIONS_URL || DEPLOYED_ENDPOINT).trim();

/** Sends per batch: small enough for a phone waking up, large enough to drain quickly. */
const BATCH_SIZE = 20;
/** A stuck endpoint must not hold the outbox forever. */
const SEND_TIMEOUT_MS = 20_000;
/** Backoff after a failed send, doubling from 30 s to at most an hour. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

/** True when this build has somewhere to send prompts. */
export const promptSubmissionsAvailable = ENDPOINT !== '';

/** How many prompts are waiting, for Settings and diagnostics. */
export const pendingPromptSubmissions = writable(0);

let flushing = false;
let flushAgain = false;
let flushAgainForced = false;
let started = false;

/**
 * Queues one generated prompt unless the learner opted out. Never throws: a
 * prompt must still be usable when the local queue cannot be written.
 *
 * @param prompt The stored generated prompt.
 * @param settings The settings at generation time.
 */
export async function queuePromptSubmission(prompt: Prompt, settings: AppSettings): Promise<void> {
	if (!get(settingsReady) || !settings.promptContributions || !promptSubmissionsAvailable) return;

	try {
		const db = await getDatabaseAdapter();
		await db.putPromptSubmission(toSubmission(prompt, settings));
		await refreshPendingCount(db.listPromptSubmissions());
	} catch {
		// The prompt itself is already stored; a failed queue write is retried
		// the next time that prompt is generated.
	}
}

/**
 * Sends the oldest waiting prompts. Safe to call often: it returns at once
 * when another flush is running, the learner opted out, this build has no
 * endpoint, or the device is offline.
 *
 * @param force Retry even if a failed batch is still inside its backoff. Used
 *   when the device reports a fresh connection.
 * @returns The number of prompts sent by this call.
 */
export async function flushPromptSubmissions(force = false): Promise<number> {
	if (!promptSubmissionsAvailable || !get(settingsReady) || !get(appSettings).promptContributions) return 0;
	if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
	if (flushing) {
		flushAgain = true;
		flushAgainForced ||= force;
		return 0;
	}

	flushing = true;
	let sent = 0;
	let attempted: PromptSubmission[] = [];
	try {
		const db = await getDatabaseAdapter();
		const pending = await db.listPromptSubmissions();
		await refreshPendingCount(pending);

		const due = pending.filter((submission) => force || isDue(submission)).slice(0, BATCH_SIZE);
		attempted = due;
		if (due.length === 0) return 0;

		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ consent: true, prompts: due.map(wireFormat) }),
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
		}

		// The server answers 2xx only after storing every valid prompt and
		// treating content it already had as accepted, so the batch can go.
		for (const submission of due) await db.deletePromptSubmission(submission.id);
		sent = due.length;
		await refreshPendingCount(await db.listPromptSubmissions());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Marking a batch failed only matters while online; an offline device
		// retries as soon as the connection returns, without burning attempts.
		if (attempted.length > 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
			try {
				const db = await getDatabaseAdapter();
				const now = new Date().toISOString();
				for (const submission of attempted) {
					await db.markPromptSubmissionFailed(submission.id, message.slice(0, 500), now);
				}
				await refreshPendingCount(await db.listPromptSubmissions());
			} catch {
				// Keep the queue; the next flush tries again.
			}
		}
	} finally {
		flushing = false;
		if (flushAgain) {
			flushAgain = false;
			const retryForced = flushAgainForced;
			flushAgainForced = false;
			void flushPromptSubmissions(retryForced);
		}
	}
	return sent;
}

/**
 * Starts the listeners that drain the outbox: app start, a returned
 * connection and a visible tab. Safe to call more than once.
 */
export function startPromptSubmissionSync(): void {
	if (started || typeof window === 'undefined') return;
	started = true;

	// A returned connection is a good reason to ignore a failed send's backoff.
	window.addEventListener('online', () => void flushPromptSubmissions(true));
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void flushPromptSubmissions();
	});
	void flushPromptSubmissions();
}

/** Reads the queue once so Settings can show how much is waiting. */
export async function refreshPendingPromptSubmissions(): Promise<void> {
	try {
		const db = await getDatabaseAdapter();
		await refreshPendingCount(db.listPromptSubmissions());
	} catch {
		pendingPromptSubmissions.set(0);
	}
}

function toSubmission(prompt: Prompt, settings: AppSettings): PromptSubmission {
	return {
		id: prompt.id,
		title: prompt.title,
		text: prompt.text,
		instructionLanguage: prompt.instructionLanguage,
		targetLanguage: prompt.language ?? settings.targetLanguage,
		level: settings.level,
		mode: settings.mode,
		createdAt: prompt.createdAt,
		attempts: 0,
		lastAttemptAt: null,
		lastError: null
	};
}

function wireFormat(submission: PromptSubmission): Record<string, string> {
	return {
		id: submission.id,
		title: submission.title,
		text: submission.text,
		instructionLanguage: submission.instructionLanguage,
		targetLanguage: submission.targetLanguage,
		level: submission.level,
		mode: submission.mode,
		createdAt: submission.createdAt
	};
}

/** Whether a submission has waited out its backoff. New rows are always due. */
function isDue(submission: PromptSubmission, now = Date.now()): boolean {
	if (submission.attempts === 0 || !submission.lastAttemptAt) return true;
	const waited = RETRY_BASE_MS * 2 ** Math.min(submission.attempts - 1, 10);
	const wait = Math.min(waited, RETRY_MAX_MS);
	const last = Date.parse(submission.lastAttemptAt);
	return !Number.isFinite(last) || now - last >= wait;
}

async function refreshPendingCount(pending: Promise<PromptSubmission[]> | PromptSubmission[]): Promise<void> {
	const rows = await pending;
	pendingPromptSubmissions.set(rows.length);
}
