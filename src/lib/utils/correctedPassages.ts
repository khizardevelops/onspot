// SPDX-License-Identifier: AGPL-3.0-or-later

import { diffArrays } from 'diff';
import { clauseSpans, sentenceSpans, type TextSpan } from './segments';
import { comparableWord, tokenizeWords, type TextToken } from './words';

/**
 * "Did you mean to say?" without repeating a long take: the parts of the
 * correct version that differ from what was said, each in its context.
 *
 * The two texts are aligned word by word (jsdiff's `diffArrays`), ignoring
 * case, apostrophe style and punctuation (the recogniser and the LLM
 * punctuate differently). A change is therefore found wherever it is, even
 * when the correct version splits a sentence differently, and without
 * searching for the replacement's text, which may occur many times ("de", "à").
 *
 * Each change is shown in its sentence. A very long sentence is cut down to
 * the clauses around the change (with at least `MIN_CONTEXT_WORDS` words), and
 * a clause that is itself too long to a window of words around the change.
 * Passages that overlap, touch, or are only a few words apart become one.
 */

/** A sentence longer than this (in words) is cut down to the clauses around the change. */
const LONG_SENTENCE_WORDS = 30;

/** Fewer words than this is too little context: neighbouring clauses are added. */
const MIN_CONTEXT_WORDS = 8;

/** Words kept on each side of a change inside a clause that is itself too long. */
const WINDOW_SIDE_WORDS = 8;

/** Passages this few words apart are joined: a gap marker hiding two words helps nobody. */
const JOIN_GAP_WORDS = 3;

/** Words `start`..`end` by index among a text's word tokens, inclusive. */
interface WordRange {
	start: number;
	end: number;
}

/** A sentence or a clause: where it is in the text, and which words it holds. */
interface TextUnit {
	span: TextSpan;
	words: WordRange;
}

/** One excerpt of the correct version, by character offsets (`end` exclusive). */
export interface Passage extends TextSpan {
	/** True when it starts inside a sentence (a clause or a window was cut out of it). */
	cutBefore: boolean;
	/** True when it ends inside a sentence. */
	cutAfter: boolean;
}

export interface CorrectedPassages {
	/** The excerpts to show, in order; text is left out between consecutive ones. */
	passages: Passage[];
	/** Word indexes (among the correct version's word tokens) that differ from what was said. */
	changedWords: Set<number>;
	/**
	 * Words the learner said that the correct version drops (nothing replaces
	 * them), as said, by the word index they stood before. The word count
	 * itself means "after the last word".
	 */
	removedBefore: Map<number, string>;
	/**
	 * Words the learner said that a fix replaces, as said, by the index of the
	 * fix's first word: "j'ai" before "je suis" in "je suis allé".
	 */
	replacedBefore: Map<number, string>;
	/** True when one passage is the whole text: nothing would be left out. */
	coversWholeText: boolean;
}

/**
 * The parts of the correct version to show for "Did you mean to say?".
 *
 * @param said What the learner said (the transcript).
 * @param corrected The correct version of the whole take.
 * @returns The passages that hold every change, and the changed words to mark in them.
 */
export function correctedPassages(said: string, corrected: string): CorrectedPassages {
	const correctWords = wordTokens(corrected);
	if (correctWords.length === 0) {
		return { passages: [], changedWords: new Set(), removedBefore: new Map(), replacedBefore: new Map(), coversWholeText: false };
	}

	const { changedWords, removedBefore, replacedBefore, changedRanges } = compareWords(said, wordTokens(said), correctWords);

	const sentences = unitsOf(sentenceSpans(corrected), correctWords);
	const sentenceOfWord = indexWordsByUnit(sentences);

	const contextRanges = changedRanges.map((change) =>
		contextAround(change, sentences[sentenceOfWord[change.start]], sentences[sentenceOfWord[change.end]], corrected, correctWords)
	);
	const joinedRanges = joinNearby(contextRanges);

	const passages = joinedRanges.map((range) => passageOf(range, sentences, sentenceOfWord, correctWords));
	const lastWord = correctWords.length - 1;
	const coversWholeText = joinedRanges.length === 1 && joinedRanges[0].start === 0 && joinedRanges[0].end === lastWord;

	return { passages, changedWords, removedBefore, replacedBefore, coversWholeText };
}

/** Adds words said at a position to a map of them, after any already there. */
function appendSaid(saidByWord: Map<number, string>, wordIndex: number, saidText: string): void {
	const before = saidByWord.get(wordIndex);
	saidByWord.set(wordIndex, before ? `${before} ${saidText}` : saidText);
}

/** The word tokens of a text, numbered as the transcript view and the word meanings number them. */
function wordTokens(text: string): TextToken[] {
	return tokenizeWords(text).filter((token) => token.word);
}

/** Ends a sentence (see `segments.ts`). */
const SENTENCE_END = /[.!?…。！？]/;

/**
 * Aligns what was said with the correct version, word by word.
 *
 * @param said What the learner said.
 * @param saidWords Its word tokens.
 * @param correctWords The correct version's word tokens.
 * @returns The correct version's words that differ, where words were dropped,
 *   which words each fix replaced, and each change as a range of the correct
 *   version's words (dropped words as the word beside the gap, in the
 *   sentence they were said in).
 */
function compareWords(said: string, saidWords: TextToken[], correctWords: TextToken[]) {
	const differences = diffArrays(
		saidWords.map((token) => comparableWord(token.text)),
		correctWords.map((token) => comparableWord(token.text))
	);

	const changedWords = new Set<number>();
	const removedBefore = new Map<number, string>();
	const replacedBefore = new Map<number, string>();
	const changedRanges: WordRange[] = [];
	const lastWord = correctWords.length - 1;
	let saidIndex = 0;
	let correctIndex = 0;

	/** The text of `count` said words from `saidIndex`, with what stood between them. */
	const saidTextOf = (count: number) => said.slice(saidWords[saidIndex].start, saidWords[saidIndex + count - 1].end);

	for (const [position, difference] of differences.entries()) {
		if (difference.added) {
			const range = { start: correctIndex, end: correctIndex + difference.count - 1 };
			for (let index = range.start; index <= range.end; index++) changedWords.add(index);

			changedRanges.push(range);
			correctIndex += difference.count;
			continue;
		}

		if (difference.removed) {
			const saidText = saidTextOf(difference.count);

			// Words said in place of others stand before the fix that replaces
			// them; its words are already marked as the change.
			const isReplacedByNext = Boolean(differences[position + 1]?.added);
			const isReplacedByPrevious = !isReplacedByNext && Boolean(differences[position - 1]?.added);
			if (isReplacedByNext) appendSaid(replacedBefore, correctIndex, saidText);
			if (isReplacedByPrevious) appendSaid(replacedBefore, correctIndex - differences[position - 1].count, saidText);

			const isDropped = !isReplacedByNext && !isReplacedByPrevious;
			if (isDropped) {
				appendSaid(removedBefore, correctIndex, saidText);

				// "… merci. Ouais, franchement" belongs with "Franchement", not with "merci".
				const textBeforeDropped = saidIndex === 0 ? '' : said.slice(saidWords[saidIndex - 1].end, saidWords[saidIndex].start);
				const droppedStartSentence = saidIndex === 0 || SENTENCE_END.test(textBeforeDropped);
				const hasWordAfter = correctIndex <= lastWord;
				const hasWordBefore = correctIndex > 0;
				const belongsAfter = hasWordAfter && (droppedStartSentence || !hasWordBefore);

				const wordBesideGap = belongsAfter ? correctIndex : correctIndex - 1;
				changedRanges.push({ start: wordBesideGap, end: wordBesideGap });
			}
			saidIndex += difference.count;
			continue;
		}

		saidIndex += difference.count;
		correctIndex += difference.count;
	}

	return { changedWords, removedBefore, replacedBefore, changedRanges };
}

/** Pairs each span (sentence or clause) with the words inside it; spans without words are dropped. */
function unitsOf(spans: TextSpan[], words: TextToken[]): TextUnit[] {
	const units: TextUnit[] = [];
	let wordIndex = words.findIndex((word) => word.start >= (spans[0]?.start ?? 0));
	if (wordIndex === -1) return units;

	for (const span of spans) {
		while (wordIndex < words.length && words[wordIndex].start < span.start) wordIndex++;

		const firstWord = wordIndex;
		while (wordIndex < words.length && words[wordIndex].end <= span.end) wordIndex++;

		const hasWords = wordIndex > firstWord;
		if (hasWords) units.push({ span, words: { start: firstWord, end: wordIndex - 1 } });
	}

	return units;
}

/** For every word, the index of the unit (sentence) that holds it. */
function indexWordsByUnit(units: TextUnit[]): number[] {
	const unitOfWord: number[] = [];

	for (const [unitIndex, unit] of units.entries()) {
		for (let word = unit.words.start; word <= unit.words.end; word++) unitOfWord[word] = unitIndex;
	}

	return unitOfWord;
}

function wordCount(range: WordRange): number {
	return range.end - range.start + 1;
}

/**
 * The words to show around one change: its sentence (or sentences), or, in a
 * very long sentence, the clauses around it.
 */
function contextAround(
	change: WordRange,
	firstSentence: TextUnit,
	lastSentence: TextUnit,
	text: string,
	words: TextToken[]
): WordRange {
	const sentenceWords = { start: firstSentence.words.start, end: lastSentence.words.end };
	const isOneLongSentence = firstSentence === lastSentence && wordCount(sentenceWords) > LONG_SENTENCE_WORDS;
	if (!isOneLongSentence) return sentenceWords;

	return clausesAround(change, firstSentence, text, words);
}

/**
 * The clauses of a long sentence that hold a change, grown by the shorter
 * neighbouring clause until there is enough context; a window of words
 * around the change when even that is too long.
 */
function clausesAround(change: WordRange, sentence: TextUnit, text: string, words: TextToken[]): WordRange {
	const clauses = unitsOf(clauseSpans(text, sentence.span), words);
	let firstClause = clauses.findIndex((clause) => clause.words.end >= change.start);
	let lastClause = clauses.findLastIndex((clause) => clause.words.start <= change.end);
	if (firstClause === -1 || lastClause === -1) return sentence.words;

	const shownWords = () => ({ start: clauses[firstClause].words.start, end: clauses[lastClause].words.end });
	const canGrow = () => firstClause > 0 || lastClause < clauses.length - 1;

	while (wordCount(shownWords()) < MIN_CONTEXT_WORDS && canGrow()) {
		const wordsBefore = firstClause > 0 ? wordCount(clauses[firstClause - 1].words) : Infinity;
		const wordsAfter = lastClause < clauses.length - 1 ? wordCount(clauses[lastClause + 1].words) : Infinity;

		if (wordsAfter <= wordsBefore) lastClause++;
		else firstClause--;
	}

	const clauseWords = shownWords();
	if (wordCount(clauseWords) <= LONG_SENTENCE_WORDS) return clauseWords;

	return {
		start: Math.max(sentence.words.start, change.start - WINDOW_SIDE_WORDS),
		end: Math.min(sentence.words.end, change.end + WINDOW_SIDE_WORDS)
	};
}

/** Joins ranges that overlap, touch, or leave only a few words between them. */
function joinNearby(ranges: WordRange[]): WordRange[] {
	const sorted = [...ranges].sort((first, second) => first.start - second.start);
	const joined: WordRange[] = [];

	for (const range of sorted) {
		const previous = joined.at(-1);
		const isNear = previous && range.start <= previous.end + 1 + JOIN_GAP_WORDS;

		if (previous && isNear) previous.end = Math.max(previous.end, range.end);
		else joined.push({ ...range });
	}

	return joined;
}

/**
 * The characters a range of words covers. A range that starts or ends with a
 * sentence takes the sentence's own edges (its full stop, a French « ? »
 * after a space); one cut out of a sentence starts and ends with its words.
 */
function passageOf(range: WordRange, sentences: TextUnit[], sentenceOfWord: number[], words: TextToken[]): Passage {
	const startSentence = sentences[sentenceOfWord[range.start]];
	const endSentence = sentences[sentenceOfWord[range.end]];
	const cutBefore = range.start > startSentence.words.start;
	const cutAfter = range.end < endSentence.words.end;

	return {
		start: cutBefore ? words[range.start].start : startSentence.span.start,
		end: cutAfter ? words[range.end].end : endSentence.span.end,
		cutBefore,
		cutAfter
	};
}
