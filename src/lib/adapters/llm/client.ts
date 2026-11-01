// SPDX-License-Identifier: AGPL-3.0-or-later

import { isTauri } from '#lib/platform/runtime.js';
import { recordCall, recordRefusal } from '#lib/usage/ledger.js';
import { repairJson } from './jsonRepair.js';
import { modelLabel } from './providers.js';
import {
	admit,
	DEFAULT_PATIENCE_MS,
	learnFromRefusal,
	planRequest,
	release,
	settle,
	waitForRoom,
	type Admission
} from './pacing.js';
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
	/**
	 * How long to wait for the endpoint's own model before a fallback model
	 * takes the request (see `pacing.ts`): longer where the best model's
	 * quality matters most.
	 */
	patienceMs?: number;
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
 * Refusals one request may meet before it fails: each sends it to another
 * model, or waits, and teaches the pacing a limit, so a few are enough.
 * Waiting for room is not a refusal and does not count.
 */
const MAX_REFUSALS = 6;

/**
 * The readable part of a provider's error body: its `error.message` when the
 * body is the usual JSON, otherwise the body itself.
 */
function providerMessage(body: string): string {
	try {
		const message = (JSON.parse(body) as { error?: { message?: unknown } })?.error?.message;
		if (typeof message === 'string' && message.trim()) return message.trim();
	} catch {
		// not JSON
	}
	return body.trim();
}

/** A failed request's message for the learner: which model, what went wrong, and what the provider said. */
function failureMessage(model: string, status: number, body: string): string {
	const said = providerMessage(body).slice(0, MAX_ERROR_CHARS);
	const name = modelLabel(model);
	if (status === 401) return `${name}: the provider rejected the API key. Check it in Settings.${said ? ` (${said})` : ''}`;
	return `${name} request failed (HTTP ${status})${said ? `: ${said}` : ''}`;
}

/**
 * Minimal OpenAI-compatible Chat Completions client.
 *
 * Groq, DeepSeek and most self-hosted gateways implement this shape, so one
 * function covers them all. Every request goes through the rate-limit pacing
 * (`pacing.ts`): it waits for room under the model's per-minute allowance, or
 * goes to the next of the endpoint's fallback models, and a refusal is learnt
 * from and retried. Other provider errors are surfaced with the provider's
 * message so a 401 (bad key) is actionable in the UI. A JSON reply the
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
		timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
		patienceMs = DEFAULT_PATIENCE_MS
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
	const requestBody = (model: string) =>
		JSON.stringify({
			model,
			messages,
			temperature,
			max_tokens: maxTokens,
			...reasoningOptions(model),
			...(json ? { response_format: { type: 'json_object' } } : {})
		});
	const models = [endpoint.model, ...(endpoint.fallbackModels ?? []).filter((model) => model !== endpoint.model)];

	let invalidJsonReplies = 0;
	let refusals = 0;
	for (;;) {
		const plan = planRequest(endpoint, models, messages, maxTokens, patienceMs, Date.now());
		if (plan.waitMs > 0) {
			await waitForRoom(endpoint, plan.model, plan.waitMs, signal);
			// Planned again after the wait: other requests may have taken the room meanwhile.
			continue;
		}

		const admission = admit(plan, messages, Date.now());
		const response = await sendCharged(admission, () =>
			fetchWithTimeout(url, { method: 'POST', headers, body: requestBody(plan.model) }, { timeoutMs, signal })
		);

		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			recordRefusal({ url, apiKey: endpoint.apiKey, model: plan.model, body: detail });

			const rejected = json ? rejectedJsonReply(detail) : null;
			if (rejected !== null) {
				// The reply was written (and counted) even though the provider refused it.
				settle(admission, { promptTokens: 0, totalTokens: 0, cachedTokens: 0 }, response.headers, Date.now());
				const repaired = repairJson(rejected);
				if (repaired) return repaired;
				if (invalidJsonReplies++ < INVALID_JSON_RETRIES) continue;
				throw new Error(`${modelLabel(plan.model)}'s reply wasn't valid JSON. Please try again.`);
			}

			const outcome = learnFromRefusal(admission, response.status, detail, Date.now());
			if (outcome === 'try-again' && ++refusals < MAX_REFUSALS) continue;
			throw new Error(failureMessage(plan.model, response.status, detail));
		}

		// A misconfigured custom base URL can answer 200 with an HTML page.
		const data = await response.json().catch(() => {
			release(admission, Date.now());
			throw new Error(`${hostOf(base)} did not return a chat-completions response. Check the provider URL.`);
		});
		const usage = completedUsage(data);
		settle(admission, usage, response.headers, Date.now());
		recordCall({
			url,
			apiKey: endpoint.apiKey,
			model: plan.model,
			tokens: usage.totalTokens,
			// What the provider had to set aside to admit this call (see `CloudCall.reservedTokens`).
			reservedTokens: usage.promptTokens > 0 ? usage.promptTokens + maxTokens : 0,
			headers: response.headers
		});
		return replyText(data);
	}
}

/** Sends a charged request; a request that never reached the provider gives its charge back. */
async function sendCharged(admission: Admission, send: () => Promise<Response>): Promise<Response> {
	try {
		return await send();
	} catch (error) {
		release(admission, Date.now());
		throw error;
	}
}

/** The `usage` block of a chat-completions reply; zeros where a gateway leaves it out. */
function completedUsage(data: unknown): { promptTokens: number; totalTokens: number; cachedTokens: number } {
	const usage = (data as { usage?: Record<string, unknown> })?.usage ?? {};
	const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
	const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
	return {
		promptTokens: count(usage.prompt_tokens),
		totalTokens: count(usage.total_tokens),
		cachedTokens: count(details.cached_tokens)
	};
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
