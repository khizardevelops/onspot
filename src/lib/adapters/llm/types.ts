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
	/** English translation of the suggested replacement, so the learner learns it. */
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
	/** The learner's transcript with the corrections applied. */
	correctedText: string;
	/** Fluent, natural spoken French version, for TTS read-back. */
	naturalSpeech: string;
	/** Three translation styles of what the learner said. */
	translations: TranslationSet;
	corrections: EvaluationCorrection[];
	vocabulary: VocabularySuggestion[];
	connectors: ConnectorSuggestion[];
	summary: string;
}

export interface EvaluationRequest {
	transcript: string;
	prompt: string;
	mode: RunMode;
	level: string;
	/** Target language name, e.g. `French`. */
	language: string;
	/** Learner's native language name, e.g. `English`. */
	translationTarget: string;
	endpoint: LlmEndpoint;
	/** Output token cap; defaults to the pacing-derived budget. */
	maxTokens?: number;
	signal?: AbortSignal;
}
