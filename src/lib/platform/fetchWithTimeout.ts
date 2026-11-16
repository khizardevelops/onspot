// SPDX-License-Identifier: AGPL-3.0-or-later

import { isTauri } from './runtime.js';

/** Long enough for a reasoning model's full evaluation, short enough to surface a stall. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

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
 * would otherwise reach the learner verbatim.
 *
 * @param url Where to send the request.
 * @param init The request, as for `fetch`.
 * @param options `timeoutMs` (default two minutes) and a `signal` that cancels it.
 * @returns The response, whatever its status.
 * @throws A readable `Error` when the host does not answer in time or cannot be reached.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	{ timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
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
