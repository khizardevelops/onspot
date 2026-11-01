// SPDX-License-Identifier: AGPL-3.0-or-later

import { chatCompletion, stripThinking } from './client';
import { repairJson } from './jsonRepair';
import {
	buildEvaluationMessages,
	isCategory,
	isExamStatus,
	isSeverity,
	MAX_VOCABULARY_SUGGESTIONS,
	type EvaluationPart
} from './prompt';
import { EXPLANATION_MAX_MISTAKES } from './explanation';
import { sentenceChunks } from '#lib/utils/textChunks.js';
import {
	composeExplanation,
	formatExplanation,
	normalizeFollowUp,
	separateFollowUp,
	speakableExplanation,
	type FollowUp
} from './explanation';
import { sameWords } from '#lib/utils/words.js';
import { MAX_EVALUATION_TOKENS } from '../../config';
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
	// The balanced span first, then the widest one in case the scan was misled,
	// each repaired for the small slips models make (see jsonRepair.ts).
	const last = candidate.lastIndexOf('}');
	for (const span of [candidate.slice(start, end + 1), candidate.slice(start, last + 1)]) {
		const repaired = repairJson(span);
		if (repaired) return JSON.parse(repaired);
	}
	throw new Error('The model returned malformed JSON. Please try again.');
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
	// A "correction" that says the same words is no correction (the model's way
	// of flagging something merely unclear); it would show the learner a fake fix.
	if (original && replacement && sameWords(original, replacement)) return null;

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

/**
 * The explanation, written from the model's validated mistakes, and its
 * follow-up question, kept apart. A model that still puts an `<ask>` question
 * in the explanation would have it spoken twice and shown twice, so the
 * question is lifted out, and used as the follow-up (without a translation)
 * when the model gave no `followUp`.
 */
function explanationAndFollowUp(
	rawExplanation: unknown,
	rawFollowUp: unknown
): { explanation: string; followUp: FollowUp | null } {
	const { parts, askedQuestion } = separateFollowUp(composeExplanation(rawExplanation));
	const explanation = formatExplanation(parts).trim();
	const followUp =
		normalizeFollowUp(rawFollowUp) ?? (askedQuestion ? { question: askedQuestion, translation: '' } : null);

	return { explanation, followUp };
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

	const correctedText = asString(r.correctedText).trim() || transcript;
	const { explanation, followUp } = explanationAndFollowUp(r.explanation, r.followUp);

	// A take in the wrong language has no French mistakes to list, so the model
	// returns none, and an empty list reads as a clean take. Flag the whole take
	// as one error instead, so the learner, the take's score and Insights see it.
	const spoken = asString(r.spokenLanguage).trim();
	const wrongLanguage =
		language && spoken && !spoken.toLowerCase().includes(language.toLowerCase()) && transcript.trim();
	if (wrongLanguage) {
		const spokenExplanation = speakableExplanation(explanation);
		corrections.splice(0, corrections.length, {
			category: 'grammar',
			severity: 'error',
			label: `Answered in ${spoken} instead of ${language}`,
			original: transcript.trim(),
			replacement: correctedText !== transcript.trim() ? correctedText : '',
			explanation: spokenExplanation || `This take was spoken in ${spoken}. Answer the prompt in ${language}.`,
			formalAlternatives: []
		});
	}

	return {
		correctedText,
		explanation,
		followUp,
		corrections,
		vocabulary,
		connectors
	};
}

/**
 * Words of a take checked in one request. The reply holds the whole correct
 * version and every correction, so a longer take (a five-minute answer is
 * about 700 words) would not fit `MAX_EVALUATION_TOKENS`; it is checked in
 * parts of whole sentences instead, sent together and paced by the
 * rate-limit pacing. The shared instructions are the same for every part, so
 * the provider serves them from its cache.
 */
const EVALUATION_PART_WORDS = 260;

/**
 * How long feedback waits for the learner's own model before a fallback
 * takes it: long enough for any per-minute allowance to refill. The fallbacks
 * are weaker at this job (GPT-OSS 20B missed corrections and broke its JSON
 * on a long take, 2026-11-01), so they only step in when the learner's model
 * is out for longer, e.g. its daily allowance is used up.
 */
const EVALUATION_PATIENCE_MS = 45_000;

/**
 * Sends a transcript to the configured LLM and returns a structured evaluation.
 * A long take is checked in parts (`EVALUATION_PART_WORDS`) whose replies are
 * joined into one. Throws with a readable message on transport, auth or parse failure.
 */
export async function evaluateAttempt(request: EvaluationRequest): Promise<EvaluationResult> {
	// Silence (or a mic that captured nothing) transcribes to "". Sending that
	// spends a paid call and comes back as invented feedback on nothing.
	if (!request.transcript.trim()) {
		throw new Error('No speech was recognised in that take. Check your microphone and try again.');
	}

	const parts = sentenceChunks(request.transcript, EVALUATION_PART_WORDS).map((span) =>
		request.transcript.slice(span.start, span.end)
	);
	const ask = async (transcript: string, part?: EvaluationPart) => {
		const raw = await chatCompletion(request.endpoint, buildEvaluationMessages({ ...request, transcript }, part), {
			json: true,
			maxTokens: request.maxTokens ?? MAX_EVALUATION_TOKENS,
			signal: request.signal,
			patienceMs: EVALUATION_PATIENCE_MS
		});
		return extractJson(raw);
	};

	if (parts.length <= 1) return normalizeEvaluation(await ask(request.transcript), request.transcript, request.language);

	const replies = await Promise.all(parts.map((transcript, index) => ask(transcript, { number: index + 1, count: parts.length })));
	return normalizeEvaluation(joinPartReplies(replies, parts), request.transcript, request.language);
}

/** Takes one item from each list in turn: the first of every list, then the second, and so on. */
function interleave<T>(lists: T[][]): T[] {
	const longest = Math.max(0, ...lists.map((list) => list.length));
	return Array.from({ length: longest }, (_, position) =>
		lists.flatMap((list) => (position < list.length ? [list[position]] : []))
	).flat();
}

/**
 * Joins the raw replies for the parts of a long take into the reply for the
 * whole: the correct versions and corrections in order, the opening note of
 * the first part, the explanation's mistakes taken from every part in turn
 * (so they span the take), and the follow-up question of the last part.
 *
 * @param replies The parsed reply of each part, in order.
 * @param parts Each part's transcript, standing in for a part whose reply lacks a correct version.
 */
function joinPartReplies(replies: unknown[], parts: string[]): Record<string, unknown> {
	const records = replies.map((reply) => (reply && typeof reply === 'object' ? (reply as Record<string, unknown>) : {}));
	const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
	const explanations = records.map((record) => (record.explanation ?? {}) as Record<string, unknown>);

	return {
		spokenLanguage: records.map((record) => asString(record.spokenLanguage)).find(Boolean) ?? '',
		correctedText: records.map((record, index) => asString(record.correctedText).trim() || parts[index]).join(' '),
		explanation: {
			note: explanations.map((explanation) => asString(explanation.note)).find(Boolean) ?? '',
			mistakes: interleave(explanations.map((explanation) => listOf(explanation.mistakes))).slice(0, EXPLANATION_MAX_MISTAKES)
		},
		followUp: [...records].reverse().find((record) => record.followUp)?.followUp ?? null,
		corrections: records.flatMap((record) => listOf(record.corrections)),
		vocabulary: interleave(records.map((record) => listOf(record.vocabulary))).slice(0, MAX_VOCABULARY_SUGGESTIONS),
		connectors: records.flatMap((record) => listOf(record.connectors))
	};
}
