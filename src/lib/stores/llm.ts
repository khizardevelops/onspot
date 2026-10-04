import { derived, get } from 'svelte/store';
import type { LlmEndpoint, LlmProviderId } from '#lib/adapters/llm/index.js';
import { getProvider } from '#lib/adapters/llm/index.js';
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

/**
 * Whether evaluation can run at all. A take recorded without a usable provider
 * would only fail after the learner has spoken, so Practice gates on this.
 * Groq and DeepSeek need a key; a custom endpoint (often a local server) needs
 * a URL and model, and its key is optional.
 */
export const llmConfigured = derived(
	[appSettings, groqApiKey, deepseekApiKey],
	([$settings, $groq, $deepseek]) => {
		switch ($settings.llmProvider) {
			case 'groq':
				return $groq.trim() !== '';
			case 'deepseek':
				return $deepseek.trim() !== '';
			default:
				return $settings.customBaseUrl.trim() !== '' && $settings.customModel.trim() !== '';
		}
	}
);
