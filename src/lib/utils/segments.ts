// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sentence and clause boundaries in a take's text, and the punctuation that
 * makes them, shared by everything that needs to know where a sentence ends
 * (explanations, corrected passages, the pauses between spoken pieces).
 *
 * Rules are intentionally simple and language-agnostic: a sentence ends after
 * one of `SENTENCE_END_MARKS` (and repetitions, e.g. `!?`), keeping the
 * punctuation; a clause ends after one of `CLAUSE_END_MARKS` inside a
 * sentence. Good enough to replay one sentence of a longer answer, or to show
 * a correction in its sentence.
 */

/**
 * Punctuation that ends a sentence, in every script onspot shows: `.!?…`, the
 * full-width Japanese and Chinese `。！？`, the Arabic-script question mark `؟`,
 * the Urdu full stop `۔`, the Devanagari danda `।` and double danda `॥`
 * (Hindi, Bengali) and the Greek question mark U+037E (which looks like a
 * semicolon; text normalised to NFC carries a plain `;` instead, which is not
 * treated as an end). Written to go inside a regex character class.
 */
export const SENTENCE_END_MARKS = '.!?…。！？؟۔।॥\u037e';

/**
 * Punctuation that ends a clause: commas, semicolons, colons and dashes, with
 * the Japanese `、` and the Arabic-script comma `،` and semicolon `؛`. Written
 * to go inside a regex character class.
 */
export const CLAUSE_END_MARKS = ',;:—–、،؛';

/** Quotes and brackets that may follow a sentence's last mark ("…fin." » or 」). */
const CLOSING_MARKS = '"»”\'」』)';

const SENTENCE = new RegExp(`[^${SENTENCE_END_MARKS}]+[${SENTENCE_END_MARKS}]+|[^${SENTENCE_END_MARKS}]+$`, 'g');

const CLAUSE_END = new RegExp(`[${CLAUSE_END_MARKS}]+`, 'g');

const ENDS_SENTENCE = new RegExp(`[${SENTENCE_END_MARKS}][${CLOSING_MARKS}]?$`);

/**
 * Whether a text ends with a sentence's last mark (a closing quote after it
 * is allowed), in any script: `بتایا۔` and `你好。` end sentences as `Done.` does.
 *
 * @param text Any text; trailing spaces are ignored.
 */
export function endsSentence(text: string): boolean {
	return ENDS_SENTENCE.test(text.trimEnd());
}

/** A part of a text by character offsets, `end` exclusive. */
export interface TextSpan {
	start: number;
	end: number;
}

/**
 * Where each sentence of a text starts and ends, without the spaces around it.
 *
 * @param text Any text.
 * @returns The sentences' spans, in order; empty for a blank text.
 */
export function sentenceSpans(text: string): TextSpan[] {
	const spans: TextSpan[] = [];

	for (const match of text.matchAll(SENTENCE)) {
		const span = trimmedSpan(text, match.index, match.index + match[0].length);
		if (span) spans.push(span);
	}

	return spans;
}

/**
 * Where each clause of one sentence starts and ends, the clause's own
 * punctuation (a comma, a colon) kept with it.
 *
 * @param text The whole text.
 * @param sentence One of its sentences (see `sentenceSpans`).
 * @returns The clauses' spans in `text` offsets, in order; the sentence itself when it has one clause.
 */
export function clauseSpans(text: string, sentence: TextSpan): TextSpan[] {
	const sentenceText = text.slice(sentence.start, sentence.end);
	const spans: TextSpan[] = [];
	let clauseStart = 0;

	for (const match of sentenceText.matchAll(CLAUSE_END)) {
		const clauseEnd = match.index + match[0].length;
		const span = trimmedSpan(text, sentence.start + clauseStart, sentence.start + clauseEnd);
		if (span) spans.push(span);
		clauseStart = clauseEnd;
	}

	const lastClause = trimmedSpan(text, sentence.start + clauseStart, sentence.end);
	if (lastClause) spans.push(lastClause);

	return spans;
}

/** `start`..`end` of `text` without leading and trailing spaces, or null when only spaces are left. */
function trimmedSpan(text: string, start: number, end: number): TextSpan | null {
	let from = start;
	let to = end;
	while (from < to && /\s/.test(text[from])) from++;
	while (to > from && /\s/.test(text[to - 1])) to--;

	return to > from ? { start: from, end: to } : null;
}

/**
 * Splits a transcript into sentence-sized segments for per-segment playback.
 *
 * @param text Any text.
 * @returns Its sentences, trimmed, in order.
 */
export function splitSentences(text: string): string[] {
	return sentenceSpans(text).map((span) => text.slice(span.start, span.end));
}
