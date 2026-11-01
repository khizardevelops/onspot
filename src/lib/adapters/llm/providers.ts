// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageResourceLevel } from '#lib/languages/index.js';
import type { LlmModelOption, LlmProviderConfig, LlmProviderId } from './types';

/**
 * Known model ids. This is the enum the settings dropdown is built from; the
 * `(string & {})` arm keeps autocomplete while allowing a model fetched live
 * from the provider or typed for the custom provider.
 */
export type LlmModelId =
	| 'openai/gpt-oss-120b'
	| 'openai/gpt-oss-20b'
	| 'groq/compound'
	| 'groq/compound-mini'
	| 'qwen/qwen3.8-27b'
	| 'qwen/qwen3.6-27b'
	| 'deepseek-flash'
	| 'deepseek-v4-pro'
	// eslint-disable-next-line @typescript-eslint/ban-types
	| (string & {});

/**
 * Provider presets. Keys live under `onspot.key.llm.<id>` in localStorage
 * (never in the synced database — see stores/secrets.ts).
 */
export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderConfig> = {
	groq: {
		id: 'groq',
		name: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		defaultModel: 'openai/gpt-oss-120b',
		keyUrl: 'https://console.groq.com/keys',
		modelsUrl: 'https://console.groq.com/docs/models',
		note: 'Only models your Groq key can actually use are listed. If a model is missing, enable it under Model Permissions in the Groq Console, then Refresh. Some models (e.g. Llama 3.1/3.3) are Enterprise-only and return a 404 for standard accounts.'
	},
	deepseek: {
		id: 'deepseek',
		name: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com',
		defaultModel: 'deepseek-flash',
		keyUrl: 'https://platform.deepseek.com/api_keys',
		modelsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
		note: 'DeepSeek serves deepseek-flash and deepseek-v4-pro. Create a key and top up your balance on the DeepSeek platform to use them.'
	},
	custom: {
		id: 'custom',
		name: 'Custom (OpenAI-compatible)',
		baseUrl: '',
		defaultModel: '',
		keyUrl: '',
		requiresBaseUrl: true,
		note: 'Point at any OpenAI-compatible endpoint. The model name must match exactly what that server expects.'
	}
};

/**
 * Curated model dropdown per provider, kept in step with the account probe in
 * `docs/benchmarks/llm-providers.md` (2026-09-14). The live list is fetched
 * automatically in Settings whenever a key is present, so an account that gains
 * access to newer models does not wait for an app update.
 *
 * Groq: only generally-available chat models. Llama 3.1/3.3 are Enterprise-only
 * (they 404 on a standard key). DeepSeek: current model names (the old
 * `deepseek-chat`/`deepseek-reasoner` names are legacy).
 */
export const LLM_MODELS: Record<LlmProviderId, LlmModelOption[]> = {
	groq: [
		{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Best quality' },
		{ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Faster' },
		{ id: 'groq/compound', label: 'Compound', note: '8x rate limit (70k TPM)' },
		{ id: 'groq/compound-mini', label: 'Compound Mini', note: '8x rate limit (70k TPM)' },
		{ id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', note: 'Alternative 27B model' },
		{ id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B', note: 'Alternative 27B model' }
	],
	deepseek: [
		{ id: 'deepseek-flash', label: 'DeepSeek Flash', note: 'Fast (default)' },
		{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: 'Higher quality' }
	],
	custom: []
};

/** The `llmModel` setting that lets onspot choose the model for each request. */
export const AUTOMATIC_MODEL = 'auto';

/** A model onspot may choose by itself, and the least-resourced languages it is trusted with. */
interface AutomaticModel {
	id: LlmModelId;
	/** `low`: any language; `medium`: not low-resourced ones; `high`: well-resourced ones only. */
	leastResourced: LanguageResourceLevel;
}

/**
 * The models Automatic chooses from, per provider, in the order it prefers them.
 *
 * Groq: most accurate first. Its free allowances are per model (8,000 tokens a
 * minute each), so moving down the list multiplies what fits in a minute;
 * `pacing.ts` takes the first one with room. All three follow onspot's JSON
 * prompts (checked 2026-11-01 on a free key). GPT-OSS 20B dropped corrections
 * on a long take, so it comes last and only for well-resourced languages; GPT-OSS
 * 120B is Groq's strongest model and the only one for low-resourced languages.
 * Qwen 3.8 is allowed 1,000 reply tokens a minute, so it serves short replies.
 *
 * DeepSeek: cheapest first, because every token is paid for. V4 Pro takes the
 * languages Flash is not trusted with, and Flash's requests when Flash fails.
 *
 * Which model handles which level is a judgement from model size, not yet a
 * measurement: revisit it with an evaluation per language when one is approved.
 */
const AUTOMATIC_MODELS: Record<LlmProviderId, readonly AutomaticModel[]> = {
	groq: [
		{ id: 'openai/gpt-oss-120b', leastResourced: 'low' },
		{ id: 'qwen/qwen3.8-27b', leastResourced: 'medium' },
		{ id: 'openai/gpt-oss-20b', leastResourced: 'high' }
	],
	deepseek: [
		{ id: 'deepseek-flash', leastResourced: 'medium' },
		{ id: 'deepseek-v4-pro', leastResourced: 'low' }
	],
	custom: []
};

/** Resource levels from most to least text. */
const RESOURCE_LEVELS: readonly LanguageResourceLevel[] = ['high', 'medium', 'low'];

/**
 * The models Automatic may use for a provider and a language level, in order of preference.
 *
 * @param provider The configured LLM provider.
 * @param level The resource level of the least-resourced language the request involves.
 * @returns Model ids, preferred first; empty for a provider Automatic does not cover (custom).
 */
export function automaticModels(provider: LlmProviderId, level: LanguageResourceLevel): string[] {
	const levelRank = RESOURCE_LEVELS.indexOf(level);
	const trusted = (model: AutomaticModel) => RESOURCE_LEVELS.indexOf(model.leastResourced) >= levelRank;

	return (AUTOMATIC_MODELS[provider] ?? []).filter(trusted).map((model) => model.id);
}

export function getProvider(id: LlmProviderId): LlmProviderConfig {
	return LLM_PROVIDERS[id] ?? LLM_PROVIDERS.custom;
}

export function getModelOptions(id: LlmProviderId): LlmModelOption[] {
	return LLM_MODELS[id] ?? [];
}

/** A model's name as Settings shows it ("GPT-OSS 120B"), or its id without the vendor prefix. */
export function modelLabel(model: string): string {
	const curated = Object.values(LLM_MODELS)
		.flat()
		.find((option) => option.id === model)?.label;
	return curated ?? model.split('/').pop() ?? model;
}

/** The provider an endpoint URL belongs to ("Groq"), or its host for any other server. */
export function providerNameFor(baseUrl: string): string {
	const host = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};
	const known = Object.values(LLM_PROVIDERS).find((provider) => provider.baseUrl && host(provider.baseUrl) === host(baseUrl));
	return known?.name ?? host(baseUrl);
}
