// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LedgerState } from './ledger';
import type { LimitWindow } from './rateLimits';

/** Groq's API host, as usage scopes record it. */
export const GROQ_HOST = 'api.groq.com';

/**
 * Groq's published limits, per model and per organization (every key of one
 * Groq account shares them). Each model has its own ceilings: the safeguard
 * model allows 2K tokens a minute where GPT-OSS allows 8K, and a paid
 * Developer plan lifts GPT-OSS to 500K requests a day with no daily token cap.
 *
 * Copied from the `rows` (Free) and `devRows` (Developer) tables embedded in
 * https://console.groq.com/docs/rate-limits on 2026-10-30. A free key's headers
 * matched the Free table (gpt-oss: 1 000 requests/day, 8 000 tokens/minute;
 * Whisper: 2 000 requests/day). A window the table marks "-" has no limit and
 * is left out.
 *
 * Only some of these ever reach the app live: headers carry requests per day
 * and tokens per minute, never tokens per day or audio seconds. So the monitor
 * counts its own use against this table, and a limit Groq states in a refusal
 * (or a header) replaces the table's value.
 */
export const GROQ_LIMITS_CHECKED = '2026-10-30';

export type ModelLimits = Partial<Record<LimitWindow, number>>;

export type GroqPlan = 'free' | 'developer';

export const GROQ_PLAN_NAMES: Record<GroqPlan, string> = {
	free: 'Free',
	developer: 'Developer'
};

const GROQ_LIMITS: Record<GroqPlan, Record<string, ModelLimits>> = {
	free: {
		'canopylabs/orpheus-arabic-saudi': { RPM: 10, RPD: 100, TPM: 1_200, TPD: 3_600 },
		'canopylabs/orpheus-v1-english': { RPM: 10, RPD: 100, TPM: 1_200, TPD: 3_600 },
		'meta-llama/llama-prompt-guard-2-22m': { RPM: 30, RPD: 14_400, TPM: 15_000, TPD: 500_000 },
		'meta-llama/llama-prompt-guard-2-86m': { RPM: 30, RPD: 14_400, TPM: 15_000, TPD: 500_000 },
		'openai/gpt-oss-120b': { RPM: 30, RPD: 1_000, TPM: 8_000, TPD: 200_000 },
		'openai/gpt-oss-20b': { RPM: 30, RPD: 1_000, TPM: 8_000, TPD: 200_000 },
		'openai/gpt-oss-safeguard-20b': { RPM: 3, RPD: 1_000, TPM: 2_000, TPD: 200_000 },
		'qwen/qwen3.8-27b': { RPM: 30, RPD: 1_000, TPM: 8_000, TPD: 200_000 },
		'whisper-large-v3': { RPM: 20, RPD: 2_000, ASH: 7_200, ASD: 28_800 },
		'whisper-large-v3-turbo': { RPM: 20, RPD: 2_000, ASH: 7_200, ASD: 28_800 }
	},
	developer: {
		'canopylabs/orpheus-arabic-saudi': { RPM: 250, RPD: 100_000, TPM: 50_000 },
		'canopylabs/orpheus-v1-english': { RPM: 250, RPD: 100_000, TPM: 50_000 },
		'meta-llama/llama-prompt-guard-2-22m': { RPM: 100, RPD: 50_000, TPM: 30_000 },
		'meta-llama/llama-prompt-guard-2-86m': { RPM: 100, RPD: 50_000, TPM: 30_000 },
		'openai/gpt-oss-120b': { RPM: 1_000, RPD: 500_000, TPM: 250_000 },
		'openai/gpt-oss-20b': { RPM: 1_000, RPD: 500_000, TPM: 250_000 },
		'openai/gpt-oss-safeguard-20b': { RPM: 1_000, RPD: 500_000, TPM: 150_000 },
		'qwen/qwen3.8-27b': { RPM: 1_000, RPD: 500_000, TPM: 250_000 },
		'whisper-large-v3': { RPM: 300, RPD: 200_000, ASH: 200_000, ASD: 4_000_000 },
		'whisper-large-v3-turbo': { RPM: 400, RPD: 200_000, ASH: 400_000, ASD: 4_000_000 }
	}
};

/**
 * Limits Groq states only when refusing, so its table leaves them out:
 * Qwen 3.8 may write 1,000 reply tokens a minute on the free plan (refusals
 * of 2026-11-01). Too few for an evaluation (3,072) or a translation (from
 * 1,024); enough for a phrase's meaning (640).
 */
const GROQ_REFUSAL_LIMITS: Record<GroqPlan, Record<string, ModelLimits>> = {
	free: {
		'qwen/qwen3.8-27b': { OTPM: 1_000 }
	},
	developer: {}
};

/** Every model in Groq's published table, for the per-model usage list. */
export const GROQ_PUBLISHED_MODELS: readonly string[] = Object.keys(GROQ_LIMITS.free);

/**
 * Groq's published limits for a model on a plan.
 *
 * @param model Groq model id, e.g. `openai/gpt-oss-120b`.
 * @param plan Which plan's table to read.
 * @returns The limits, or an empty object for a model the table does not list.
 */
export function groqPublishedLimits(model: string, plan: GroqPlan): ModelLimits {
	return GROQ_LIMITS[plan][model] ?? {};
}

/**
 * What Groq is known to allow a model on a plan: its published table, plus the
 * limits it states only in refusals.
 *
 * @param model Groq model id.
 * @param plan Which plan's limits to read.
 * @returns The limits; an empty object for a model neither source lists.
 */
export function groqKnownLimits(model: string, plan: GroqPlan): ModelLimits {
	return { ...groqPublishedLimits(model, plan), ...GROQ_REFUSAL_LIMITS[plan][model] };
}

/**
 * Which Groq plan's table applies. Live headers carry a model's daily request
 * ceiling, and one above the Free table's means a paid plan. A browser never
 * sees headers, so it assumes Free; a limit Groq states in a refusal still
 * corrects each model on its own.
 *
 * @param state The usage ledger.
 * @param keyId The key's id (`keyIdOf`).
 */
export function groqPlanOf(state: LedgerState, keyId: string): GroqPlan {
	const readings = Object.values(state.live).filter((reading) => reading.host === GROQ_HOST && reading.keyId === keyId);

	const aboveFree = readings.some((reading) => {
		const freeRequestsPerDay = groqPublishedLimits(reading.model ?? '', 'free').RPD;
		return Boolean(freeRequestsPerDay && reading.requests && reading.requests.limit > freeRequestsPerDay);
	});

	return aboveFree ? 'developer' : 'free';
}
