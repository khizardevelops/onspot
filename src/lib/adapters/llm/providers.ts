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
		{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Default, best quality' },
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

export function getProvider(id: LlmProviderId): LlmProviderConfig {
	return LLM_PROVIDERS[id] ?? LLM_PROVIDERS.custom;
}

export function getModelOptions(id: LlmProviderId): LlmModelOption[] {
	return LLM_MODELS[id] ?? [];
}
