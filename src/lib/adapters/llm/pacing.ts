// SPDX-License-Identifier: AGPL-3.0-or-later

import { get, writable } from 'svelte/store';
import { keyIdOf, scopeKey, totalsWithin, usageLedger, type LedgerState, type UsageScope } from '#lib/usage/ledger.js';
import { formatReset } from '#lib/usage/format.js';
import { GROQ_HOST, groqKnownLimits, groqPlanOf, type ModelLimits } from '#lib/usage/publishedLimits.js';
import { hashText } from '#lib/utils/hash.js';
import { parseRateLimitHeaders, parseRefusal } from '#lib/usage/rateLimits.js';
import { modelLabel, providerNameFor } from './providers';
import type { ChatMessage, LlmEndpoint } from './types';

/**
 * Keeps LLM requests inside a provider's rate limits instead of running into
 * them, and moves on to another model when one is out of room.
 *
 * Groq gives each model its own allowances per account, which refill
 * continuously: tokens a minute (8,000 for GPT-OSS on the free plan; a
 * request 2 tokens over is told to "try again in 15ms"), and for some models
 * reply tokens a minute (Qwen 3.8: 1,000, stated only in refusals). So the
 * client keeps its own copy of each allowance as a token bucket, charges
 * every request before sending it, and then either waits the moment it needs
 * or sends it to the next model in the rotation that has room. A model whose
 * daily allowance is used up is skipped until it resets.
 *
 * Only limits the provider has stated are paced: a refusal's "Limit 8000,
 * Used 5483", or the `x-ratelimit-*` headers the desktop and Android apps can
 * read. A paid plan allows far more than the published free limits, so
 * guessing them would slow it down for nothing; the first refusal costs no
 * tokens, is retried, and teaches the limit (the usage ledger keeps it for a
 * day).
 *
 * Choosing among the models (Automatic, see `automaticModels`): they arrive in
 * order of preference, and the request goes to the first that has room for it
 * now or within the caller's patience. Groq's published limits only steer
 * that choice: a model the request is expected not to fit (larger than its
 * minute's allowance) or whose daily allowance looks spent is tried after the
 * others, never refused, so a plan with higher limits still reaches it.
 */

/** Characters per token before a model's real ratio is known (French and JSON run denser than English prose). */
const DEFAULT_CHARS_PER_TOKEN = 3.4;

/** How fast a measured characters-per-token ratio follows new replies (exponential moving average). */
const CHARS_PER_TOKEN_SMOOTHING = 0.3;

/**
 * How long a system message the provider served from its cache is assumed to
 * stay cached. Groq leaves cached prompt tokens out of its rate limits, and
 * the evaluation's ~2,800-token instructions are the same for every take.
 */
const PROMPT_CACHE_MS = 10 * 60_000;

/** By default, waiting this long for the preferred model beats switching to a fallback. */
export const DEFAULT_PATIENCE_MS = 3_000;

/** Waits longer than this are not worth it: the request fails with a readable reason instead. */
const LONGEST_WAIT_MS = 65_000;

/** Added to every computed wait, so the request lands just after the allowance has refilled. */
const WAIT_MARGIN_MS = 120;

/** Shorter waits pass unannounced; a message for them would only flash. */
const ANNOUNCED_WAIT_MS = 1_000;

/** A minute allowance refills over this long. */
const MINUTE_MS = 60_000;

/** Daily allowances are counted over this rolling window. */
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long a model is skipped after a refusal that gives no time to try again. */
const RETRY_LATER_MS = {
	minute: 2_000,
	day: 60 * MINUTE_MS,
	serverError: 1_500
} as const;

/** The per-minute allowances that are paced: all tokens of a request, and its reply tokens alone. */
type PacedWindow = 'TPM' | 'OTPM';

/** One per-minute allowance of one model for one key, as a bucket that drains continuously. */
interface TokenBucket {
	capacity: number;
	/** Tokens charged and not yet refilled, as of `measuredAt`. */
	level: number;
	measuredAt: number;
}

/** Per-minute allowances by usage scope (`scopeKey`) and window. */
const buckets = new Map<string, TokenBucket>();

/** Until when a model is skipped (a daily allowance used up, a request-per-minute cap, a server error), by scope. */
const skippedUntil = new Map<string, number>();

/** Models a key cannot use (not found, not enabled for it), by scope. */
const unavailable = new Set<string>();

/** Measured characters per prompt token, by model. */
const charsPerToken = new Map<string, number>();

/** When the provider last served a system message from its cache, by model and message (`systemKey`). */
const cachedSystemMessages = new Map<string, number>();

/** Identifies a request's system message for one model; null without one. */
function systemKey(messages: ChatMessage[], model: string): string | null {
	const system = messages.find((message) => message.role === 'system');
	return system ? `${model}|${hashText(system.content)}` : null;
}

/** Characters of the prompt the provider will count: a system message it has cached is left out. */
function countedPromptChars(messages: ChatMessage[], model: string, now: number): number {
	const key = systemKey(messages, model);
	const cachedAt = key ? cachedSystemMessages.get(key) : undefined;
	const systemCached = cachedAt !== undefined && now - cachedAt < PROMPT_CACHE_MS;

	return messages
		.filter((message) => !(systemCached && message.role === 'system'))
		.reduce((total, message) => total + message.content.length, 0);
}

/** A request waiting for room, for the UI to explain the pause. */
export interface PacingWait {
	/** Whose limit it is waiting for, e.g. "Groq". */
	provider: string;
	model: string;
	/** When it will be sent (ms since epoch). */
	until: number;
}

/** The longest current wait, or null when nothing is waiting. */
export const pacingWait = writable<PacingWait | null>(null);

const waits = new Set<PacingWait>();

/** Which key, provider and model a request is charged to. */
export function scopeOf(endpoint: LlmEndpoint, model: string): UsageScope {
	let host = endpoint.baseUrl;
	try {
		host = new URL(endpoint.baseUrl).host;
	} catch {
		// keep the raw value; the ledger does the same
	}
	return { host, model, keyId: keyIdOf(endpoint.apiKey) };
}

function levelAt(bucket: TokenBucket, now: number): number {
	const refilled = ((now - bucket.measuredAt) * bucket.capacity) / MINUTE_MS;
	return Math.max(0, bucket.level - refilled);
}

function setLevel(bucket: TokenBucket, level: number, now: number): void {
	bucket.level = Math.max(0, level);
	bucket.measuredAt = now;
}

function addToLevel(bucket: TokenBucket | null, tokens: number, now: number): void {
	if (bucket) setLevel(bucket, levelAt(bucket, now) + tokens, now);
}

/**
 * A model's bucket for one window, sized by the limit the provider last
 * stated (a refusal outranks headers: it names the window it hit; headers
 * only ever describe all tokens). Null while no limit is known.
 */
function bucketOf(scope: UsageScope, window: PacedWindow, now: number): TokenBucket | null {
	const key = `${scopeKey(scope)}|${window}`;
	const ledger = get(usageLedger);
	const stated = ledger.reported[scopeKey(scope)]?.[window]?.limit;
	const capacity = stated ?? (window === 'TPM' ? ledger.live[scopeKey(scope)]?.tokens?.limit : undefined);
	if (!capacity) return buckets.get(key) ?? null;

	const bucket = buckets.get(key) ?? { capacity, level: 0, measuredAt: now };
	bucket.capacity = capacity;
	buckets.set(key, bucket);
	return bucket;
}

/** How long until `tokens` more fit in the bucket; 0 when they fit now. */
function refillWait(bucket: TokenBucket | null, tokens: number, now: number): number {
	if (!bucket) return 0;
	const overflow = levelAt(bucket, now) + tokens - bucket.capacity;
	return overflow > 0 ? (overflow * MINUTE_MS) / bucket.capacity + WAIT_MARGIN_MS : 0;
}

/**
 * How many tokens the provider will count a request as when admitting it:
 * the prompt (estimated from its length, without a system message it has
 * cached) plus the whole reply budget.
 */
export function requestTokens(messages: ChatMessage[], model: string, maxTokens: number, now: number): number {
	const ratio = charsPerToken.get(model) ?? DEFAULT_CHARS_PER_TOKEN;
	return Math.ceil(countedPromptChars(messages, model, now) / ratio) + maxTokens;
}

/** What it would cost to send a request to one model now. */
interface ModelOption {
	model: string;
	scope: UsageScope;
	tokens: number;
	waitMs: number;
	/** The request alone is larger than one of the model's stated per-minute allowances. */
	tooLarge: boolean;
	/** The request is expected to fit the model's published limits and what is left of today's. */
	expectedRoom: boolean;
}

/** Where to send a request, and how long to wait first. */
export interface RequestPlan {
	model: string;
	scope: UsageScope;
	tokens: number;
	maxTokens: number;
	waitMs: number;
}

/** No model can take the request (soon enough, or at all); the message says why, for the learner. */
export class RateLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RateLimitError';
	}
}

/** The limits Groq is known to set for a model on this key's plan; none for other providers. */
function expectedLimits(scope: UsageScope, ledger: LedgerState): ModelLimits {
	if (scope.host !== GROQ_HOST) return {};
	return groqKnownLimits(scope.model, groqPlanOf(ledger, scope.keyId));
}

/**
 * Whether a request is expected to fit a model: within each per-minute
 * allowance on its own, and within what is left of today's requests and
 * tokens. Today's use is the live header count where the app can read it,
 * otherwise what this device sent in the last 24 hours.
 */
function hasExpectedRoom(scope: UsageScope, tokens: number, maxTokens: number, ledger: LedgerState, now: number): boolean {
	const limits = expectedLimits(scope, ledger);
	const fitsMinute = tokens <= (limits.TPM ?? Infinity) && maxTokens <= (limits.OTPM ?? Infinity);

	const sentToday = totalsWithin(ledger, scope, DAY_MS, now);
	const liveRequests = ledger.live[scopeKey(scope)]?.requests;
	const liveStillCurrent = liveRequests && (liveRequests.resetsAt ?? Infinity) > now;
	const requestsLeft = liveStillCurrent ? liveRequests.remaining : (limits.RPD ?? Infinity) - sentToday.requests;
	const tokensLeft = (limits.TPD ?? Infinity) - sentToday.tokens;

	return fitsMinute && requestsLeft >= 1 && tokensLeft >= tokens;
}

function optionFor(endpoint: LlmEndpoint, model: string, messages: ChatMessage[], maxTokens: number, now: number): ModelOption {
	const scope = scopeOf(endpoint, model);
	const tokens = requestTokens(messages, model, maxTokens, now);
	const allTokens = bucketOf(scope, 'TPM', now);
	const replyTokens = bucketOf(scope, 'OTPM', now);

	const skipWait = Math.max(0, (skippedUntil.get(scopeKey(scope)) ?? 0) - now);
	const waitMs = Math.max(refillWait(allTokens, tokens, now), refillWait(replyTokens, maxTokens, now), skipWait);
	const tooLarge = (allTokens !== null && tokens > allTokens.capacity) || (replyTokens !== null && maxTokens > replyTokens.capacity);
	const expectedRoom = hasExpectedRoom(scope, tokens, maxTokens, get(usageLedger), now);

	return { model, scope, tokens, waitMs: Math.ceil(waitMs), tooLarge, expectedRoom };
}

/**
 * Chooses the model for a request: the first in order of preference that has
 * room now or within `patienceMs`, otherwise whichever has room soonest.
 * Models expected to have no room (`hasExpectedRoom`) come after the others.
 *
 * @param endpoint The provider and key.
 * @param models The models to choose from, in order of preference.
 * @param messages The request, to size it.
 * @param maxTokens Its reply budget.
 * @param patienceMs How long a wait for the preferred model is worth before a fallback is used.
 * @param now The current time (ms since epoch).
 * @returns The model and how long to wait before sending.
 * @throws RateLimitError when no model can take it within a minute, or at all.
 */
export function planRequest(
	endpoint: LlmEndpoint,
	models: readonly string[],
	messages: ChatMessage[],
	maxTokens: number,
	patienceMs: number,
	now: number
): RequestPlan {
	const provider = providerNameFor(endpoint.baseUrl);
	const names = (list: readonly string[]) => list.map(modelLabel).join(', ');

	const options = models
		.filter((model) => !unavailable.has(scopeKey(scopeOf(endpoint, model))))
		.map((model) => optionFor(endpoint, model, messages, maxTokens, now));
	if (options.length === 0) {
		throw new RateLimitError(
			`${names(models)} ${models.length === 1 ? 'is' : 'are'} not available on this ${provider} key. Choose another model in Settings.`
		);
	}

	const fitting = options.filter((option) => !option.tooLarge);
	if (fitting.length === 0) {
		const capacity = bucketOf(options[0].scope, 'TPM', now)?.capacity;
		throw new RateLimitError(
			`This request is too long for ${names(options.map((option) => option.model))}: it needs about ${options[0].tokens.toLocaleString()} tokens${capacity ? `, and ${provider} allows ${capacity.toLocaleString()} a minute` : ''}.`
		);
	}

	// Stable order: preference within each group.
	const ranked = [...fitting.filter((option) => option.expectedRoom), ...fitting.filter((option) => !option.expectedRoom)];
	const soonest = ranked.reduce((best, option) => (option.waitMs < best.waitMs ? option : best));
	const chosen = ranked.find((option) => option.waitMs <= patienceMs) ?? soonest;
	if (chosen.waitMs > LONGEST_WAIT_MS) {
		throw new RateLimitError(
			`${provider}'s limits for ${names(fitting.map((option) => option.model))} are used up for now; they reset ${formatReset(now + chosen.waitMs, now)}. Try again then, or choose another provider in Settings.`
		);
	}
	return { model: chosen.model, scope: chosen.scope, tokens: chosen.tokens, maxTokens, waitMs: chosen.waitMs };
}

/** A request charged to a model's allowances, until it is settled or released. */
export interface Admission {
	scope: UsageScope;
	tokens: number;
	/** Its reply budget, which the provider counts in full when admitting it. */
	maxTokens: number;
	/** The whole prompt's length, to learn characters per token from the reported prompt size. */
	promptChars: number;
	/** Its system message, noted as cached when the provider reports cached tokens. */
	systemKey: string | null;
}

/**
 * Charges a request to its model's allowances right before it is sent, so
 * requests planned at the same time see each other.
 */
export function admit(plan: RequestPlan, messages: ChatMessage[], now: number): Admission {
	addToLevel(bucketOf(plan.scope, 'TPM', now), plan.tokens, now);
	addToLevel(bucketOf(plan.scope, 'OTPM', now), plan.maxTokens, now);

	const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
	return { scope: plan.scope, tokens: plan.tokens, maxTokens: plan.maxTokens, promptChars, systemKey: systemKey(messages, plan.model) };
}

/** Takes a charge back: the request never reached the provider, or was refused (refusals cost nothing). */
export function release(admission: Admission, now: number): void {
	addToLevel(bucketOf(admission.scope, 'TPM', now), -admission.tokens, now);
	addToLevel(bucketOf(admission.scope, 'OTPM', now), -admission.maxTokens, now);
}

/** What a completed request used, from its `usage` block. */
export interface CompletedUsage {
	promptTokens: number;
	totalTokens: number;
	/** Prompt tokens served from the provider's cache, which Groq leaves out of its rate limits. */
	cachedTokens: number;
}

/** Learns the model's characters per prompt token from a prompt whose token count the provider stated. */
function learnPromptSize(admission: Admission, promptTokens: number): void {
	if (promptTokens <= 0) return;

	const model = admission.scope.model;
	const measured = admission.promptChars / promptTokens;
	const previous = charsPerToken.get(model) ?? measured;
	charsPerToken.set(model, previous + (measured - previous) * CHARS_PER_TOKEN_SMOOTHING);
}

/**
 * Replaces a request's charges with what it really used, learns the model's
 * characters-per-token ratio, and takes the provider's own count when its
 * headers are readable. A reply refused after it was written (invalid JSON)
 * reports no usage and keeps its whole charge.
 */
export function settle(admission: Admission, usage: CompletedUsage, headers: Headers, now: number): void {
	learnPromptSize(admission, usage.promptTokens);
	if (usage.cachedTokens > 0 && admission.systemKey) cachedSystemMessages.set(admission.systemKey, now);

	const reported = usage.totalTokens > 0;
	const counted = reported ? usage.totalTokens - usage.cachedTokens : admission.tokens;
	const replied = reported ? usage.totalTokens - usage.promptTokens : admission.maxTokens;
	addToLevel(bucketOf(admission.scope, 'TPM', now), counted - admission.tokens, now);
	addToLevel(bucketOf(admission.scope, 'OTPM', now), replied - admission.maxTokens, now);

	const stated = parseRateLimitHeaders(headers, now)?.tokens;
	if (!stated) return;

	const key = `${scopeKey(admission.scope)}|TPM`;
	const bucket = buckets.get(key) ?? { capacity: stated.limit, level: 0, measuredAt: now };
	bucket.capacity = stated.limit;
	setLevel(bucket, stated.limit - stated.remaining, now);
	buckets.set(key, bucket);
}

/** What to do after a refusal. */
export type RefusalOutcome = 'try-again' | 'give-up';

/**
 * Learns what a refusal says about the model's limits and decides whether
 * another attempt (after a wait, or on another model) can succeed. The
 * ledger has already recorded any limit the refusal stated; the buckets
 * pick it up when next planned.
 *
 * @param admission The refused request (its charge is taken back).
 * @param status The HTTP status.
 * @param body The response body.
 * @param now When the refusal arrived (ms since epoch).
 */
export function learnFromRefusal(admission: Admission, status: number, body: string, now: number): RefusalOutcome {
	release(admission, now);
	const key = scopeKey(admission.scope);

	if (isUnavailableModel(status, body)) {
		unavailable.add(key);
		return 'try-again';
	}

	if (status >= 500) {
		skippedUntil.set(key, now + RETRY_LATER_MS.serverError);
		return 'try-again';
	}

	if (status !== 429 && status !== 413) return 'give-up';

	const refusal = parseRefusal(body, now);
	switch (refusal?.window) {
		case 'TPM':
		case 'OTPM': {
			// The refusal's "Requested" is not used to size prompts: it leaves cached tokens out.
			const bucket = bucketOf(admission.scope, refusal.window, now);
			if (bucket && refusal.used !== null) setLevel(bucket, refusal.used, now);
			break;
		}
		case 'RPD':
		case 'TPD':
			skippedUntil.set(key, refusal.retryAt ?? now + RETRY_LATER_MS.day);
			break;
		default:
			skippedUntil.set(key, refusal?.retryAt ?? now + RETRY_LATER_MS.minute);
	}
	return 'try-again';
}

/** The model does not exist, was retired, or is not enabled for this key. */
function isUnavailableModel(status: number, body: string): boolean {
	if (status === 404) return true;
	return status === 403 && /model/i.test(body);
}

/**
 * Waits before sending a request, visibly when it is long enough to notice
 * (see `pacingWait`), and stops waiting if the request is cancelled.
 */
export function waitForRoom(endpoint: LlmEndpoint, model: string, waitMs: number, signal?: AbortSignal): Promise<void> {
	const wait: PacingWait = { provider: providerNameFor(endpoint.baseUrl), model, until: Date.now() + waitMs };
	if (waitMs >= ANNOUNCED_WAIT_MS) {
		waits.add(wait);
		publishWaits();
	}

	return new Promise<void>((resolve, reject) => {
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', cancel);
			waits.delete(wait);
			publishWaits();
		};
		const cancel = () => {
			finish();
			reject(new DOMException('The request was cancelled.', 'AbortError'));
		};
		const timer = setTimeout(() => {
			finish();
			resolve();
		}, waitMs);

		if (signal?.aborted) cancel();
		else signal?.addEventListener('abort', cancel, { once: true });
	});
}

function publishWaits(): void {
	let longest: PacingWait | null = null;
	for (const wait of waits) if (!longest || wait.until > longest.until) longest = wait;
	pacingWait.set(longest);
}
