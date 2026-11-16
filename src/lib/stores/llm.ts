// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get } from 'svelte/store';
import type { LlmEndpoint, LlmProviderId } from '#lib/adapters/llm/index.js';
import { resolveLlmEndpointPolicy } from '#lib/adapters/llm/index.js';
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

/** The least-resourced of the studied and instruction languages, for Automatic. */
function languageLevelOf(settings: AppSettings): LanguageResourceLevel {
	const studied = getLanguage(settings.targetLanguage);
	const instruction = getInstructionLanguage(settings.instructionLanguage);
	const leastWebText = Math.min(studied?.webTextPercent ?? Infinity, instruction.webTextPercent);

	return resourceLevelOf(leastWebText);
}

/**
 * Builds the endpoint the LLM client needs from the current settings and the
 * secret store. Shared by practice evaluation and the Settings connection test.
 * The URL/model policy is one function (`resolveLlmEndpointPolicy`), mirrored by
 * the Rust core and pinned by `request-endpoints.json`; only the key is added here.
 */
export function resolveLlmEndpoint(settings: AppSettings): LlmEndpoint {
	const endpoint = resolveLlmEndpointPolicy({
		correctionMode: settings.correctionMode,
		localLlmUrl: settings.localLlmUrl,
		localLlmModel: settings.localLlmModel,
		llmProvider: settings.llmProvider,
		llmModel: settings.llmModel,
		customBaseUrl: settings.customBaseUrl,
		customModel: settings.customModel,
		languageLevel: languageLevelOf(settings)
	});
	const apiKey =
		settings.correctionMode === 'local' ? get(localLlmApiKey) : get(secretFor(settings.llmProvider));
	return { ...endpoint, apiKey };
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
