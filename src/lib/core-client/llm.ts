// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Rust connection test (P4), used by Settings when the core feature is on.
 * Keys stay in the host: the bridge command carries only the endpoint.
 */

import type { LlmEndpoint } from '#lib/adapters/llm/types.js';
import { getCoreClient } from './client.js';

/** Provider id used to find the stored key on the host. */
function providerOf(baseUrl: string): string {
	try {
		const host = new URL(baseUrl).host;
		if (host === 'api.groq.com') return 'groq';
		if (host === 'api.deepseek.com') return 'deepseek';
		return 'custom';
	} catch {
		return 'custom';
	}
}

/** Asks the Rust evaluator to test an OpenAI-compatible endpoint. */
export async function testConnectionCore(endpoint: LlmEndpoint): Promise<string> {
	const client = await getCoreClient();
	const response = await client.command<{ reply: string }>('evaluation.test_connection', {
		endpoint: {
			baseUrl: endpoint.baseUrl,
			provider: providerOf(endpoint.baseUrl),
			model: endpoint.model,
			fallbackModels: [...(endpoint.fallbackModels ?? [])]
		}
	});
	return response.reply;
}
