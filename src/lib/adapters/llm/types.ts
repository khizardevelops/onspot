// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * BYOK LLM providers.
 *
 * Both Groq and DeepSeek expose an OpenAI-compatible Chat Completions API, so
 * one client serves both. A `custom` entry lets the user point at any other
 * OpenAI-compatible endpoint.
 */
import type {
	CorrectionCategory,
	CorrectionSeverity,
	ExamStatus,
	FollowUp,
	RunMode,
	TranslationSet
} from '../db/types';

export type LlmProviderId = 'groq' | 'deepseek' | 'custom';

export interface LlmProviderConfig {
	id: LlmProviderId;
	name: string;
	/** Base URL up to but excluding `/chat/completions`. */
	baseUrl: string;
	defaultModel: string;
	/** Where the API key is created. */
	keyUrl: string;
	/** Where the provider documents its models / model permissions. */
	modelsUrl?: string;
	/** Short guidance shown under the model selector. */
	note?: string;
	/** True when the user supplies the base URL as well as the key. */
	requiresBaseUrl?: boolean;
}

/** One selectable model in the settings dropdown. */
export interface LlmModelOption {
	id: string;
	label: string;
	note?: string;
}

export interface LlmEndpoint {
	baseUrl: string;
	apiKey: string;
	model: string;
	/**
	 * Models to continue with, in order, when `model` is out of room under the
	 * provider's rate limits (see `pacing.ts`). Empty or absent: `model` only.
	 */
	fallbackModels?: readonly string[];
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface EvaluationCorrection {
	category: CorrectionCategory;
	severity: CorrectionSeverity;
	label: string;
	original: string;
	replacement: string;
	/** The suggested replacement's meaning in the language of instruction, so the learner learns it. */
	replacementTranslation?: string;
	explanation: string;
	/** Sentence to read back through TTS for this correction. */
	speakText?: string;
	examStatus?: ExamStatus;
	formalAlternatives?: string[];
}

export interface VocabularySuggestion {
	original: string;
	suggestion: string;
	why: string;
}

export interface ConnectorSuggestion {
	/** The connector to reach for, e.g. "par conséquent". */
	connector: string;
	/** Informal connector it should replace, when applicable. */
	insteadOf?: string;
	why: string;
}

export interface EvaluationResult {
	/**
	 * The correct version ("Did you mean to say…?"): what the learner was trying
	 * to say, fixed and natural but faithful to them. Equals the transcript when
	 * there was nothing to fix.
	 */
	correctedText: string;
	/**
	 * Spoken coaching in the language of instruction, with tagged target-language
	 * quotes (markup in `explanation.ts`). Already normalized.
	 */
	explanation: string;
	/** The question that keeps the learner talking, with its translation; null if the model gave none. */
	followUp: FollowUp | null;
	corrections: EvaluationCorrection[];
	vocabulary: VocabularySuggestion[];
	connectors: ConnectorSuggestion[];
}

export interface EvaluationRequest {
	transcript: string;
	prompt: string;
	mode: RunMode;
	level: string;
	/** Target language name, e.g. `French`. */
	language: string;
	/** The language of instruction, by its English name, e.g. `English`, `Spanish`. */
	translationTarget: string;
	endpoint: LlmEndpoint;
	/** Output token cap; defaults to the pacing-derived budget. */
	maxTokens?: number;
	signal?: AbortSignal;
}
