import { chatCompletion, stripThinking } from './client';
import { buildEvaluationMessages, isCategory, isExamStatus, isSeverity } from './prompt';
import { MAX_EVALUATION_TOKENS } from '../../config';
import type { TranslationSet } from '../db/types';
import type {
	ConnectorSuggestion,
	EvaluationCorrection,
	EvaluationRequest,
	EvaluationResult,
	VocabularySuggestion
} from './types';

/**
 * Pulls a JSON object out of a model response.
 *
 * JSON mode is requested, but not every provider honours it (and some wrap the
 * object in a fenced code block anyway), so the parser tolerates both.
 */
export function extractJson(raw: string): unknown {
	const trimmed = stripThinking(raw).trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1] : trimmed;
	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error('The model did not return a JSON object.');
	}
	return JSON.parse(candidate.slice(start, end + 1));
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === 'string');
}

function mapCorrection(raw: unknown): EvaluationCorrection | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (!isCategory(r.category) || !isSeverity(r.severity)) return null;
	const original = asString(r.original);
	const replacement = asString(r.replacement);
	if (!original && !replacement) return null;

	return {
		category: r.category,
		severity: r.severity,
		label: asString(r.label, 'Correction'),
		original,
		replacement,
		replacementTranslation: asString(r.replacementTranslation) || undefined,
		explanation: asString(r.explanation),
		speakText: asString(r.speakText) || undefined,
		examStatus: isExamStatus(r.examStatus) ? r.examStatus : undefined,
		formalAlternatives: asStringArray(r.formalAlternatives)
	};
}

function mapVocabulary(raw: unknown): VocabularySuggestion | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const original = asString(r.original);
	const suggestion = asString(r.suggestion);
	if (!original || !suggestion) return null;
	return { original, suggestion, why: asString(r.why) };
}

function mapConnector(raw: unknown): ConnectorSuggestion | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const connector = asString(r.connector);
	if (!connector) return null;
	return {
		connector,
		insteadOf: asString(r.insteadOf) || undefined,
		why: asString(r.why)
	};
}

/** Validates and normalises a model response into a trusted `EvaluationResult`. */
export function normalizeEvaluation(raw: unknown, transcript: string): EvaluationResult {
	if (!raw || typeof raw !== 'object') throw new Error('Empty evaluation response.');
	const r = raw as Record<string, unknown>;

	const corrections = Array.isArray(r.corrections)
		? r.corrections.map(mapCorrection).filter((c): c is EvaluationCorrection => c !== null)
		: [];
	const vocabulary = Array.isArray(r.vocabulary)
		? r.vocabulary.map(mapVocabulary).filter((v): v is VocabularySuggestion => v !== null)
		: [];
	const connectors = Array.isArray(r.connectors)
		? r.connectors.map(mapConnector).filter((c): c is ConnectorSuggestion => c !== null)
		: [];

	const rawTranslations = (r.translations ?? {}) as Record<string, unknown>;
	// Backwards compatibility: an older response may carry a single `translation`.
	const idiomatic = asString(rawTranslations.idiomatic) || asString(r.translation);
	const literal = asString(rawTranslations.literal);
	const wordForWord = asString(rawTranslations.wordForWord);
	const translations: TranslationSet = {
		// An incomplete model response stays readable, but remains versionless so
		// choosing a translation view repairs it with the dedicated strict prompt.
		version: idiomatic && literal && wordForWord ? 2 : undefined,
		idiomatic,
		idiomaticVariants: asStringArray(rawTranslations.idiomaticVariants)
			.map((value) => value.trim())
			.filter((value, index, values) => value && value !== idiomatic && values.indexOf(value) === index)
			.slice(0, 2),
		literal: literal || idiomatic,
		wordForWord: wordForWord || idiomatic,
		wordBreakdown: []
	};

	return {
		correctedText: asString(r.correctedText, transcript),
		naturalSpeech: asString(r.naturalSpeech, asString(r.correctedText, transcript)),
		translations,
		summary: asString(r.summary),
		corrections,
		vocabulary,
		connectors
	};
}

/**
 * Sends a transcript to the configured LLM and returns a structured evaluation.
 * Throws with a readable message on transport, auth or parse failure.
 */
export async function evaluateAttempt(request: EvaluationRequest): Promise<EvaluationResult> {
	const raw = await chatCompletion(request.endpoint, buildEvaluationMessages(request), {
		json: true,
		maxTokens: request.maxTokens ?? MAX_EVALUATION_TOKENS,
		signal: request.signal
	});
	return normalizeEvaluation(extractJson(raw), request.transcript);
}
