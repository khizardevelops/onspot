// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritingSystem } from '#lib/languages/index.js';
import { clauseSpans, sentenceSpans, type TextSpan } from '#lib/utils/segments.js';
import { tokenizeWords } from '#lib/utils/words.js';

/**
 * Cuts a long text into the pieces an on-device voice is given one at a
 * time. A Piper (VITS) voice renders its whole input in one run, and the
 * memory that run needs grows with the length of the speech it makes: the
 * five-minute simulated take (about 4,100 characters) in one run ran out of
 * WebAssembly memory ("failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE:
 * std::bad_alloc"). Piper itself is fed a sentence at a time, so this is too:
 * one piece per sentence; a sentence too long for one run is cut at its
 * clauses (packed back together up to the limit), and a clause still too long
 * into runs of whole words.
 */

/**
 * The longest piece a voice is given in one run, in characters, by how the
 * language is written: about 15 seconds of speech either way. A run's memory
 * grows with the speech it makes: measured with Piper Tom in Chromium, about
 * 28 MB a second on top of the loaded voice (one 32-second run took the page
 * from 0.9 to 1.8 GB, and the WebAssembly memory never shrinks back). French
 * runs at about 18 characters a second, so 250 fits almost every spoken
 * sentence (the simulated five-minute take's longest is 152). Japanese says
 * more with each character (a kana is a mora, a kanji often two), so it gets
 * fewer; that rate is estimated, not measured.
 */
export const MAX_PIECE_CHARS: Record<WritingSystem, number> = {
	spaced: 250,
	unspaced: 100
};

/**
 * The pieces to speak a text in, in reading order.
 *
 * @param text Any text in the target language.
 * @param writing How the language is written, which sets the longest piece (see `MAX_PIECE_CHARS`).
 * @returns The text alone when it fits one run; otherwise its sentences, long ones cut further.
 *   A single word longer than the limit stays one piece. Empty for a blank text.
 */
export function splitForSpeech(text: string, writing: WritingSystem): string[] {
	const limit = MAX_PIECE_CHARS[writing];
	const wholeText = text.trim();
	if (wholeText.length <= limit) return wholeText ? [wholeText] : [];

	const pieces = sentenceSpans(text).flatMap((sentence) => sentencePieces(text, sentence, limit));
	return pieces.map((piece) => text.slice(piece.start, piece.end));
}

function spanLength(span: TextSpan): number {
	return span.end - span.start;
}

/** A sentence as it is, or cut at its clauses when it is longer than `limit`. */
function sentencePieces(text: string, sentence: TextSpan, limit: number): TextSpan[] {
	if (spanLength(sentence) <= limit) return [sentence];

	const parts = clauseSpans(text, sentence).flatMap((clause) =>
		spanLength(clause) <= limit ? [clause] : wordRuns(text, clause, limit)
	);
	return packed(parts, limit);
}

/**
 * Joins neighbouring parts of one sentence while they fit one run, so a long
 * sentence is cut as few times as it must be (each cut is a pause).
 */
function packed(parts: readonly TextSpan[], limit: number): TextSpan[] {
	const pieces: TextSpan[] = [];

	for (const part of parts) {
		const current = pieces.at(-1);
		const fitsCurrent = current !== undefined && part.end - current.start <= limit;
		if (fitsCurrent) current.end = part.end;
		else pieces.push({ ...part });
	}

	return pieces;
}

/**
 * Cuts a clause with no punctuation to cut at into runs of whole words, each
 * within `limit`. Punctuation stays with the word before it. Japanese words
 * come from the browser's segmenter (see `tokenizeWords`).
 */
function wordRuns(text: string, clause: TextSpan, limit: number): TextSpan[] {
	const runs: TextSpan[] = [];
	const clauseText = text.slice(clause.start, clause.end);

	for (const token of tokenizeWords(clauseText)) {
		const isSpace = !token.text.trim();
		if (isSpace) continue;

		const start = clause.start + token.start;
		const end = clause.start + token.end;
		const current = runs.at(-1);
		const fitsCurrent = current !== undefined && end - current.start <= limit;
		const isPunctuation = current !== undefined && !token.word;

		if (fitsCurrent || isPunctuation) current.end = end;
		else runs.push({ start, end });
	}

	return runs;
}
