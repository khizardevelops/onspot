// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a text can be in a given language, judged from its letters alone.
 *
 * The model is asked for the studied language in some fields (the follow-up
 * question) and the language of instruction in others. When the two share a
 * script it sometimes writes the wrong one: a Persian learner taught in Urdu
 * got the follow-up question in Urdu, which the Persian voice then read aloud.
 * The letters prove some of these mix-ups: the wrong script altogether, or a
 * letter only another language uses. Languages written with the same letters
 * (Spanish and Portuguese) cannot be told apart this way, so they are not:
 * this answers "could be", never "is".
 */
import { writingScriptsOf } from '#lib/languages/index.js';

/** At least this share of a text's letters must be in the language's script (names and loanwords may be Latin). */
const MIN_SHARE_IN_SCRIPT = 0.5;

/** A Japanese text this long with no kana at all is Chinese. */
const MIN_HAN_FOR_KANA_CHECK = 4;

/** Urdu-only letters among the Arabic-script languages onspot knows: ٹ ڈ ڑ ں ہ ے ۓ. */
const URDU_ONLY_LETTERS = /[ٹڈڑںہےۓ]/u;

/** Ukrainian-only Cyrillic letters: і ї є ґ. */
const UKRAINIAN_ONLY_LETTERS = /[іїєґІЇЄҐ]/u;

/** Russian-only Cyrillic letters (against Ukrainian): ы э ё ъ. */
const RUSSIAN_ONLY_LETTERS = /[ыэёъЫЭЁЪ]/u;

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/gu;
const LETTER = /\p{L}/gu;

/** Letters that show a text is in another language than this one, by language code. */
const OTHER_LANGUAGES_LETTERS: Readonly<Record<string, RegExp>> = {
	fa: URDU_ONLY_LETTERS,
	ar: URDU_ONLY_LETTERS,
	zh: KANA,
	ru: UKRAINIAN_ONLY_LETTERS,
	bg: UKRAINIAN_ONLY_LETTERS,
	uk: RUSSIAN_ONLY_LETTERS
};

/**
 * Whether a text can be in a language: most of its letters are in the
 * language's script, and none is a letter only another language uses.
 *
 * @param text Any text.
 * @param languageId The language's ISO 639-1 code.
 * @returns False only when the letters prove it is another language; true for
 *   an unknown language or a text without letters.
 */
export function couldBeWrittenIn(text: string, languageId: string): boolean {
	const scripts = writingScriptsOf(languageId);
	const letters = text.match(LETTER) ?? [];
	if (!scripts || letters.length === 0) return true;

	const inScript = new RegExp(scripts.map((script) => `\\p{Script=${script}}`).join('|'), 'u');
	const lettersInScript = letters.filter((letter) => inScript.test(letter)).length;
	if (lettersInScript / letters.length < MIN_SHARE_IN_SCRIPT) return false;

	if (OTHER_LANGUAGES_LETTERS[languageId]?.test(text)) return false;

	const hanLetters = text.match(HAN)?.length ?? 0;
	if (languageId === 'ja' && hanLetters >= MIN_HAN_FOR_KANA_CHECK && !KANA.test(text)) return false;

	return true;
}
