// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sentence and clause boundaries in a take's text.
 *
 * Rules are intentionally simple and language-agnostic: a sentence ends after
 * `.!?…` or their full-width Japanese forms `。！？` (and repetitions, e.g.
 * `!?`), keeping the punctuation; a clause ends after a comma, semicolon,
 * colon or dash inside a sentence. Good enough to replay one sentence of a
 * longer answer, or to show a correction in its sentence.
 */

/** A part of a text by character offsets, `end` exclusive. */
export interface TextSpan {
	start: number;
	end: number;
}

const SENTENCE = /[^.!?…。！？]+[.!?…。！？]+|[^.!?…。！？]+$/g;

/** Commas, semicolons, colons and dashes (and the Japanese comma) end a clause. */
const CLAUSE_END = /[,;:—–、]+/g;

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
