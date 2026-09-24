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

const SPACED_TOKEN = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|(\s+)|([^\s])/gu;
const JAPANESE_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/** True when the text is written in Japanese script (kana or kanji). */
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

let segmenter: Intl.Segmenter | null | undefined;
function japaneseSegmenter(): Intl.Segmenter | null {
	if (segmenter === undefined) {
		segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
	}
	return segmenter;
}

export function tokenizeWords(text: string): TextToken[] {
	const tokens: TextToken[] = [];
	const japanese = isJapaneseText(text) ? japaneseSegmenter() : null;
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
 * Text length in Latin-glyph units for layout estimates: a CJK character is
 * about as wide as two Latin letters.
 */
export function layoutLength(text: string): number {
	let length = text.length;
	for (const char of text) if (JAPANESE_SCRIPT.test(char) || /[　-ヿ＀-￯]/.test(char)) length += 1;
	return length;
}
