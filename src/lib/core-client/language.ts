// SPDX-License-Identifier: AGPL-3.0-or-later

/** Language-data planning and download orchestration through the Rust core (P7). */

import { getCoreClient } from './client.js';

/** Which local parts the processing choices need, or which are cached. */
export interface LanguageParts {
	stt: boolean;
	voice: boolean;
	explanationVoice: boolean;
}

/** Bytes still to download for the required parts. */
export interface PendingBytes {
	stt: number;
	voice: number;
	explanationVoice: number;
	storage: number;
	transfer: number;
}

/** What one check of the language's required local data found. */
export interface LanguagePlan {
	required: LanguageParts;
	installed: LanguageParts;
	pending: PendingBytes;
	ready: boolean;
}

/** Inputs the driver supplies from its caches and processing choices. */
export interface LanguagePlanInput {
	languageId: string;
	instructionLanguageId: string;
	native: boolean;
	required: LanguageParts;
	installed: LanguageParts;
	voiceId?: string | null;
	explanationVoiceId?: string | null;
	/** URLs already cached, so a partially cached part is priced exactly. */
	cachedAssets?: string[];
}

/** The download's state when the core finishes or the learner cancels. */
export interface LanguageDownloadResult {
	status: 'ready' | 'cancelled';
	progress: number;
	pending: PendingBytes;
	ready: boolean;
	label: string;
}

/**
 * Asks the core for the missing bytes and readiness of one language selection.
 *
 * @param input Cached parts, required parts and the chosen voices.
 * @returns The planner's pending sizes and readiness.
 */
export async function languagePlanCore(input: LanguagePlanInput): Promise<LanguagePlan> {
	const client = await getCoreClient();
	return client.command<LanguagePlan>('language.plan', { input });
}

/**
 * Runs one language-data download. Progress arrives as `download_progress`
 * events while this promise is pending.
 *
 * @param input The same selection passed to `languagePlanCore`.
 * @returns The final state; `cancelled` after an explicit cancel.
 */
export async function languageDownloadCore(
	input: LanguagePlanInput
): Promise<LanguageDownloadResult> {
	const client = await getCoreClient();
	return client.command<LanguageDownloadResult>('language.download', { input });
}

/** Stops the running download and tears down the fetching worker. */
export async function languageCancelDownloadCore(): Promise<void> {
	const client = await getCoreClient();
	await client.command('language.cancel_download');
}

/**
 * Forwards one worker progress reading into the core download session.
 *
 * Called by the driver's host handler while `language.download_stt` or
 * `language.download_voice` is in flight.
 *
 * @param progress The worker's 0–100 progress and status line.
 */
export async function languageDownloadProgressCore(progress: {
	progress: number;
	status: string;
}): Promise<void> {
	const client = await getCoreClient();
	await client.command('language.download_progress', { progress });
}
