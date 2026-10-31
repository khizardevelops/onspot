// SPDX-License-Identifier: AGPL-3.0-or-later

import { isTauri } from '#lib/platform/runtime.js';
import { SyncError } from './types.js';

/**
 * One HTTP entry point for sync providers.
 *
 * A Tauri webview applies the browser same-origin policy to `fetch`, so Google
 * Drive and most WebDAV servers would be blocked. The Tauri HTTP plugin uses
 * Rust's client instead and has no such restriction. The browser build keeps
 * the ordinary `fetch`, subject to the server's CORS response.
 */

/** Long enough for a large backup upload, short enough to surface a stalled server. */
export const DEFAULT_SYNC_TIMEOUT_MS = 120_000;

/** Provider error bodies are shown in the UI, so keep the actionable tail. */
const MAX_ERROR_BODY_CHARS = 2000;

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let resolvedFetch: Promise<FetchFunction> | null = null;

async function getFetch(): Promise<FetchFunction> {
	if (!isTauri()) return globalThis.fetch.bind(globalThis);

	if (!resolvedFetch) {
		resolvedFetch = import('@tauri-apps/plugin-http').then(
			(module) => module.fetch as unknown as FetchFunction
		);
	}

	return resolvedFetch;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function isCorsFailure(error: unknown): boolean {
	return error instanceof TypeError && !isTauri();
}

/**
 * Performs a request with a deadline and a learner-readable network failure.
 *
 * @param url Absolute request URL.
 * @param init Standard fetch options; a caller-provided signal is honoured.
 * @param timeoutMs Deadline for the whole request.
 * @returns The raw response; callers decide what a non-2xx status means.
 */
export async function httpRequest(
	url: string,
	init: RequestInit = {},
	timeoutMs = DEFAULT_SYNC_TIMEOUT_MS
): Promise<Response> {
	const controller = new AbortController();
	let timedOut = false;

	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	const forwardAbort = () => controller.abort();

	if (init.signal?.aborted) controller.abort();
	else init.signal?.addEventListener('abort', forwardAbort, { once: true });

	try {
		const fetchFunction = await getFetch();
		return await fetchFunction(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (timedOut) {
			throw new SyncError(`${hostOf(url)} did not respond within ${Math.round(timeoutMs / 1000)}s.`);
		}

		if (error instanceof DOMException && error.name === 'AbortError') throw error;

		if (isCorsFailure(error)) {
			throw new SyncError(
				`Could not reach ${hostOf(url)} from this browser. The server may be offline, or its CORS policy may block this origin. The desktop app is not affected.`
			);
		}

		const detail = error instanceof Error ? error.message : String(error);
		throw new SyncError(`Could not reach ${hostOf(url)}: ${detail || 'network error'}.`);
	} finally {
		clearTimeout(timer);
		init.signal?.removeEventListener('abort', forwardAbort);
	}
}

/**
 * Reads a provider's error body, keeping the part that usually explains the
 * failure. Google and WebDAV servers both return short human-readable text.
 *
 * @param response Non-ok response.
 * @returns The trimmed body, capped for display.
 */
export async function readErrorBody(response: Response): Promise<string> {
	let body = '';

	try {
		body = await response.text();
	} catch {
		return '';
	}

	const trimmed = body.trim();
	if (trimmed.length <= MAX_ERROR_BODY_CHARS) return trimmed;

	return `${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}…`;
}

/**
 * Turns a non-ok response into a `SyncError` with the provider's explanation.
 *
 * @param response Response to validate.
 * @param action What the caller was doing, e.g. "Google Drive upload".
 * @returns The same response when it is ok.
 */
export async function requireOk(response: Response, action: string): Promise<Response> {
	if (response.ok) return response;

	const body = await readErrorBody(response);
	const detail = body ? `: ${body}` : '.';
	const needsReconnect = response.status === 401;

	throw new SyncError(`${action} failed (HTTP ${response.status})${detail}`, needsReconnect);
}
