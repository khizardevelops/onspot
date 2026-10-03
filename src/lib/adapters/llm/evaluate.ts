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
 * Index of the `}` that closes the object opening at `start`, honouring JSON
 * strings (a `}` inside an explanation must not end the object), or -1 when
 * the object never closes (a response cut off at the token limit).
 */
function closingBrace(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (char === '\\') i++;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return i;
	}
	return -1;
}

/**
 * Pulls a JSON object out of a model response.
 *
 * JSON mode is requested, but not every provider honours it (and some wrap the
 * object in a fenced code block, or add a sentence with braces after it), so
 * the parser takes the first balanced object rather than first-to-last brace.
 */
export function extractJson(raw: string): unknown {
	const trimmed = stripThinking(raw).trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1] : trimmed;
	const start = candidate.indexOf('{');
	if (start === -1) throw new Error('The model did not return a JSON object.');

	const end = closingBrace(candidate, start);
	if (end === -1) {
		throw new Error('The model’s reply was cut off before it finished. Please try again.');
	}
	try {
		return JSON.parse(candidate.slice(start, end + 1));
	} catch {
		// Fall back to the widest span in case the balanced scan was misled.
		const last = candidate.lastIndexOf('}');
		try {
			return JSON.parse(candidate.slice(start, last + 1));
		} catch {
			throw new Error('The model returned malformed JSON. Please try again.');
		}
	}
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
export function normalizeEvaluation(raw: unknown, transcript: string, language?: string): EvaluationResult {
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

	const correctedText = asString(r.correctedText, transcript);
	const naturalSpeech = asString(r.naturalSpeech, correctedText);
	const summary = asString(r.summary);

	// A take in the wrong language has no French mistakes to list, so the model
	// returns none, and an empty list reads as a clean take. Flag the whole take
	// as one error instead, so the learner, the take's score and Insights see it.
	const spoken = asString(r.spokenLanguage).trim();
	const wrongLanguage =
		language && spoken && !spoken.toLowerCase().includes(language.toLowerCase()) && transcript.trim();
	if (wrongLanguage) {
		corrections.splice(0, corrections.length, {
			category: 'grammar',
			severity: 'error',
			label: `Answered in ${spoken} instead of ${language}`,
			original: transcript.trim(),
			replacement: naturalSpeech !== transcript.trim() ? naturalSpeech : '',
			explanation: summary || `This take was spoken in ${spoken}. Answer the prompt in ${language}.`,
			formalAlternatives: []
		});
	}

	return {
		correctedText,
		naturalSpeech,
		translations,
		summary,
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
	// Silence (or a mic that captured nothing) transcribes to "". Sending that
	// spends a paid call and comes back as invented feedback on nothing.
	if (!request.transcript.trim()) {
		throw new Error('No speech was recognised in that take. Check your microphone and try again.');
	}
	const raw = await chatCompletion(request.endpoint, buildEvaluationMessages(request), {
		json: true,
		maxTokens: request.maxTokens ?? MAX_EVALUATION_TOKENS,
		signal: request.signal
	});
	return normalizeEvaluation(extractJson(raw), request.transcript, request.language);
}
