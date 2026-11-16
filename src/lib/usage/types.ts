// SPDX-License-Identifier: AGPL-3.0-or-later

/** The usage-monitor view types shared by the core monitor and its components. */

import type { UsageUnit } from './format.js';

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
	/** True for the models the current setup sends its calls to (several with Automatic). */
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
