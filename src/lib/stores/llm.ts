// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get } from 'svelte/store';
import type { LlmEndpoint, LlmProviderId } from '#lib/adapters/llm/index.js';
import { AUTOMATIC_MODEL, automaticModels, getProvider } from '#lib/adapters/llm/index.js';
import {
	getInstructionLanguage,
	getLanguage,
	resourceLevelOf,
	type LanguageResourceLevel
} from '#lib/languages/index.js';
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
 * The resource level a request needs: the model reads the studied language and
 * writes the language of instruction, so the less-resourced of the two decides.
 */
function languageLevelOf(settings: AppSettings): LanguageResourceLevel {
	const studied = getLanguage(settings.targetLanguage);
	const instruction = getInstructionLanguage(settings.instructionLanguage);
	const leastWebText = Math.min(studied?.webTextPercent ?? Infinity, instruction.webTextPercent);

	return resourceLevelOf(leastWebText);
}

/**
 * The models a request may use, in order of preference. Automatic: the
 * provider's models trusted with the languages in use (`automaticModels`);
 * `pacing.ts` then takes the first with room for the request. A model chosen
 * in Settings: that model alone.
 */
function modelsFor(settings: AppSettings): string[] {
	if (settings.llmProvider === 'custom') return [settings.customModel];

	const chosen = settings.llmModel;
	if (chosen && chosen !== AUTOMATIC_MODEL) return [chosen];

	const automatic = automaticModels(settings.llmProvider, languageLevelOf(settings));
	return automatic.length > 0 ? automatic : [getProvider(settings.llmProvider).defaultModel];
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
	const baseUrl = settings.llmProvider === 'custom' ? settings.customBaseUrl : provider.baseUrl;
	const [model, ...fallbackModels] = modelsFor(settings);

	return {
		baseUrl: baseUrl || provider.baseUrl,
		apiKey: get(secretFor(settings.llmProvider)),
		model,
		fallbackModels
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
