// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get } from 'svelte/store';
import type { LlmEndpoint, LlmProviderId } from '#lib/adapters/llm/index.js';
import { GROQ_ROTATION_MODELS, getProvider } from '#lib/adapters/llm/index.js';
import { appSettings, type AppSettings } from './settings';
import { customApiKey, deepseekApiKey, groqApiKey, localLlmApiKey } from './secrets';

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
	// A local server (LM Studio, llama.cpp, Ollama, ...) speaks the same
	// OpenAI-compatible protocol; only the address and key differ.
	if (settings.correctionMode === 'local') {
		return {
			baseUrl: settings.localLlmUrl,
			apiKey: get(localLlmApiKey),
			model: settings.localLlmModel
		};
	}

	const provider = getProvider(settings.llmProvider);
	const baseUrl =
		settings.llmProvider === 'custom' ? settings.customBaseUrl : provider.baseUrl;
	const model =
		settings.llmProvider === 'custom' ? settings.customModel : settings.llmModel || provider.defaultModel;
	// Groq limits each model separately, so a busy model's requests can continue on another.
	const rotates = settings.llmProvider === 'groq' && settings.llmRotation === 'rotate';
	return {
		baseUrl: baseUrl || provider.baseUrl,
		apiKey: get(secretFor(settings.llmProvider)),
		model,
		fallbackModels: rotates ? GROQ_ROTATION_MODELS.filter((fallback) => fallback !== model) : []
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
		if ($settings.correctionMode === 'local') {
			return $settings.localLlmUrl.trim() !== '' && $settings.localLlmModel.trim() !== '';
		}

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
