import { get } from 'svelte/store';
import type { LlmEndpoint, LlmProviderId } from '$lib/adapters/llm';
import { getProvider } from '$lib/adapters/llm';
import { appSettings, type AppSettings } from './settings';
import { customApiKey, deepseekApiKey, groqApiKey } from './secrets';

function secretFor(provider: LlmProviderId) {
	switch (provider) {
		case 'groq':
			return groqApiKey;
		case 'deepseek':
			return deepseekApiKey;
		default:
			return customApiKey;
	}
}

/**
 * Builds the endpoint the LLM client needs from the current settings and the
 * secret store. Shared by practice evaluation and the Settings connection test.
 */
export function resolveLlmEndpoint(settings: AppSettings): LlmEndpoint {
	const provider = getProvider(settings.llmProvider);
	const baseUrl =
		settings.llmProvider === 'custom' ? settings.customBaseUrl : provider.baseUrl;
	return {
		baseUrl: baseUrl || provider.baseUrl,
		apiKey: get(secretFor(settings.llmProvider)),
		model:
			settings.llmProvider === 'custom'
				? settings.customModel
				: settings.llmModel || provider.defaultModel
	};
}

export function currentLlmEndpoint(): LlmEndpoint {
	return resolveLlmEndpoint(get(appSettings));
}
