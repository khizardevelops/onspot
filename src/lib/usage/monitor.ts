// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get, readable, writable } from 'svelte/store';
import { appSettings, settingsReady, type AppSettings } from '#lib/stores/settings.js';
import { deepseekApiKey, elevenLabsApiKey, groqApiKey, openaiApiKey } from '#lib/stores/secrets.js';
import { resolveLlmEndpoint } from '#lib/stores/llm.js';
import { ttsApiOptions } from '#lib/stores/ttsConfig.js';
import { isTauri } from '#lib/platform/runtime.js';
import { fetchElevenLabsSubscription, type ElevenLabsSubscription } from '#lib/speech/tts/cloud/elevenLabsAccount.js';
import { GROQ_WHISPER_MODEL } from '#lib/speech/stt/cloud/GroqWhisperAdapter.js';
import { fetchDeepSeekBalance, type DeepSeekAccount } from '#lib/adapters/llm/deepseekBalance.js';
import { getModelOptions, isChatModel } from '#lib/adapters/llm/index.js';
import {
	keyIdOf,
	scopeKey,
	totalsWithin,
	usageLedger,
	type CallTotals,
	type LedgerState,
	type LiveReading,
	type UsageScope
} from './ledger';
import {
	GROQ_LIMITS_CHECKED,
	GROQ_PLAN_NAMES,
	GROQ_PUBLISHED_MODELS,
	groqPublishedLimits,
	type GroqPlan,
	type ModelLimits
} from './publishedLimits';
import type { HeaderBudget, LimitWindow } from './rateLimits';
import { formatCount, formatDuration, formatQuantity, formatReset, type UsageUnit } from './format';

/**
 * The usage monitor: how much of each cloud service's limit or credit is left
 * for the steps the learner has set to Cloud.
 *
 * Limits come at the granularity the provider enforces them:
 * - Groq (LLM and speech-to-text) limits each model per organization.
 * - OpenAI limits each model per organization; its credit balance is not
 *   readable with an API key.
 * - ElevenLabs gives each account a character allowance per billing period.
 * - DeepSeek bills a prepaid account balance and does not rate-limit.
 *
 * Every figure says where it came from, because they are not equally certain:
 * the provider's account API, live rate-limit headers (desktop and Android
 * only; browsers cannot read them), a limit the provider stated when it refused
 * a call, or onspot's own count of what this device sent, against the
 * provider's published limit.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const GROQ_HOST = 'api.groq.com';
const OPENAI_HOST = 'api.openai.com';
const ELEVENLABS_HOST = 'api.elevenlabs.io';

/**
 * One evaluation is ~1.5–2.3k prompt tokens plus the reply (measured
 * 2026-10-30), so 2 500 stands in until this device has measured its own.
 * Calls under 600 tokens are connection tests, not takes, and are not averaged.
 */
const DEFAULT_TOKENS_PER_TAKE = 2_500;

/**
 * What Groq sets aside to admit one evaluation: the prompt plus the 3 072-token
 * reply budget. A refusal on 2026-10-30 reported "Requested 4841" for a take.
 */
const DEFAULT_RESERVED_TOKENS_PER_TAKE = 4_850;
const MIN_TAKE_TOKENS = 600;

/** A spoken explanation ran 120–130 characters in testing; 150 leaves headroom. */
const DEFAULT_CHARACTERS_PER_READ = 150;

/** Below this share left, a meter turns into a warning. */
const LOW_REMAINING_SHARE = 0.1;
/** Below this many takes left, the estimate turns into a warning. */
const FEW_TAKES = 5;

/** Re-reading the account APIs is cheap, but not on every render. */
const ACCOUNT_REFRESH_AFTER_MS = 5 * MINUTE_MS;
/** Wait for a burst of spoken replies to finish before re-reading the allowance. */
const ACCOUNT_REFRESH_DEBOUNCE_MS = 1_500;
/** Wait for the learner to finish typing a key before trying it. */
const KEY_CHANGE_DEBOUNCE_MS = 800;
/** Rolling windows age, so the monitor re-reads the clock this often. */
const CLOCK_TICK_MS = 15_000;

export type Capability = 'Speech-to-text' | 'LLM' | 'Text-to-speech';

/** Where a used figure came from. */
export type UsedSource = 'account' | 'live' | 'reported' | 'counted';
/** Where a limit came from. */
export type LimitSource = 'account' | 'live' | 'reported' | 'published';

export interface UsageMeter {
	label: string;
	unit: UsageUnit;
	used: number;
	limit: number;
	usedSource: UsedSource;
	limitSource: LimitSource;
	/** When the provider reported it; null for a count that is always current. */
	observedAt: number | null;
	/** When the full limit is available again, when known. */
	resetsAt: number | null;
	/** The window in words, e.g. "rolling 24 hours". */
	span: string;
	/** The window as the end of a sentence, e.g. "today" in "3,600 tokens left today". */
	period: string;
}

export interface UsageWarning {
	level: 'warning' | 'error';
	message: string;
}

/** What the monitor shows for one service, or for one model of a per-model service. */
export interface UsageView {
	meters: UsageMeter[];
	/** The bottom line in takes or time, e.g. "Enough for about 78 more takes today". */
	estimate: string | null;
	notes: string[];
	warnings: UsageWarning[];
}

/** One model of a provider that limits each model separately. */
export interface ModelUsage extends UsageView {
	model: string;
	/** A readable name, e.g. "GPT-OSS 120B"; the id when there is none. */
	label: string;
	/** True for the model the current setup sends its calls to. */
	inUse: boolean;
}

export interface ServiceUsage extends UsageView {
	capability: Capability;
	provider: string;
	/** What the limits belong to: a model, a plan, or the device. */
	subject: string;
	scope: 'model' | 'account' | 'local';
	/**
	 * Per-model services list every model worth comparing, the one in use
	 * first; the service's own meters are that model's. Empty otherwise.
	 */
	models: ModelUsage[];
	/** Account credit with no fixed limit (DeepSeek), already formatted. */
	balance: string | null;
	dashboard: { label: string; url: string } | null;
	loading: boolean;
	error: string | null;
}

// ------------------------------------------------------------ Account APIs

interface AccountReading<T> {
	keyId: string;
	data: T | null;
	error: string | null;
	loading: boolean;
	fetchedAt: number | null;
}

interface AccountState {
	elevenlabs: AccountReading<ElevenLabsSubscription> | null;
	deepseek: AccountReading<DeepSeekAccount> | null;
}

const accounts = writable<AccountState>({ elevenlabs: null, deepseek: null });

function needsFetch(reading: AccountReading<unknown> | null, keyId: string, force: boolean, now: number): boolean {
	if (!reading || reading.keyId !== keyId) return true;
	if (reading.loading) return false;
	if (force) return true;
	return reading.fetchedAt === null || now - reading.fetchedAt > ACCOUNT_REFRESH_AFTER_MS;
}

async function readAccount<K extends keyof AccountState>(
	name: K,
	apiKey: string,
	fetcher: (key: string) => Promise<NonNullable<AccountState[K]>['data']>,
	force: boolean
): Promise<void> {
	const keyId = keyIdOf(apiKey);
	if (!needsFetch(get(accounts)[name], keyId, force, Date.now())) return;

	const previous = get(accounts)[name];
	const keptData = previous?.keyId === keyId ? previous.data : null;
	accounts.update((state) => ({
		...state,
		[name]: { keyId, data: keptData, error: null, loading: true, fetchedAt: previous?.fetchedAt ?? null }
	}));

	try {
		const data = await fetcher(apiKey);
		accounts.update((state) => ({ ...state, [name]: { keyId, data, error: null, loading: false, fetchedAt: Date.now() } }));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		accounts.update((state) => ({
			...state,
			[name]: { keyId, data: keptData, error: message, loading: false, fetchedAt: Date.now() }
		}));
	}
}

/**
 * The keys of the account APIs the current setup uses. Empty until settings
 * have loaded: before that, every step still looks local.
 */
const accountKeysInUse = derived(
	[settingsReady, appSettings, elevenLabsApiKey, deepseekApiKey],
	([ready, settings, elevenKey, deepseekKey]) => {
		const usesElevenLabs = ready && settings.ttsMode === 'cloud' && settings.ttsCloudProvider === 'elevenlabs';
		const usesDeepSeek = ready && settings.correctionMode === 'cloud' && settings.llmProvider === 'deepseek';

		return {
			elevenlabs: usesElevenLabs && elevenKey.trim() ? elevenKey : null,
			deepseek: usesDeepSeek && deepseekKey.trim() ? deepseekKey : null
		};
	}
);

/**
 * Re-reads the account usage of the cloud services in use (ElevenLabs'
 * allowance, DeepSeek's balance). Groq and OpenAI have no such API; their
 * figures update with every call.
 *
 * @param force Read even if the last reading is recent.
 */
export async function refreshAccountUsage(force = false): Promise<void> {
	const keys = get(accountKeysInUse);
	const reads: Promise<void>[] = [];

	if (keys.elevenlabs) reads.push(readAccount('elevenlabs', keys.elevenlabs, fetchElevenLabsSubscription, force));
	if (keys.deepseek) reads.push(readAccount('deepseek', keys.deepseek, fetchDeepSeekBalance, force));

	await Promise.all(reads);
}

// An account that comes into use (settings finish loading, a key is added, a
// provider is switched) is read straight away, so Practice can warn about it
// without the learner opening Settings first.
let accountKeysSeen = '';
let keyChangeTimer: ReturnType<typeof setTimeout> | null = null;

accountKeysInUse.subscribe((keys) => {
	const signature = `${keyIdOf(keys.elevenlabs ?? '')}|${keyIdOf(keys.deepseek ?? '')}`;
	if (signature === accountKeysSeen) return;
	accountKeysSeen = signature;

	if (keyChangeTimer) clearTimeout(keyChangeTimer);
	keyChangeTimer = setTimeout(() => void refreshAccountUsage(), KEY_CHANGE_DEBOUNCE_MS);
});

// The allowance changes with every spoken reply: re-read it once a burst of
// ElevenLabs calls settles, so Practice can warn before the next one fails.
let lastElevenLabsCall = 0;
let accountRefreshTimer: ReturnType<typeof setTimeout> | null = null;

usageLedger.subscribe((state) => {
	const latest = state.calls.findLast((call) => call.host === ELEVENLABS_HOST);
	if (!latest || latest.at <= lastElevenLabsCall) return;

	const isFirstReading = lastElevenLabsCall === 0;
	lastElevenLabsCall = latest.at;
	if (isFirstReading) return;

	if (accountRefreshTimer) clearTimeout(accountRefreshTimer);
	accountRefreshTimer = setTimeout(() => void refreshAccountUsage(true), ACCOUNT_REFRESH_DEBOUNCE_MS);
});

// ------------------------------------------------------------ Rate-limited models

interface WindowSpec {
	label: string;
	unit: UsageUnit;
	spanMs: number;
	span: string;
	period: string;
	measure: (totals: CallTotals) => number;
}

const WINDOWS: Record<LimitWindow, WindowSpec> = {
	RPM: { label: 'Requests per minute', unit: 'requests', spanMs: MINUTE_MS, span: 'per minute', period: 'this minute', measure: (totals) => totals.requests },
	RPD: { label: 'Requests today', unit: 'requests', spanMs: DAY_MS, span: 'rolling 24 hours', period: 'today', measure: (totals) => totals.requests },
	TPM: { label: 'Tokens per minute', unit: 'tokens', spanMs: MINUTE_MS, span: 'per minute', period: 'this minute', measure: (totals) => totals.tokens },
	TPD: { label: 'Tokens today', unit: 'tokens', spanMs: DAY_MS, span: 'rolling 24 hours', period: 'today', measure: (totals) => totals.tokens },
	ASH: { label: 'Audio this hour', unit: 'seconds', spanMs: HOUR_MS, span: 'rolling hour', period: 'this hour', measure: (totals) => totals.audioSeconds },
	ASD: { label: 'Audio today', unit: 'seconds', spanMs: DAY_MS, span: 'rolling 24 hours', period: 'today', measure: (totals) => totals.audioSeconds }
};

/**
 * What each pair of `x-ratelimit-*` headers measures. Groq's request pair is
 * per day and its token pair per minute; OpenAI (and the gateways that copy
 * it) report both per minute.
 */
const HEADER_WINDOWS: Record<string, { requests: LimitWindow; tokens: LimitWindow }> = {
	[GROQ_HOST]: { requests: 'RPD', tokens: 'TPM' }
};
const OPENAI_HEADER_WINDOWS = { requests: 'RPM', tokens: 'TPM' } as const;

/** The windows worth showing a learner; requests per minute never binds at speaking pace. */
const GROQ_CHAT_WINDOWS: LimitWindow[] = ['TPD', 'RPD', 'TPM'];
const GROQ_SPEECH_WINDOWS: LimitWindow[] = ['ASD', 'ASH', 'RPD'];
const LIVE_ONLY_WINDOWS: LimitWindow[] = ['RPM', 'TPM'];

function liveBudget(live: LiveReading | undefined, host: string, window: LimitWindow): HeaderBudget | null {
	if (!live) return null;
	const windows = HEADER_WINDOWS[host] ?? OPENAI_HEADER_WINDOWS;
	if (windows.requests === window) return live.requests;
	if (windows.tokens === window) return live.tokens;
	return null;
}

interface ModelContext {
	state: LedgerState;
	scope: UsageScope;
	published: ModelLimits;
	now: number;
}

/**
 * One window's meter for a rate-limited model, from the best source available.
 *
 * Groq and OpenAI refill their budgets linearly over the window: Groq reset
 * one used request of 1 000/day in 86.4 s and 73 of 8 000 tokens/minute in
 * 547 ms (measured 2026-10-30). So a live reading is aged forward by that
 * rate instead of going stale.
 */
function windowMeter(window: LimitWindow, context: ModelContext): UsageMeter | null {
	const { state, scope, published, now } = context;
	const spec = WINDOWS[window];
	const key = scopeKey(scope);

	const live = state.live[key];
	const budget = liveBudget(live, scope.host, window);
	if (live && budget) {
		const refillPerMs = budget.limit / spec.spanMs;
		const usedAtReading = budget.limit - budget.remaining;
		const used = Math.max(0, usedAtReading - (now - live.observedAt) * refillPerMs);

		return {
			label: spec.label,
			unit: spec.unit,
			used,
			limit: budget.limit,
			usedSource: 'live',
			limitSource: 'live',
			observedAt: live.observedAt,
			resetsAt: used > 0 ? now + used / refillPerMs : null,
			span: spec.span,
			period: spec.period
		};
	}

	const reported = state.reported[key]?.[window];
	const limit = reported?.limit ?? published[window];
	if (limit === undefined) return null;

	let used = spec.measure(totalsWithin(state, scope, spec.spanMs, now));
	let usedSource: UsedSource = 'counted';
	let resetsAt: number | null = null;

	// A refusal carries the provider's own figure; age it like a live reading
	// and keep it when it is higher than what this device counted.
	if (reported?.used != null && now - reported.observedAt < spec.spanMs) {
		const refilled = (now - reported.observedAt) * (reported.limit / spec.spanMs);
		const reportedNow = Math.max(0, reported.used - refilled);
		if (reportedNow > used) {
			used = reportedNow;
			usedSource = 'reported';
			resetsAt = reported.retryAt;
		}
	}

	return {
		label: spec.label,
		unit: spec.unit,
		used: Math.min(used, limit),
		limit,
		usedSource,
		limitSource: reported ? 'reported' : 'published',
		observedAt: usedSource === 'reported' ? (reported?.observedAt ?? null) : null,
		resetsAt,
		span: spec.span,
		period: spec.period
	};
}

function remainingOf(meter: UsageMeter | undefined): number {
	return meter ? Math.max(0, meter.limit - meter.used) : Number.POSITIVE_INFINITY;
}

function findMeter(meters: UsageMeter[], label: string): UsageMeter | undefined {
	return meters.find((meter) => meter.label === label);
}

/** What one take costs a chat model: tokens used, and tokens set aside to admit it. */
interface TakeTokens {
	used: number;
	reserved: number;
}

/** Averages of this device's recent takes on the model, or the measured defaults. */
function tokensPerTake(state: LedgerState, scope: UsageScope, now: number): TakeTokens {
	const takes = state.calls.filter(
		(call) =>
			call.keyId === scope.keyId &&
			call.host === scope.host &&
			call.model === scope.model &&
			call.tokens >= MIN_TAKE_TOKENS &&
			now - call.at < DAY_MS
	);
	const measured = takes.filter((call) => (call.reservedTokens ?? 0) > 0);

	const used = takes.length > 0 ? takes.reduce((sum, call) => sum + call.tokens, 0) / takes.length : DEFAULT_TOKENS_PER_TAKE;
	const reserved =
		measured.length > 0
			? measured.reduce((sum, call) => sum + call.reservedTokens, 0) / measured.length
			: DEFAULT_RESERVED_TOKENS_PER_TAKE;

	return { used: Math.round(used), reserved: Math.round(reserved) };
}

/** "3,641 tokens" or, for audio, "12 min of audio". */
function amountOf(value: number, unit: UsageUnit): string {
	return unit === 'seconds' ? `${formatDuration(value)} of audio` : formatQuantity(value, unit);
}

const UNIT_NOUNS: Record<UsageUnit, string> = {
	requests: 'requests',
	tokens: 'tokens',
	seconds: 'audio',
	characters: 'characters'
};

function meterWarnings(provider: string, meters: UsageMeter[], now: number): UsageWarning[] {
	const warnings: UsageWarning[] = [];

	for (const meter of meters) {
		const remaining = remainingOf(meter);
		const reset = meter.resetsAt ? ` It refills ${formatReset(meter.resetsAt, now)}.` : '';

		if (remaining <= 0) {
			warnings.push({ level: 'error', message: `${provider}: no ${UNIT_NOUNS[meter.unit]} left ${meter.period}.${reset}` });
		} else if (remaining / meter.limit < LOW_REMAINING_SHARE) {
			warnings.push({ level: 'warning', message: `${provider}: only ${amountOf(remaining, meter.unit)} left ${meter.period}.${reset}` });
		}
	}

	return warnings;
}

/**
 * Which Groq plan's table applies. Live headers carry a model's daily request
 * ceiling, and one above the Free table's means a paid plan. A browser never
 * sees headers, so it assumes Free; a limit Groq states in a refusal still
 * corrects each model on its own.
 */
function groqPlanOf(state: LedgerState, keyId: string): GroqPlan {
	const readings = Object.values(state.live).filter((reading) => reading.host === GROQ_HOST && reading.keyId === keyId);

	const aboveFree = readings.some((reading) => {
		const freeRequestsPerDay = groqPublishedLimits(reading.model ?? '', 'free').RPD;
		return Boolean(freeRequestsPerDay && reading.requests && reading.requests.limit > freeRequestsPerDay);
	});

	return aboveFree ? 'developer' : 'free';
}

const WHISPER_LABELS: Record<string, string> = {
	'whisper-large-v3': 'Whisper Large v3',
	'whisper-large-v3-turbo': 'Whisper Large v3 Turbo'
};

/** The name Settings uses for a Groq model, or its id without the vendor prefix. */
function groqModelLabel(model: string): string {
	const curated = getModelOptions('groq').find((option) => option.id === model)?.label;
	return curated ?? WHISPER_LABELS[model] ?? model.split('/').pop() ?? model;
}

/**
 * The Groq chat models worth comparing, in a stable order: the app's own list,
 * then the rest of Groq's published table, then anything this key has called.
 * The model in use is always included, even when it is in none of them.
 */
function groqChatModels(inUse: string, state: LedgerState, keyId: string): string[] {
	const curated = getModelOptions('groq').map((option) => option.id);
	const published = GROQ_PUBLISHED_MODELS.filter(isChatModel);
	const called = state.calls
		.filter((call) => call.host === GROQ_HOST && call.keyId === keyId && isChatModel(call.model))
		.map((call) => call.model);

	const models = [...new Set([...curated, ...published, ...called])];
	return models.includes(inUse) ? models : [inUse, ...models];
}

function webHeaderNote(plan: GroqPlan): string {
	return (
		`Browsers cannot read Groq's live limits, so this counts what onspot sent from this device against ` +
		`Groq's published ${GROQ_PLAN_NAMES[plan]}-plan limits for this model (checked ${GROQ_LIMITS_CHECKED}). ` +
		`Use from other apps or devices on the same account is not included.`
	);
}

/** What this device sent to a model in the last day, for models without published limits. */
function sentTodayNote(state: LedgerState, scope: UsageScope, kind: GroqModelKind, now: number): string {
	const totals = totalsWithin(state, scope, DAY_MS, now);
	const requests = formatQuantity(totals.requests, 'requests');
	const amount = kind === 'chat' ? formatQuantity(totals.tokens, 'tokens') : amountOf(totals.audioSeconds, 'seconds');
	return `Sent from this device in the last 24 hours: ${requests}, ${amount}.`;
}

interface TakeEstimate {
	text: string | null;
	warning: UsageWarning | null;
}

/**
 * Turns a chat model's limits into takes. One take is one request and about
 * `perTake` tokens, so whichever runs out first, tokens or requests, decides;
 * a per-minute token limit below one take means no take can ever succeed.
 */
function chatTakeEstimate(model: string, meters: UsageMeter[], take: TakeTokens): TakeEstimate {
	const tokensPerMinute = findMeter(meters, WINDOWS.TPM.label)?.limit ?? null;
	const perTake = take.used;

	// Groq admits a call only if this minute's tokens plus the call's reserved
	// tokens (prompt + max_tokens) fit, so a limit below the reservation refuses
	// every take, however short the reply would have been.
	if (tokensPerMinute !== null && tokensPerMinute < take.reserved) {
		const allowed = formatCount(tokensPerMinute);
		return {
			text: `Groq sets aside about ${formatCount(take.reserved)} tokens for each take, but this model allows only ${allowed} a minute, so takes are refused.`,
			warning: {
				level: 'error',
				message: `Groq ${model} allows ${allowed} tokens a minute, less than one take needs. Choose another model in Settings → LLM.`
			}
		};
	}

	const takesByTokens = Math.floor(remainingOf(findMeter(meters, WINDOWS.TPD.label)) / perTake);
	const takesByRequests = remainingOf(findMeter(meters, WINDOWS.RPD.label));
	const takesLeft = Math.min(takesByTokens, takesByRequests);
	if (!Number.isFinite(takesLeft)) return { text: null, warning: null };

	const count = formatCount(takesLeft);
	const plural = takesLeft === 1 ? '' : 's';
	const takes = `${count} take${plural}`;
	// The first take of a minute needs its whole reservation free; each one
	// after it adds only what a take actually used.
	const takesPerMinute = tokensPerMinute ? Math.floor((tokensPerMinute - take.reserved) / perTake) + 1 : null;
	const perMinute = takesPerMinute ? `, up to ${formatCount(takesPerMinute)} a minute` : '';

	return {
		text: `Enough for about ${count} more take${plural} today${perMinute}, at ${formatCount(perTake)} tokens a take.`,
		warning: takesLeft < FEW_TAKES ? { level: 'warning', message: `Groq: about ${takes} left today on ${model}.` } : null
	};
}

/** Audio left today and this hour, as listening time. */
function speechEstimate(meters: UsageMeter[]): TakeEstimate {
	const audioToday = remainingOf(findMeter(meters, WINDOWS.ASD.label));
	const audioThisHour = remainingOf(findMeter(meters, WINDOWS.ASH.label));
	if (!Number.isFinite(audioToday)) return { text: null, warning: null };

	const hourPart = audioThisHour < audioToday ? `, ${formatDuration(audioThisHour)} of it this hour` : '';
	return { text: `About ${formatDuration(audioToday)} of speech left today${hourPart}.`, warning: null };
}

type GroqModelKind = 'chat' | 'speech';

interface GroqContext {
	state: LedgerState;
	keyId: string;
	plan: GroqPlan;
	now: number;
}

/**
 * One Groq model's usage. Each model has its own ceilings, so each gets its
 * own meters, estimate and notes; warnings matter only for the model in use.
 */
function groqModelUsage(model: string, kind: GroqModelKind, inUse: boolean, context: GroqContext): ModelUsage {
	const { state, keyId, plan, now } = context;
	const scope: UsageScope = { host: GROQ_HOST, model, keyId };
	const modelContext: ModelContext = { state, scope, published: groqPublishedLimits(model, plan), now };

	const windows = kind === 'chat' ? GROQ_CHAT_WINDOWS : GROQ_SPEECH_WINDOWS;
	const meters = windows.map((window) => windowMeter(window, modelContext)).filter(
		(meter): meter is UsageMeter => meter !== null
	);

	const warnings = meterWarnings(kind === 'chat' ? 'Groq' : 'Groq speech-to-text', meters, now);
	const estimate = kind === 'chat' ? chatTakeEstimate(model, meters, tokensPerTake(state, scope, now)) : speechEstimate(meters);
	// A low meter already warns; the estimate adds limits that are each fine but leave few takes together.
	const addsNews = estimate.warning?.level === 'error' || warnings.length === 0;
	if (estimate.warning && addsNews) warnings.push(estimate.warning);

	const notes: string[] = [];
	const hasLive = Boolean(state.live[scopeKey(scope)]);
	if (meters.length === 0) {
		notes.push(`Groq does not publish limits for this model (rate-limits page, checked ${GROQ_LIMITS_CHECKED}).`);
		notes.push(sentTodayNote(state, scope, kind, now));
	} else if (hasLive) {
		notes.push(
			kind === 'chat'
				? 'Requests and tokens per minute are Groq\'s live figures; tokens per day are counted on this device.'
				: 'Requests are Groq\'s live figures; audio is counted on this device.'
		);
	} else if (!isTauri()) {
		notes.push(webHeaderNote(plan));
	}
	if (plan === 'developer') notes.push('These are Developer-plan limits: Groq\'s live figures show this account is on it.');

	return { model, label: groqModelLabel(model), inUse, meters, estimate: estimate.text, notes, warnings };
}

/** A Groq step: the model in use supplies the service's own figures, every model is listed. */
function groqService(capability: Capability, models: ModelUsage[], plan: GroqPlan): ServiceUsage {
	const current = models.find((model) => model.inUse) ?? models[0];

	return {
		capability,
		provider: 'Groq',
		subject: `${GROQ_PLAN_NAMES[plan]}-plan limits`,
		scope: 'model',
		models,
		meters: current.meters,
		estimate: current.estimate,
		notes: current.notes,
		warnings: current.warnings,
		balance: null,
		dashboard: { label: 'Groq limits', url: 'https://console.groq.com/settings/limits' },
		loading: false,
		error: null
	};
}

function groqChatService(settings: AppSettings, apiKey: string, state: LedgerState, now: number): ServiceUsage {
	const inUse = resolveLlmEndpoint(settings).model;
	const keyId = keyIdOf(apiKey);
	const context: GroqContext = { state, keyId, plan: groqPlanOf(state, keyId), now };

	const models = groqChatModels(inUse, state, keyId).map((model) =>
		groqModelUsage(model, 'chat', model === inUse, context)
	);
	return groqService('LLM', models, context.plan);
}

/** Speech-to-text has one Groq model the app can use, so there is nothing to compare it with. */
function groqSpeechService(apiKey: string, state: LedgerState, now: number): ServiceUsage {
	const keyId = keyIdOf(apiKey);
	const context: GroqContext = { state, keyId, plan: groqPlanOf(state, keyId), now };

	const models = [groqModelUsage(GROQ_WHISPER_MODEL, 'speech', true, context)];
	return groqService('Speech-to-text', models, context.plan);
}

/** OpenAI and other OpenAI-compatible endpoints: only their live headers are known. */
function liveOnlyService(
	capability: Capability,
	provider: string,
	scope: UsageScope,
	state: LedgerState,
	now: number,
	dashboard: ServiceUsage['dashboard']
): ServiceUsage {
	const context: ModelContext = { state, scope, published: {}, now };
	const meters = LIVE_ONLY_WINDOWS.map((window) => windowMeter(window, context)).filter(
		(meter): meter is UsageMeter => meter !== null
	);

	const notes: string[] = [];
	if (meters.length === 0) {
		notes.push(
			isTauri()
				? `${provider} has not reported limits yet; they appear after the next call.`
				: `Browsers cannot read ${provider}'s rate limits, so they show only in the desktop and Android apps.`
		);
	}
	if (scope.host === OPENAI_HOST) {
		notes.push('OpenAI does not share your credit balance with API keys; check it on the billing page.');
	}

	return {
		capability,
		provider,
		subject: scope.model,
		scope: 'model',
		models: [],
		meters,
		balance: null,
		estimate: null,
		notes,
		warnings: meterWarnings(provider, meters, now),
		dashboard,
		loading: false,
		error: null
	};
}

// ------------------------------------------------------------ Accounts

function elevenLabsService(
	apiKey: string,
	reading: AccountReading<ElevenLabsSubscription> | null,
	state: LedgerState,
	now: number
): ServiceUsage {
	const keyId = keyIdOf(apiKey);
	const current = reading?.keyId === keyId ? reading : null;
	const subscription = current?.data ?? null;

	const meters: UsageMeter[] = subscription
		? [
				{
					label: 'Characters this period',
					unit: 'characters',
					used: subscription.characterCount,
					limit: subscription.characterLimit,
					usedSource: 'account',
					limitSource: 'account',
					observedAt: current?.fetchedAt ?? null,
					resetsAt: subscription.resetsAt,
					span: 'billing period',
					period: 'this billing period'
				}
			]
		: [];

	let estimate: string | null = null;
	if (subscription) {
		const charactersLeft = Math.max(0, subscription.characterLimit - subscription.characterCount);
		const recent = totalsWithin(state, { host: ELEVENLABS_HOST, model: '*', keyId }, DAY_MS, now);
		const perRead = recent.requests > 0 ? recent.characters / recent.requests : DEFAULT_CHARACTERS_PER_READ;
		const readsLeft = Math.floor(charactersLeft / perRead);
		const until = subscription.resetsAt ? ` before it refills ${formatReset(subscription.resetsAt, now)}` : '';
		estimate = `About ${formatCount(readsLeft)} more read-aloud${readsLeft === 1 ? '' : 's'}${until}, at ${formatCount(perRead)} characters each.`;
	}

	return {
		capability: 'Text-to-speech',
		provider: 'ElevenLabs',
		subject: subscription ? `${subscription.tier[0]?.toUpperCase() ?? ''}${subscription.tier.slice(1)} plan` : 'Account',
		scope: 'account',
		models: [],
		meters,
		balance: null,
		estimate,
		notes: ['ElevenLabs counts characters per account, across every voice and model.'],
		warnings: meterWarnings('ElevenLabs', meters, now),
		dashboard: { label: 'ElevenLabs subscription', url: 'https://elevenlabs.io/app/subscription' },
		loading: Boolean(current?.loading && !subscription),
		error: current?.error ?? null
	};
}

const money = (currency: string) =>
	new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 });

function deepSeekService(apiKey: string, reading: AccountReading<DeepSeekAccount> | null, model: string): ServiceUsage {
	const current = reading?.keyId === keyIdOf(apiKey) ? reading : null;
	const account = current?.data ?? null;

	const balance = account
		? account.balances
				.map((entry) => {
					const granted = entry.granted > 0 ? ` (${money(entry.currency).format(entry.granted)} of it granted credit)` : '';
					return `${money(entry.currency).format(entry.total)} available${granted}`;
				})
				.join(' · ') || 'No balance'
		: null;

	const warnings: UsageWarning[] =
		account && !account.isAvailable
			? [{ level: 'error', message: 'DeepSeek: the account balance cannot pay for more calls. Top it up to keep getting feedback.' }]
			: [];

	return {
		capability: 'LLM',
		provider: 'DeepSeek',
		subject: model,
		scope: 'account',
		models: [],
		meters: [],
		balance,
		estimate: null,
		notes: ['DeepSeek does not rate-limit; it charges each call to the account balance.'],
		warnings,
		dashboard: { label: 'DeepSeek usage', url: 'https://platform.deepseek.com/usage' },
		loading: Boolean(current?.loading && !account),
		error: current?.error ?? null
	};
}

function localService(capability: Capability, subject: string, where: string): ServiceUsage {
	return {
		capability,
		provider: 'Local',
		subject,
		scope: 'local',
		models: [],
		meters: [],
		balance: null,
		estimate: `No usage limits: it runs on ${where}.`,
		notes: [],
		warnings: [],
		dashboard: null,
		loading: false,
		error: null
	};
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function isLocalHost(url: string): boolean {
	const host = hostOf(url).split(':')[0];
	return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

// ------------------------------------------------------------ The monitor

/** The current time, re-read so rolling windows age while the monitor is open. */
export const usageClock = readable(Date.now(), (set) => {
	const timer = setInterval(() => set(Date.now()), CLOCK_TICK_MS);
	return () => clearInterval(timer);
});

/** Usage of every step in the current setup, in pipeline order. */
export const usageServices = derived(
	[appSettings, groqApiKey, deepseekApiKey, elevenLabsApiKey, openaiApiKey, usageLedger, accounts, usageClock],
	// The OpenAI key is a dependency only so a new key recomputes; `ttsApiOptions` reads it itself.
	([settings, groqKey, deepseekKey, elevenKey, , ledger, accountState, now]): ServiceUsage[] => {
		const services: ServiceUsage[] = [];

		services.push(
			settings.sttMode === 'cloud'
				? groqSpeechService(groqKey, ledger, now)
				: localService('Speech-to-text', 'Whisper', 'this device')
		);

		const endpoint = resolveLlmEndpoint(settings);
		if (settings.correctionMode === 'local') {
			services.push(localService('LLM', endpoint.model || 'Local model', hostOf(endpoint.baseUrl)));
		} else if (settings.llmProvider === 'groq') {
			services.push(groqChatService(settings, groqKey, ledger, now));
		} else if (settings.llmProvider === 'deepseek') {
			services.push(deepSeekService(deepseekKey, accountState.deepseek, endpoint.model));
		} else {
			const scope: UsageScope = { host: hostOf(endpoint.baseUrl), model: endpoint.model, keyId: keyIdOf(endpoint.apiKey) };
			services.push(liveOnlyService('LLM', scope.host, scope, ledger, now, null));
		}

		if (settings.ttsMode === 'local') {
			services.push(localService('Text-to-speech', 'Piper', 'this device'));
		} else if (settings.ttsCloudProvider === 'elevenlabs') {
			services.push(elevenLabsService(elevenKey, accountState.elevenlabs, ledger, now));
		} else {
			const options = ttsApiOptions(settings);
			if (isLocalHost(options.apiBaseUrl)) {
				services.push(localService('Text-to-speech', options.apiModel, hostOf(options.apiBaseUrl)));
			} else {
				const host = hostOf(options.apiBaseUrl);
				const scope: UsageScope = { host, model: options.apiModel, keyId: keyIdOf(options.apiKey ?? '') };
				const dashboard = host === OPENAI_HOST ? { label: 'OpenAI usage', url: 'https://platform.openai.com/usage' } : null;
				services.push(liveOnlyService('Text-to-speech', host === OPENAI_HOST ? 'OpenAI' : host, scope, ledger, now, dashboard));
			}
		}

		return services;
	}
);

/** Usage problems worth telling the learner before the next take, most serious first. */
export const usageWarnings = derived(usageServices, (services) =>
	services
		.flatMap((service) => service.warnings)
		.sort((first, second) => (first.level === second.level ? 0 : first.level === 'error' ? -1 : 1))
);

/** When the account APIs were last read, for "Updated … ago". */
export const accountsReadAt = derived(accounts, (state) => {
	const times = [state.elevenlabs?.fetchedAt, state.deepseek?.fetchedAt].filter((time): time is number => typeof time === 'number');
	return times.length > 0 ? Math.max(...times) : null;
});

/** True while an account API is being read. */
export const accountsLoading = derived(accounts, (state) =>
	Boolean(state.elevenlabs?.loading || state.deepseek?.loading)
);
