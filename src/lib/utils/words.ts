// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Splits transcript text into word / space / punctuation tokens with their
 * character offsets, so each word can be clicked and correction ranges can be
 * mapped onto words.
 *
 * Spaced languages (French) keep the original rule: letter/number runs joined
 * by apostrophes and hyphens form a word. Japanese has no spaces, so that rule
 * would turn a whole clause into one "word"; it is segmented with the
 * browser's `Intl.Segmenter` instead (ICU dictionary-based word breaks).
 */
export interface TextToken {
	text: string;
	word: boolean;
	start: number;
	end: number;
}

const SPACED_TOKEN = /([\p{L}\p{N}]+(?:['’\-\u200c][\p{L}\p{N}]+)*)|(\s+)|([^\s])/gu;
const JAPANESE_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
/** Kana appears only in Japanese: Han characters without it are read as Chinese. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;

/**
 * The direction a text should be laid out in: right-to-left when it contains
 * Arabic-script (Persian, Arabic, Urdu) or Hebrew text, otherwise `auto` so the
 * browser uses the first strong character. Latin sample text therefore stays
 * LTR even when the studied language is Persian.
 */
export function directionForText(text: string): 'rtl' | 'auto' {
	return RTL_SCRIPT.test(text) ? 'rtl' : 'auto';
}

/** True when the text is written without spaces between words: Japanese (kana, kanji) or Chinese (Han). */
export function isJapaneseText(text: string): boolean {
	return JAPANESE_SCRIPT.test(text);
}

/**
 * ICU's dictionary breaks cut inflections apart (食|べ|ま|した, 美味|しか|っ|た),
 * which makes useless click targets. A hiragana-only piece that is not a
 * particle is an inflection or auxiliary, so it joins the word before it
 * (食べました, 美味しかったです); particles stay their own tokens.
 */
const PARTICLES = new Set([
	'は', 'が', 'を', 'に', 'で', 'と', 'の', 'へ', 'も', 'や', 'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'さ',
	'から', 'まで', 'より', 'って', 'ので', 'のに', 'けど', 'けれど', 'けれども', 'し', 'ば', 'たり', 'だけ',
	'など', 'ほど', 'くらい', 'ぐらい', 'でも', 'では', 'には', 'とは', 'へは', 'とか', 'なら', 'ばかり'
]);
function attachesToPrevious(piece: string): boolean {
	return /^[\p{Script=Hiragana}ー]+$/u.test(piece) && !PARTICLES.has(piece);
}

const segmenters = new Map<'ja' | 'zh', Intl.Segmenter | null>();

/** A word segmenter for unspaced text: Japanese when it has kana, Chinese otherwise. */
function unspacedSegmenter(text: string): Intl.Segmenter | null {
	const locale = KANA.test(text) ? 'ja' : 'zh';
	if (!segmenters.has(locale)) {
		const available = typeof Intl !== 'undefined' && 'Segmenter' in Intl;
		segmenters.set(locale, available ? new Intl.Segmenter(locale, { granularity: 'word' }) : null);
	}
	return segmenters.get(locale) ?? null;
}

export function tokenizeWords(text: string): TextToken[] {
	const tokens: TextToken[] = [];
	const japanese = isJapaneseText(text) ? unspacedSegmenter(text) : null;
	if (japanese) {
		for (const part of japanese.segment(text)) {
			const token = {
				text: part.segment,
				word: Boolean(part.isWordLike),
				start: part.index,
				end: part.index + part.segment.length
			};
			const previous = tokens.at(-1);
			if (previous?.word && token.word && attachesToPrevious(token.text)) {
				previous.text += token.text;
				previous.end = token.end;
			} else {
				tokens.push(token);
			}
		}
		return tokens;
	}
	for (const match of text.matchAll(SPACED_TOKEN)) {
		const start = match.index ?? 0;
		tokens.push({ text: match[0], word: Boolean(match[1]), start, end: start + match[0].length });
	}
	return tokens;
}

/**
 * True when two texts say the same words, ignoring case, punctuation, spacing
 * and apostrophe style. The recogniser and the LLM punctuate differently, so a
 * correct take often comes back with only a full stop, a capital or a curly
 * apostrophe (j'ai / j’ai) changed.
 *
 * @param first One text, e.g. the transcript.
 * @param second The other, e.g. the correct version.
 * @returns Whether the word sequences are identical.
 */
export function sameWords(first: string, second: string): boolean {
	const firstWords = comparableWords(first);
	const secondWords = comparableWords(second);

	return (
		firstWords.length === secondWords.length &&
		firstWords.every((word, position) => word === secondWords[position])
	);
}

/**
 * A word as it is compared with another: lower-cased, with one apostrophe
 * style, so a capital or a curly apostrophe (j'ai / J’ai) is not a change.
 *
 * @param word One word token's text.
 * @returns The form to compare.
 */
export function comparableWord(word: string): string {
	return word.toLocaleLowerCase().replaceAll('’', "'");
}

/** The words of a text in their comparable form (see `comparableWord`). */
function comparableWords(text: string): string[] {
	return tokenizeWords(text)
		.filter((token) => token.word)
		.map((token) => comparableWord(token.text));
}

/**
 * True when one text's words run, in order and together, inside the other's,
 * ignoring case, punctuation and apostrophe style: "en tarp" overlaps
 * "détruit en tarp". Two empty texts do not overlap.
 *
 * @param first One text.
 * @param second The other.
 * @returns Whether the shorter word sequence is part of the longer one.
 */
export function overlappingWords(first: string, second: string): boolean {
	const firstWords = comparableWords(first);
	const secondWords = comparableWords(second);
	const [shorter, longer] = firstWords.length <= secondWords.length ? [firstWords, secondWords] : [secondWords, firstWords];
	if (shorter.length === 0) return false;

	for (let start = 0; start + shorter.length <= longer.length; start++) {
		const matchesHere = shorter.every((word, offset) => longer[start + offset] === word);
		if (matchesHere) return true;
	}

	return false;
}

/**
 * Text length in Latin-glyph units for layout estimates: a CJK character is
 * about as wide as two Latin letters.
 */
export function layoutLength(text: string): number {
	let length = text.length;
	for (const char of text) if (JAPANESE_SCRIPT.test(char) || /[　-ヿ＀-￯]/.test(char)) length += 1;
	return length;
}
