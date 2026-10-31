// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout } from '#lib/adapters/llm/client.js';

const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const REQUEST_TIMEOUT_MS = 20_000;

/** The ElevenLabs plan and its character allowance; quotas are per account, not per voice or model. */
export interface ElevenLabsSubscription {
	/** Plan name, e.g. `free`, `starter`, `creator`. */
	tier: string;
	/** Characters used in the current billing period. */
	characterCount: number;
	characterLimit: number;
	/** When the allowance starts over (ms since epoch), if ElevenLabs says. */
	resetsAt: number | null;
}

interface SubscriptionResponse {
	tier?: unknown;
	character_count?: unknown;
	character_limit?: unknown;
	next_character_count_reset_unix?: unknown;
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads the account's plan and character allowance (`GET /v1/user/subscription`).
 *
 * @param apiKey The learner's ElevenLabs key.
 * @returns The plan and allowance.
 * @throws When the key may not read it (a key restricted to text-to-speech
 *   lacks `user_read`) or the request fails, with a message a learner can act on.
 */
export async function fetchElevenLabsSubscription(apiKey: string): Promise<ElevenLabsSubscription> {
	const key = apiKey.trim();
	if (!key) throw new Error('Add an ElevenLabs API key first.');

	const response = await fetchWithTimeout(
		SUBSCRIPTION_URL,
		{ headers: { 'xi-api-key': key } },
		{ timeoutMs: REQUEST_TIMEOUT_MS }
	);

	if (response.status === 401 || response.status === 403) {
		throw new Error(
			'This ElevenLabs key cannot read its plan. Give the key the "User: Read" permission in ElevenLabs to see your usage here.'
		);
	}
	if (!response.ok) throw new Error(`ElevenLabs usage could not be read (HTTP ${response.status}).`);

	const data = (await response.json()) as SubscriptionResponse;
	const characterCount = asNumber(data.character_count);
	const characterLimit = asNumber(data.character_limit);
	if (characterCount === null || characterLimit === null) {
		throw new Error('ElevenLabs returned usage in an unexpected shape.');
	}

	const resetUnixSeconds = asNumber(data.next_character_count_reset_unix);
	return {
		tier: typeof data.tier === 'string' ? data.tier : 'unknown',
		characterCount,
		characterLimit,
		resetsAt: resetUnixSeconds === null ? null : resetUnixSeconds * 1_000
	};
}
