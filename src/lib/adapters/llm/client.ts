// SPDX-License-Identifier: AGPL-3.0-or-later

import { isTauri } from '#lib/platform/runtime.js';
import { recordCall, recordRefusal } from '#lib/usage/ledger.js';
import { repairJson } from './jsonRepair.js';
import type { ChatMessage, LlmEndpoint } from './types.js';

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
 * A Tauri webview `fetch` is subject to the browser origin policy, which a local
 * LM Studio / llama.cpp / Ollama server often does not allow. The Tauri HTTP
 * plugin uses Rust's client instead; the browser build keeps global fetch.
 */
let nativeFetch: typeof fetch | null = null;

async function requestFetch(): Promise<typeof fetch> {
	if (!isTauri()) return fetch;
	if (!nativeFetch) {
		const { fetch: pluginFetch } = await import('@tauri-apps/plugin-http');
		nativeFetch = pluginFetch as unknown as typeof fetch;
	}
	return nativeFetch;
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
		const request = await requestFetch();
		return await request(url, { ...init, signal: controller.signal });
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
 * Groq checks JSON-mode replies itself and answers HTTP 400
 * `json_validate_failed` over a single stray character, returning the model's
 * text as `failed_generation`. That text, when there is one, is the reply.
 */
function rejectedJsonReply(errorBody: string): string | null {
	try {
		const error = (JSON.parse(errorBody) as { error?: { code?: unknown; failed_generation?: unknown } })?.error;
		const rejected = error?.code === 'json_validate_failed' && typeof error.failed_generation === 'string';
		return rejected ? (error.failed_generation as string) : null;
	} catch {
		return null;
	}
}

/** Retries for a reply rejected as invalid JSON that cannot be repaired: the model rarely repeats the slip. */
const INVALID_JSON_RETRIES = 1;

/**
 * Minimal OpenAI-compatible Chat Completions client.
 *
 * Groq, DeepSeek and most self-hosted gateways implement this shape, so one
 * function covers them all. Provider errors are surfaced with the response body
 * so a 401 (bad key) or 429 (quota) is actionable in the UI. A JSON reply the
 * provider rejected over a known slip is repaired and used; otherwise it is
 * asked for once more.
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
	if (!endpoint.model.trim()) throw new Error('No LLM model selected. Choose one in Settings.');

	// A local server (LM Studio, llama.cpp, Ollama) often has no key. Cloud
	// providers are gated in Settings before reaching this call.
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (endpoint.apiKey.trim()) headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;

	const url = `${base}/chat/completions`;
	const body = JSON.stringify({
		model: endpoint.model,
		messages,
		temperature,
		max_tokens: maxTokens,
		...reasoningOptions(endpoint.model),
		...(json ? { response_format: { type: 'json_object' } } : {})
	});

	for (let attempt = 0; ; attempt++) {
		const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, { timeoutMs, signal });

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			recordRefusal({ url, apiKey: endpoint.apiKey, model: endpoint.model, body: detail });

			const rejected = json ? rejectedJsonReply(detail) : null;
			if (rejected !== null) {
				const repaired = repairJson(rejected);
				if (repaired) return repaired;
				if (attempt < INVALID_JSON_RETRIES) continue;
				throw new Error(`${endpoint.model}'s reply wasn't valid JSON. Please try again.`);
			}
			throw new Error(
				`${endpoint.model} request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, MAX_ERROR_CHARS)}` : ''}`
			);
		}

		// A misconfigured custom base URL can answer 200 with an HTML page.
		const data = await response.json().catch(() => {
			throw new Error(`${hostOf(base)} did not return a chat-completions response. Check the provider URL.`);
		});
		const totalTokens = Number(data?.usage?.total_tokens);
		const promptTokens = Number(data?.usage?.prompt_tokens);
		recordCall({
			url,
			apiKey: endpoint.apiKey,
			model: endpoint.model,
			tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
			// What the provider had to set aside to admit this call (see `CloudCall.reservedTokens`).
			reservedTokens: Number.isFinite(promptTokens) ? promptTokens + maxTokens : 0,
			headers: response.headers
		});
		return replyText(data);
	}
}

/** The reply's text; some OpenAI-compatible gateways return content as an array of parts. */
function replyText(data: unknown): string {
	const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
	if (Array.isArray(content)) {
		return content
			.map((part: unknown) => (typeof part === 'string' ? part : ((part as { text?: unknown })?.text ?? '')))
			.join('');
	}
	return typeof content === 'string' ? content : '';
}

/**
 * Verifies that the endpoint, optional key and model actually work together by
 * sending a one-token chat completion. Returns the model's reply (normally "OK").
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
 * Whether a provider model id is a chat model the LLM step can use.
 *
 * @param id A model id from a provider's `/models` list or limits table.
 */
export function isChatModel(id: string): boolean {
	return !NON_CHAT_MODEL.test(id);
}

/**
 * Lists the model ids a key can access, via the OpenAI-compatible `GET /models`
 * endpoint, filtered to chat models. Used by Settings' "Refresh" so the
 * dropdown can show models the provider has added since this build.
 */
export async function listModels(endpoint: LlmEndpoint): Promise<string[]> {
	const base = endpoint.baseUrl.trim().replace(/\/+$/, '');
	if (!base) throw new Error('No LLM base URL configured.');

	const headers: Record<string, string> = {};
	if (endpoint.apiKey.trim()) headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;

	const response = await fetchWithTimeout(
		`${base}/models`,
		{ headers },
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
		.filter(isChatModel);
}
