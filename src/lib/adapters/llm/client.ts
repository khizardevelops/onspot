import type { ChatMessage, LlmEndpoint } from './types';

/**
 * Provider error bodies are shown in the UI, so give them room. A 300-char cut
 * previously truncated the actionable part of Groq's error messages.
 */
const MAX_ERROR_CHARS = 2000;

/**
 * Removes `<think>…</think>` reasoning blocks. Some models (GPT-OSS) emit them,
 * and they both clutter the connection-test message and contain braces that
 * confuse the JSON extractor.
 */
export function stripThinking(text: string): string {
	const withoutBlocks = text.replace(/<think[\s\S]*?<\/think>/gi, '');
	// A truncated response can leave an unclosed block; drop from there on.
	const open = withoutBlocks.toLowerCase().indexOf('<think');
	return (open >= 0 ? withoutBlocks.slice(0, open) : withoutBlocks).trim();
}

interface ChatCompletionOptions {
	temperature?: number;
	maxTokens?: number;
	/** Ask providers that support it for a JSON object response. */
	json?: boolean;
	signal?: AbortSignal;
}

/**
 * Minimal OpenAI-compatible Chat Completions client.
 *
 * Groq, DeepSeek and most self-hosted gateways implement this shape, so one
 * function covers them all. Provider errors are surfaced with the response body
 * so a 401 (bad key) or 429 (quota) is actionable in the UI.
 */
export async function chatCompletion(
	endpoint: LlmEndpoint,
	messages: ChatMessage[],
	{ temperature = 0.2, maxTokens = 2048, json = false, signal }: ChatCompletionOptions = {}
): Promise<string> {
	const base = endpoint.baseUrl.replace(/\/+$/, '');
	if (!base) throw new Error('No LLM base URL configured.');
	if (!endpoint.apiKey) throw new Error('No API key configured for this provider.');

	const response = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${endpoint.apiKey}`
		},
		body: JSON.stringify({
			model: endpoint.model,
			messages,
			temperature,
			max_tokens: maxTokens,
			...(json ? { response_format: { type: 'json_object' } } : {})
		}),
		signal
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`${endpoint.model} request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, MAX_ERROR_CHARS)}` : ''}`
		);
	}

	const data = await response.json();
	return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Verifies that the endpoint, key and model actually work together by sending a
 * one-token chat completion. Returns the model's reply (normally "OK").
 *
 * A chat call is used rather than `GET /models` so the test exercises the exact
 * path evaluation uses, including model availability on the key.
 */
export async function testConnection(endpoint: LlmEndpoint, timeoutMs = 20000): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const reply = await chatCompletion(
			endpoint,
			[
				{
					role: 'system',
					content: 'You are a connection check. Reply with the single word OK and nothing else.'
				},
				{ role: 'user', content: 'Connection test' }
			],
			{ maxTokens: 16, temperature: 0, signal: controller.signal }
		);
		const cleaned = stripThinking(reply);
		return cleaned || reply.trim();
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw new Error(`No response within ${Math.round(timeoutMs / 1000)}s.`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Ids from `/models` that are not chat-completion models: speech-to-text
 * (whisper), text-to-speech (orpheus), and classifiers/guards. The evaluation
 * engine needs a chat model, so they are filtered out of the dropdown.
 */
const NON_CHAT_MODEL = /whisper|orpheus|prompt-guard|safeguard|\btts\b|embed|moderation|guard/i;

/**
 * Lists the model ids a key can access, via the OpenAI-compatible `GET /models`
 * endpoint, filtered to chat models. Used by Settings' "Refresh" so the
 * dropdown can show models the provider has added since this build.
 */
export async function listModels(endpoint: LlmEndpoint): Promise<string[]> {
	const base = endpoint.baseUrl.replace(/\/+$/, '');
	if (!base) throw new Error('No LLM base URL configured.');
	if (!endpoint.apiKey) throw new Error('Add an API key first, then refresh the model list.');

	const response = await fetch(`${base}/models`, {
		headers: { Authorization: `Bearer ${endpoint.apiKey}` }
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`Could not list models (HTTP ${response.status})${detail ? `: ${detail.slice(0, MAX_ERROR_CHARS)}` : ''}`
		);
	}

	const data = await response.json();
	const entries: unknown = data?.data ?? data;
	if (!Array.isArray(entries)) return [];
	return entries
		.map((entry) =>
			typeof entry === 'string' ? entry : ((entry as { id?: unknown })?.id ?? '')
		)
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
		.filter((id) => !NON_CHAT_MODEL.test(id));
}
