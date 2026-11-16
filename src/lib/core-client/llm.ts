// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The driver's door to the core's LLM adapter: the connection test, the
 * model list and the pacing notice. Every request runs in Rust; keys stay in
 * the host, which adds the key of the slot a request names.
 */

import { readable } from 'svelte/store';
import type { LlmEndpoint } from '#lib/adapters/llm/types.js';
import { getCoreClient } from './client.js';
import { withCandidateKey, type LlmKeySlot } from './secrets.js';
import type { LlmEndpoint as CoreLlmEndpoint, PacingWait } from './types.gen';
import { keyIdOf } from './usage.js';

/**
 * The key-free endpoint the core takes: the key stays in the host, which
 * finds it by `keySlot`; only a hash of it travels, for the usage ledger.
 *
 * @param endpoint The endpoint as the driver composed it, key included.
 * @param keySlot Which stored key the host adds.
 */
export function toCoreEndpoint(endpoint: LlmEndpoint, keySlot: LlmKeySlot): CoreLlmEndpoint {
	return {
		baseUrl: endpoint.baseUrl,
		provider: keySlot,
		model: endpoint.model,
		fallbackModels: [...(endpoint.fallbackModels ?? [])],
		keyId: keyIdOf(endpoint.apiKey)
	};
}

/**
 * Sends a one-token chat completion through the core, the exact path
 * evaluation takes, and returns the model's reply (normally "OK").
 */
export async function testConnectionCore(endpoint: LlmEndpoint, keySlot: LlmKeySlot): Promise<string> {
	const client = await getCoreClient();
	const response = await client.command<{ reply: string }>('evaluation.test_connection', {
		endpoint: toCoreEndpoint(endpoint, keySlot)
	});
	return response.reply;
}

/**
 * Tests a key the learner typed but has not kept yet: the host lends it to
 * this one request and forgets it, so a bad key is never saved.
 */
export function testUnsavedKey(endpoint: LlmEndpoint): Promise<string> {
	return withCandidateKey(endpoint.apiKey, () => testConnectionCore(endpoint, 'candidate'));
}

/** The chat models the endpoint's key can use (`GET /models`, via the core). */
export async function listModelsCore(endpoint: LlmEndpoint, keySlot: LlmKeySlot): Promise<string[]> {
	const client = await getCoreClient();
	const response = await client.command<{ models: string[] }>('llm.list_models', {
		endpoint: toCoreEndpoint(endpoint, keySlot)
	});
	return response.models;
}

/**
 * The longest LLM request waiting for room under a provider's per-minute
 * limit, or null. Feedback that pauses says so instead of looking stuck.
 */
export const pacingWait = readable<PacingWait | null>(null, (set) => {
	let unsubscribe: (() => void) | null = null;
	let stopped = false;

	void getCoreClient()
		.then((client) => {
			if (stopped) return;
			unsubscribe = client.subscribe((event) => {
				if (event.event === 'pacing_wait_changed') set(event.wait ?? null);
			});
		})
		.catch(() => undefined);

	return () => {
		stopped = true;
		unsubscribe?.();
	};
});
