// SPDX-License-Identifier: AGPL-3.0-or-later

import { writable } from 'svelte/store';
import { hashText } from '#lib/utils/hash.js';
import { parseRateLimitHeaders, parseRefusal, type HeaderLimits, type LimitWindow } from './rateLimits';

/**
 * The device's own record of cloud calls, for the usage monitor.
 *
 * Every cloud adapter reports here what one call used (tokens, audio seconds,
 * characters), the rate-limit headers it could read, and any limit a refusal
 * named. The record stays in this browser's `localStorage`, like the keys
 * themselves: it is per device and must never reach the synced database. Calls
 * are kept for a day, the longest window a counted limit uses; ElevenLabs'
 * monthly allowance comes from its account API instead.
 */

const STORAGE_KEY = 'onspot.usage.v1';

/** The longest counted window (requests, tokens and audio per day). */
export const LEDGER_RETENTION_MS = 24 * 60 * 60 * 1_000;

/** Calls made without a key (a local server) share one bucket. */
const NO_KEY = 'no-key';

export interface CloudCall {
	/** Provider host, e.g. `api.groq.com`. */
	host: string;
	model: string;
	/** Hash of the API key that made the call, so two accounts never mix. */
	keyId: string;
	at: number;
	/** Tokens the call used (prompt + reply). */
	tokens: number;
	/**
	 * Tokens the provider set aside to admit the call: the prompt plus the
	 * requested `max_tokens`. Groq checks this, not what the reply ends up
	 * using, against the per-minute limit. Zero for calls without a reply budget.
	 */
	reservedTokens: number;
	audioSeconds: number;
	characters: number;
}

export interface LiveReading extends HeaderLimits, Partial<UsageScope> {
	observedAt: number;
}

export interface ReportedReading {
	limit: number;
	used: number | null;
	retryAt: number | null;
	observedAt: number;
}

export interface LedgerState {
	calls: CloudCall[];
	/** Latest rate-limit headers per scope (`scopeKey`). */
	live: Record<string, LiveReading>;
	/** Latest limit named in a refusal, per scope and window. */
	reported: Record<string, Partial<Record<LimitWindow, ReportedReading>>>;
}

/** What one key used on one model of one provider. */
export interface UsageScope {
	host: string;
	model: string;
	keyId: string;
}

export interface CallInput {
	/** The URL the call went to; only its host is kept. */
	url: string;
	apiKey: string;
	model: string;
	tokens?: number;
	reservedTokens?: number;
	audioSeconds?: number;
	characters?: number;
	headers?: Headers;
}

export interface RefusalInput {
	url: string;
	apiKey: string;
	model: string;
	body: string;
}

const EMPTY_LEDGER: LedgerState = { calls: [], live: {}, reported: {} };

/**
 * A short, non-reversible id for an API key.
 *
 * @param apiKey The key as entered; may be empty for a local server.
 * @returns A stable id for bookkeeping.
 */
export function keyIdOf(apiKey: string): string {
	const key = apiKey.trim();
	return key ? hashText(key) : NO_KEY;
}

/** The ledger key of a scope. */
export function scopeKey(scope: UsageScope): string {
	return `${scope.keyId}|${scope.host}|${scope.model}`;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function isRecent(timestamp: number, now: number): boolean {
	return now - timestamp < LEDGER_RETENTION_MS;
}

/** Drops everything older than the retention window. */
function prune(state: LedgerState, now: number): LedgerState {
	const calls = state.calls.filter((call) => isRecent(call.at, now));
	const live = Object.fromEntries(
		Object.entries(state.live).filter(([, reading]) => isRecent(reading.observedAt, now))
	);
	const reported = Object.fromEntries(
		Object.entries(state.reported).map(([key, windows]) => [
			key,
			Object.fromEntries(Object.entries(windows).filter(([, reading]) => reading && isRecent(reading.observedAt, now)))
		])
	);

	return { calls, live, reported };
}

function load(): LedgerState {
	try {
		const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY_LEDGER;

		const parsed = JSON.parse(raw) as Partial<LedgerState>;
		const state: LedgerState = {
			calls: Array.isArray(parsed.calls) ? parsed.calls : [],
			live: parsed.live && typeof parsed.live === 'object' ? parsed.live : {},
			reported: parsed.reported && typeof parsed.reported === 'object' ? parsed.reported : {}
		};
		return prune(state, Date.now());
	} catch (error) {
		console.warn('[usage] ignoring an unreadable usage record', error);
		return EMPTY_LEDGER;
	}
}

function save(state: LedgerState): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch (error) {
		// Storage full or blocked: the monitor still works for this session.
		console.warn('[usage] could not save the usage record', error);
	}
}

const store = writable<LedgerState>(load());
store.subscribe(save);

export const usageLedger = { subscribe: store.subscribe };

/**
 * Records one successful cloud call: what it used and the rate-limit headers
 * it carried (when this runtime can read them).
 *
 * @param input The call's URL, key, model and usage.
 */
export function recordCall(input: CallInput): void {
	const now = Date.now();
	const scope: UsageScope = { host: hostOf(input.url), model: input.model, keyId: keyIdOf(input.apiKey) };
	const call: CloudCall = {
		...scope,
		at: now,
		tokens: input.tokens ?? 0,
		reservedTokens: input.reservedTokens ?? 0,
		audioSeconds: input.audioSeconds ?? 0,
		characters: input.characters ?? 0
	};
	const headerLimits = input.headers ? parseRateLimitHeaders(input.headers, now) : null;

	store.update((state) => {
		const next = prune(state, now);
		next.calls = [...next.calls, call];
		if (headerLimits) next.live = { ...next.live, [scopeKey(scope)]: { ...headerLimits, ...scope, observedAt: now } };
		return next;
	});
}

/**
 * Records the limit a refusal (HTTP 413/429) names, if it names one. A stated
 * limit replaces the published one, so a paid plan's higher limits show up.
 *
 * @param input The refused call's URL, key, model and response body.
 */
export function recordRefusal(input: RefusalInput): void {
	const now = Date.now();
	const refusal = parseRefusal(input.body, now);
	if (!refusal) return;

	const key = scopeKey({ host: hostOf(input.url), model: input.model, keyId: keyIdOf(input.apiKey) });
	const reading: ReportedReading = {
		limit: refusal.limit,
		used: refusal.used,
		retryAt: refusal.retryAt,
		observedAt: now
	};

	store.update((state) => ({
		...state,
		reported: { ...state.reported, [key]: { ...state.reported[key], [refusal.window]: reading } }
	}));
}

export interface CallTotals {
	requests: number;
	tokens: number;
	audioSeconds: number;
	characters: number;
}

/**
 * Adds up the calls of one scope within a rolling window.
 *
 * @param state The ledger.
 * @param scope Which key, provider and model; `model: '*'` covers every model.
 * @param windowMs How far back to count, e.g. one minute or one day.
 * @param now The current time (ms since epoch).
 * @returns Requests, tokens, audio seconds and characters in the window.
 */
export function totalsWithin(state: LedgerState, scope: UsageScope, windowMs: number, now: number): CallTotals {
	const totals: CallTotals = { requests: 0, tokens: 0, audioSeconds: 0, characters: 0 };

	for (const call of state.calls) {
		const sameScope =
			call.keyId === scope.keyId && call.host === scope.host && (scope.model === '*' || call.model === scope.model);
		if (!sameScope || now - call.at >= windowMs) continue;

		totals.requests += 1;
		totals.tokens += call.tokens;
		totals.audioSeconds += call.audioSeconds;
		totals.characters += call.characters;
	}

	return totals;
}
