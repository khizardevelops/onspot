// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver side of the shared prompt-database outbox.
 *
 * Which waiting prompts to send, how a failed batch backs off and the wire
 * body are core rules (`onspot-app::prompt_submissions`). This module only
 * decides *when* to ask: at app start, when the device comes back online, and
 * when the tab becomes visible. A generated prompt is written to the local
 * outbox by the core, so a dropped connection or a closed app never loses it.
 *
 * Turning prompt contributions off stops sending; prompts generated while it
 * is off stay on the device. The payload is the prompt itself (title, task,
 * both languages, level and mode) and nothing else: no transcripts, recordings,
 * corrections, keys or device identifiers.
 */
import { get, writable } from 'svelte/store';
import { getCoreClient } from '#lib/core-client/client.js';
import type { SubmissionFlushResult } from '#lib/core-client/types.gen.js';
import { appSettings, settingsReady } from '#lib/stores/settings.js';
import { toast } from '#lib/stores/toast.js';

/** The deployed shared database. */
const DEPLOYED_ENDPOINT = 'https://onspot-prompt-submissions.khizardevelops.workers.dev';
/** Override for self-hosted builds; unset or empty uses the deployed service. */
const ENDPOINT = (import.meta.env?.VITE_PROMPT_SUBMISSIONS_URL || DEPLOYED_ENDPOINT).trim();

/** True when this build has somewhere to send prompts. */
export const promptSubmissionsAvailable = ENDPOINT !== '';

/** How many prompts are waiting, for Settings and diagnostics. */
export const pendingPromptSubmissions = writable(0);

let flushing = false;
let flushAgain = false;
let flushAgainForced = false;
let started = false;

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
	try {
		const client = await getCoreClient();
		const result = await client.command<SubmissionFlushResult>('prompts.flush_submissions', {
			endpoint: ENDPOINT,
			force,
			online: typeof navigator === 'undefined' || navigator.onLine
		});
		pendingPromptSubmissions.set(result.pending);
		return result.sent;
	} catch (error) {
		// The core keeps the queue; a host failure is not a lost prompt.
		toast(error instanceof Error ? error.message : String(error), 6000);
		return 0;
	} finally {
		flushing = false;
		if (flushAgain) {
			flushAgain = false;
			const retryForced = flushAgainForced;
			flushAgainForced = false;
			void flushPromptSubmissions(retryForced);
		}
	}
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
		const client = await getCoreClient();
		const result = await client.command<SubmissionFlushResult>('prompts.flush_submissions', {
			endpoint: '',
			force: false,
			online: false
		});
		pendingPromptSubmissions.set(result.pending);
	} catch {
		pendingPromptSubmissions.set(0);
	}
}
