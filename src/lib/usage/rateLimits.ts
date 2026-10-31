// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reads what a provider's response says about its rate limits.
 *
 * Groq and OpenAI send `x-ratelimit-*` headers on every response. Groq's
 * `requests` pair is the daily request budget (RPD) and its `tokens` pair the
 * per-minute token budget (TPM); OpenAI's are both per minute. Browsers can
 * only read these when the provider lists them in
 * `access-control-expose-headers`, which neither does (checked 2026-10-30), so
 * in the web build they come back empty and the desktop/Android apps (Tauri's
 * HTTP client) are the ones that see them.
 *
 * A refusal (HTTP 413/429) states the limit it hit in its message body, which
 * every runtime can read: "… on tokens per minute (TPM): Limit 8000, Used 7843,
 * Requested 2416. Please try again in 16.9s."
 */

/** The limit windows providers name in their refusals. */
export type LimitWindow = 'RPM' | 'RPD' | 'TPM' | 'TPD' | 'ASH' | 'ASD';

export interface HeaderBudget {
	limit: number;
	remaining: number;
	/** When the budget is full again (ms since epoch), if the provider said. */
	resetsAt: number | null;
}

export interface HeaderLimits {
	requests: HeaderBudget | null;
	tokens: HeaderBudget | null;
}

export interface RefusalLimit {
	window: LimitWindow;
	limit: number;
	/** How much the provider says was already used, when it says. */
	used: number | null;
	/** When the provider says to try again (ms since epoch), if it says. */
	retryAt: number | null;
}

const DURATION_PART = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;

const MILLISECONDS_PER_UNIT: Record<string, number> = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000
};

/**
 * Parses the duration format of `x-ratelimit-reset-*` ("1m26.4s", "547ms",
 * "7.66s", "2h0m0s"); a bare number is read as seconds.
 *
 * @param value The header value.
 * @returns Milliseconds, or null when the value is not a duration.
 */
export function parseDuration(value: string | null): number | null {
	if (!value) return null;
	const text = value.trim();

	if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1_000;

	let total = 0;
	let matched = '';
	for (const match of text.matchAll(DURATION_PART)) {
		total += Number(match[1]) * MILLISECONDS_PER_UNIT[match[2]];
		matched += match[0];
	}

	return matched === text ? total : null;
}

function readBudget(headers: Headers, kind: 'requests' | 'tokens', now: number): HeaderBudget | null {
	const limit = Number(headers.get(`x-ratelimit-limit-${kind}`));
	const remaining = Number(headers.get(`x-ratelimit-remaining-${kind}`));
	if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return null;

	const resetIn = parseDuration(headers.get(`x-ratelimit-reset-${kind}`));
	return {
		limit,
		remaining: Math.max(0, Math.min(limit, remaining)),
		resetsAt: resetIn === null ? null : now + resetIn
	};
}

/**
 * Reads the `x-ratelimit-*` headers of a response.
 *
 * @param headers The response headers.
 * @param now The time the response arrived (ms since epoch).
 * @returns The budgets present, or null when the headers are absent or hidden.
 */
export function parseRateLimitHeaders(headers: Headers, now: number): HeaderLimits | null {
	const requests = readBudget(headers, 'requests', now);
	const tokens = readBudget(headers, 'tokens', now);
	return requests || tokens ? { requests, tokens } : null;
}

const REFUSAL_LIMIT = /\((RPM|RPD|TPM|TPD|ASH|ASD)\):\s*Limit\s+(\d+)(?:,\s*Used\s+(\d+))?/i;
const RETRY_IN = /try again in\s+([\dhms.]+)/i;

/**
 * Reads the limit a refusal names, e.g. Groq's "on tokens per day (TPD):
 * Limit 200000, Used 199052, Requested 2410".
 *
 * @param body The refusal's response body.
 * @param now When the refusal arrived (ms since epoch).
 * @returns The window, its limit and the reported use, or null when the body names none.
 */
export function parseRefusal(body: string, now: number): RefusalLimit | null {
	const match = body.match(REFUSAL_LIMIT);
	if (!match) return null;

	const retryIn = parseDuration(body.match(RETRY_IN)?.[1]?.replace(/\.$/, '') ?? null);
	return {
		window: match[1].toUpperCase() as LimitWindow,
		limit: Number(match[2]),
		used: match[3] === undefined ? null : Number(match[3]),
		retryAt: retryIn === null ? null : now + retryIn
	};
}
