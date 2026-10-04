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
	/** Give up after this long, so a stalled provider cannot leave the UI waiting forever. */
	timeoutMs?: number;
}

/**
 * GPT-OSS models reason before answering, and that reasoning counts against
 * `max_tokens`. At the default effort it used ~2100 of the 3072-token
 * evaluation budget, so the JSON answer was cut off and Groq rejected it
 * (`json_validate_failed`). At low effort: 130–440 reasoning tokens, 3/3 valid
 * answers, ~4 s instead of ~7 s (measured 2026-10-04). Only GPT-OSS gets the
 * parameter; other providers may reject it.
 */
function reasoningOptions(model: string): Record<string, string> {
	return model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {};
}

/** Long enough for a reasoning model's full evaluation, short enough to surface a stall. */
export const DEFAULT_LLM_TIMEOUT_MS = 120_000;

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/**
 * `fetch` with a deadline and readable failures. A bare `TypeError: Failed to
 * fetch` (offline, DNS, CORS, a typo in a custom base URL) and an `AbortError`
 * otherwise reach the learner verbatim.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	{ timeoutMs = DEFAULT_LLM_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Response> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const forward = () => controller.abort();
	if (signal?.aborted) controller.abort();
	else signal?.addEventListener('abort', forward, { once: true });
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (timedOut) {
			throw new Error(`${hostOf(url)} did not respond within ${Math.round(timeoutMs / 1000)}s.`);
		}
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new Error(
			`Could not reach ${hostOf(url)}. Check your connection${init.method === 'POST' ? ' and the provider URL' : ''}.`
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', forward);
	}
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
	{
		temperature = 0.2,
		maxTokens = 2048,
		json = false,
		signal,
		timeoutMs = DEFAULT_LLM_TIMEOUT_MS
	}: ChatCompletionOptions = {}
): Promise<string> {
	const base = endpoint.baseUrl.trim().replace(/\/+$/, '');
	if (!base) throw new Error('No LLM base URL configured.');
	if (!endpoint.apiKey) throw new Error('No API key configured for this provider.');
	if (!endpoint.model.trim()) throw new Error('No LLM model selected. Choose one in Settings.');

	const response = await fetchWithTimeout(
		`${base}/chat/completions`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${endpoint.apiKey.trim()}`
			},
			body: JSON.stringify({
				model: endpoint.model,
				messages,
				temperature,
				max_tokens: maxTokens,
				...reasoningOptions(endpoint.model),
				...(json ? { response_format: { type: 'json_object' } } : {})
			})
		},
		{ timeoutMs, signal }
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`${endpoint.model} request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, MAX_ERROR_CHARS)}` : ''}`
		);
	}

	// A misconfigured custom base URL can answer 200 with an HTML page.
	const data = await response.json().catch(() => {
		throw new Error(`${hostOf(base)} did not return a chat-completions response. Check the provider URL.`);
	});
	const content = data?.choices?.[0]?.message?.content;
	// Some OpenAI-compatible gateways return content as an array of parts.
	if (Array.isArray(content)) {
		return content
			.map((part: unknown) =>
				typeof part === 'string' ? part : ((part as { text?: unknown })?.text ?? '')
			)
			.join('');
	}
	return typeof content === 'string' ? content : '';
}

/**
 * Verifies that the endpoint, key and model actually work together by sending a
 * one-token chat completion. Returns the model's reply (normally "OK").
 *
 * A chat call is used rather than `GET /models` so the test exercises the exact
 * path evaluation uses, including model availability on the key.
 */
export async function testConnection(endpoint: LlmEndpoint, timeoutMs = 20000): Promise<string> {
	const reply = await chatCompletion(
		endpoint,
		[
			{
				role: 'system',
				content: 'You are a connection check. Reply with the single word OK and nothing else.'
			},
			{ role: 'user', content: 'Connection test' }
		],
		{ maxTokens: 16, temperature: 0, timeoutMs }
	);
	const cleaned = stripThinking(reply);
	return cleaned || reply.trim();
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
	const base = endpoint.baseUrl.trim().replace(/\/+$/, '');
	if (!base) throw new Error('No LLM base URL configured.');
	if (!endpoint.apiKey) throw new Error('Add an API key first, then refresh the model list.');

	const response = await fetchWithTimeout(
		`${base}/models`,
		{ headers: { Authorization: `Bearer ${endpoint.apiKey.trim()}` } },
		{ timeoutMs: 20_000 }
	);
	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`Could not list models (HTTP ${response.status})${detail ? `: ${detail.slice(0, MAX_ERROR_CHARS)}` : ''}`
		);
	}

	const data = await response.json().catch(() => null);
	const entries: unknown = data?.data ?? data;
	if (!Array.isArray(entries)) return [];
	return entries
		.map((entry) =>
			typeof entry === 'string' ? entry : ((entry as { id?: unknown })?.id ?? '')
		)
		.filter((id): id is string => typeof id === 'string' && id.length > 0)
		.filter((id) => !NON_CHAT_MODEL.test(id));
}
