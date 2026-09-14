import type { LlmModelOption, LlmProviderConfig, LlmProviderId } from './types';

/**
 * Known model ids. This is the enum the settings dropdown is built from; the
 * `(string & {})` arm keeps autocomplete while allowing a model fetched live
 * from the provider or typed for the custom provider.
 */
export type LlmModelId =
	| 'openai/gpt-oss-120b'
	| 'openai/gpt-oss-20b'
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
 * Curated model dropdown per provider.
 *
 * Groq: only generally-available chat models. Llama 3.1/3.3 are Enterprise-only
 * (they 404 on a standard key), and the account-specific truth comes from the
 * "Refresh" button, which filters the live list to chat models.
 * DeepSeek: current model names (the old `deepseek-chat`/`deepseek-reasoner`
 * names are legacy).
 */
export const LLM_MODELS: Record<LlmProviderId, LlmModelOption[]> = {
	groq: [
		{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', note: 'Default, best quality' },
		{ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', note: 'Faster' }
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
