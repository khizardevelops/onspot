// SPDX-License-Identifier: AGPL-3.0-or-later

import { clauseSpans, sentenceSpans, type TextSpan } from './segments';
import { tokenizeWords, type TextToken } from './words';

/**
 * Splits a long text into parts of whole sentences, for work that has to be
 * sent in pieces: one LLM request has to fit a provider's per-minute limit,
 * and its reply has to fit its token budget. A five-minute take is about 700
 * words, too many for either in one go.
 *
 * Parts are as even as the sentences allow, so no part is a short leftover.
 * A sentence longer than a part (speech recognised without full stops) is cut
 * at its clauses, and a clause still too long into runs of words.
 */

/** The word tokens inside a span of the text. */
function wordsIn(words: TextToken[], span: TextSpan): TextToken[] {
	return words.filter((word) => word.start >= span.start && word.end <= span.end);
}

/** Runs of at most `maxWords` words covering a span too long to keep whole. */
function wordRuns(words: TextToken[], span: TextSpan, maxWords: number): TextSpan[] {
	const inside = wordsIn(words, span);
	const runs: TextSpan[] = [];

	for (let first = 0; first < inside.length; first += maxWords) {
		const last = Math.min(inside.length, first + maxWords) - 1;
		const isLastRun = last === inside.length - 1;
		runs.push({ start: first === 0 ? span.start : inside[first].start, end: isLastRun ? span.end : inside[last].end });
	}
	return runs;
}

/** The text's sentences, with any sentence longer than `maxWords` cut into clauses, then runs of words. */
function pieces(text: string, words: TextToken[], maxWords: number): TextSpan[] {
	return sentenceSpans(text).flatMap((sentence) => {
		if (wordsIn(words, sentence).length <= maxWords) return [sentence];

		return clauseSpans(text, sentence).flatMap((clause) =>
			wordsIn(words, clause).length <= maxWords ? [clause] : wordRuns(words, clause, maxWords)
		);
	});
}

/**
 * The text cut into consecutive parts of whole sentences, each at most about
 * `maxWords` words, as even in size as the sentences allow.
 *
 * @param text Any text.
 * @param maxWords The most words a part should hold.
 * @returns The parts' spans in `text`, in order; one span for a text that already fits.
 */
export function sentenceChunks(text: string, maxWords: number): TextSpan[] {
	const words = tokenizeWords(text).filter((token) => token.word);
	const partCount = Math.ceil(words.length / maxWords);
	if (partCount <= 1) {
		const whole = sentenceSpans(text);
		return whole.length === 0 ? [] : [{ start: whole[0].start, end: whole.at(-1)!.end }];
	}

	// Even parts: 700 words in parts of 250 become three of ~233, not 250 + 250 + 200.
	const targetWords = Math.ceil(words.length / partCount);
	const chunks: TextSpan[] = [];
	let open: { span: TextSpan; words: number } | null = null;

	for (const piece of pieces(text, words, maxWords)) {
		const pieceWords = wordsIn(words, piece).length;
		if (open && open.words + pieceWords <= targetWords) {
			open.span.end = piece.end;
			open.words += pieceWords;
			continue;
		}
		if (open) chunks.push(open.span);
		open = { span: { ...piece }, words: pieceWords };
	}

	if (open) chunks.push(open.span);
	return chunks;
}
