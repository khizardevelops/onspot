// SPDX-License-Identifier: AGPL-3.0-or-later

import { chatCompletion } from './client';
import { extractJson } from './evaluate';
import type { TranslationLanguage } from './translationPrompt';
import type { ChatMessage, LlmEndpoint } from './types';
import type { GlossedRange, PhraseGloss, TextGlosses } from '../db/types';
import { sentenceSpans, type TextSpan } from '#lib/utils/segments.js';
import { tokenizeWords, type TextToken } from '#lib/utils/words.js';

/**
 * Hover translations: the meaning of each word of a text, in the sense it has
 * in that sentence ("allé" → "went", not the dictionary "gone"), plus the
 * multi-word expressions that only make sense together ("pomme de terre" →
 * "potato"). A dictionary cannot do this, and text may only leave the device
 * through the learner's own LLM, so the configured model glosses the words the
 * first time the learner hovers one: a section of whole sentences at a time
 * (`glossSections`), so a five-minute take is never one huge request and the
 * learner only pays for the parts they read. Any other range the learner
 * selects is translated on its own (`translatePhrase`).
 */

/** An expression longer than this is a clause, not something to read as one word. */
const MAX_EXPRESSION_WORDS = 6;

/** A meaning is one to four words: a few output tokens each, with room for punctuation. */
const TOKENS_PER_GLOSS = 7;
/** GPT-OSS reasons before answering, even at low effort (130–440 tokens measured). */
const REASONING_HEADROOM = 512;
const MIN_GLOSS_TOKENS = 256;

/**
 * Words glossed in one request: about a paragraph of speech. The request is
 * then ~1,500 tokens (prompt and reply), a fifth of Groq's free per-minute
 * allowance, and answers in about two seconds.
 */
const GLOSS_SECTION_WORDS = 90;

/** Sentences either side of a selection sent with it, so it is translated in context. */
const PHRASE_CONTEXT_SENTENCES = 1;

/**
 * The words of a text in the order they are glossed. The transcript view
 * splits text the same way, so gloss `i` belongs to word token `i` on screen.
 *
 * @param text Any target-language text.
 * @returns Its word tokens, without spaces and punctuation.
 */
export function glossWords(text: string): string[] {
	return tokenizeWords(text)
		.filter((token) => token.word)
		.map((token) => token.text);
}

/** The word tokens of a text, numbered as `glossWords` numbers them. */
function wordTokens(text: string): TextToken[] {
	return tokenizeWords(text).filter((token) => token.word);
}

/** For each sentence of a text, the range of word indexes inside it; sentences without words are left out. */
function sentenceWordRanges(text: string, words: TextToken[]): GlossedRange[] {
	const ranges: GlossedRange[] = [];
	let wordIndex = 0;

	for (const sentence of sentenceSpans(text)) {
		const start = wordIndex;
		while (wordIndex < words.length && words[wordIndex].start < sentence.end) wordIndex++;
		if (wordIndex > start) ranges.push({ start, end: wordIndex - 1 });
	}

	// Words after the last sentence end (none in practice) close the text.
	if (wordIndex < words.length) ranges.push({ start: wordIndex, end: words.length - 1 });
	return ranges;
}

/**
 * How a text's words are glossed: consecutive sections of whole sentences,
 * each up to about `GLOSS_SECTION_WORDS` words. A sentence longer than twice
 * that (speech recognised without punctuation) is cut into windows of that
 * size. The sections depend only on the text, so they line up across
 * requests and with what was saved.
 *
 * @param text Any target-language text.
 * @returns Word index ranges (`glossWords` indexes, inclusive), in order, covering every word.
 */
export function glossSections(text: string): GlossedRange[] {
	const sections: GlossedRange[] = [];
	let open: GlossedRange | null = null;

	for (const sentence of sentenceWordRanges(text, wordTokens(text))) {
		const sentenceWords = sentence.end - sentence.start + 1;

		if (sentenceWords > GLOSS_SECTION_WORDS * 2) {
			if (open) sections.push(open);
			open = null;
			for (let start = sentence.start; start <= sentence.end; start += GLOSS_SECTION_WORDS) {
				sections.push({ start, end: Math.min(sentence.end, start + GLOSS_SECTION_WORDS - 1) });
			}
			continue;
		}

		if (open && sentence.end - open.start + 1 <= GLOSS_SECTION_WORDS) {
			open.end = sentence.end;
			continue;
		}
		if (open) sections.push(open);
		open = { ...sentence };
	}

	if (open) sections.push(open);
	return sections;
}

/** The section `wordIndex` belongs to. */
export function glossSectionOf(text: string, wordIndex: number): GlossedRange | null {
	return glossSections(text).find((section) => section.start <= wordIndex && wordIndex <= section.end) ?? null;
}

/**
 * True once the meaning of the word at `wordIndex` has been fetched (it may
 * still be blank: the model gave none). Meanings saved whole, before
 * sections, cover every word.
 */
export function hasMeaningAt(glosses: TextGlosses | null, wordIndex: number): boolean {
	if (!glosses) return false;
	if (!glosses.sections) return glosses.words.length > 0;
	return glosses.sections.some((section) => section.start <= wordIndex && wordIndex <= section.end);
}

/**
 * The sentences around words `start`..`end`, as context for translating
 * them: their own sentence(s) and `PHRASE_CONTEXT_SENTENCES` either side.
 *
 * @param text The whole text.
 * @param start First word index (`glossWords`).
 * @param end Last word index, inclusive.
 */
export function phraseContext(text: string, start: number, end: number): string {
	const words = wordTokens(text);
	const sentences: TextSpan[] = sentenceSpans(text);
	const first = words[start];
	const last = words[end];
	if (!first || !last || sentences.length === 0) return text.trim();

	const firstSentence = Math.max(0, sentences.findIndex((sentence) => sentence.end > first.start));
	const lastSentence = sentences.findIndex((sentence) => sentence.end >= last.end);
	const from = Math.max(0, firstSentence - PHRASE_CONTEXT_SENTENCES);
	const to = Math.min(sentences.length - 1, (lastSentence < 0 ? sentences.length - 1 : lastSentence) + PHRASE_CONTEXT_SENTENCES);

	return text.slice(sentences[from].start, sentences[to].end);
}

function glossMessages(sectionText: string, words: string[], language: TranslationLanguage): ChatMessage[] {
	const { language: source, translationTarget: target } = language;

	const system = `You give ${source}-to-${target} word meanings for a language learner who hovers over words.
For every numbered word, give its meaning in ${target} as it is used in that sentence:
- 1 to 4 words, lowercase unless ${target} capitalises it (a name; in English, "I"); the inflected sense ("allé" → "went", "j'ai" → "I have"); no explanations.
- A name stays as it is. A misspoken or non-existent word gets its most likely intended meaning in brackets with a question mark, e.g. "[late?]".
Also list the expressions: runs of 2 to ${MAX_EXPRESSION_WORDS} consecutive words that must be read together because translating them word by word gives a wrong or misleading meaning, such as compound nouns ("pomme de terre" → "potato"), fixed expressions ("tout à fait" → "absolutely", "il y a" → "there is", "en retard" → "late", "tout à coup" → "suddenly") and verb phrases ("avoir besoin de" → "to need").
If the word-by-word meanings already read correctly together, it is NOT an expression: ordinary phrases such as "avec ma sœur", "nous avons acheté", "dans un petit café", "c'était très bon" or "au marché" are not, and neither is any verb in a compound tense (an auxiliary plus a past participle, such as "j'ai préféré" or "nous sommes allés"). Most sentences have none or one. Give each expression as its first and last word number and its meaning in context, translating all of its words, subject included ("il y a" → "there is", never just "is").
Return only JSON: { "glosses": [string, ...], "expressions": [ { "from": number, "to": number, "meaning": string } ] }, with exactly one gloss per numbered word, in the same order.`;

	const numberedWords = words.map((word, wordIndex) => `${wordIndex + 1}. ${word}`);
	const user = [`Text: """${sectionText.trim()}"""`, 'Words:', ...numberedWords].join('\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

/** One gloss per word: a short list is padded with blanks, a long one cut, so indexes always line up. */
function alignedGlosses(raw: unknown, wordCount: number): string[] {
	const glosses = Array.isArray(raw) ? raw.map((gloss) => (typeof gloss === 'string' ? gloss.trim() : '')) : [];
	return Array.from({ length: wordCount }, (_, index) => glosses[index] ?? '');
}

/**
 * The model's expressions, checked: 1-based word numbers become 0-based
 * indexes, a range must hold 2 to `MAX_EXPRESSION_WORDS` words of this text,
 * and an expression overlapping an earlier one is dropped, so hovering a word
 * always points to one expression at most.
 */
function validExpressions(raw: unknown, wordCount: number): PhraseGloss[] {
	if (!Array.isArray(raw)) return [];

	const expressions: PhraseGloss[] = [];
	for (const entry of raw) {
		const fields = (entry ?? {}) as Record<string, unknown>;
		const start = Number(fields.from) - 1;
		const end = Number(fields.to) - 1;
		const meaning = typeof fields.meaning === 'string' ? fields.meaning.trim() : '';

		const length = end - start + 1;
		const inText = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end < wordCount;
		const overlaps = expressions.some((other) => start <= other.end && end >= other.start);
		if (!meaning || !inText || length < 2 || length > MAX_EXPRESSION_WORDS || overlaps) continue;

		expressions.push({ start, end, meaning, origin: 'expression' });
	}

	return expressions;
}

/** One section's meanings: a meaning per word of the section, and its expressions, by index in the whole text. */
export interface SectionGlosses {
	section: GlossedRange;
	words: string[];
	phrases: PhraseGloss[];
}

/**
 * Glosses the words of one section of a text (see `glossSections`) with the
 * configured LLM, and finds the expressions to read as one.
 *
 * @param text The whole target-language text, e.g. an attempt's transcript.
 * @param section Which of its sections.
 * @param endpoint The learner's LLM.
 * @param language Source and target language names.
 * @param signal Cancels the request.
 * @returns One meaning per word of the section (blank where the model gave
 *   none) and its expressions, indexed in the whole text.
 * @throws With a readable message when the model fails or returns no glosses at all.
 */
export async function generateSectionGlosses(
	text: string,
	section: GlossedRange,
	endpoint: LlmEndpoint,
	language: TranslationLanguage,
	signal?: AbortSignal
): Promise<SectionGlosses> {
	const tokens = wordTokens(text).slice(section.start, section.end + 1);
	if (tokens.length === 0) return { section, words: [], phrases: [] };

	const sectionText = text.slice(tokens[0].start, tokens.at(-1)!.end);
	const words = tokens.map((token) => token.text);
	const maxTokens = Math.max(MIN_GLOSS_TOKENS, words.length * TOKENS_PER_GLOSS + REASONING_HEADROOM);
	const raw = await chatCompletion(endpoint, glossMessages(sectionText, words, language), {
		json: true,
		temperature: 0.1,
		maxTokens,
		signal
	});

	const parsed = extractJson(raw) as { glosses?: unknown; expressions?: unknown } | null;
	const glosses = alignedGlosses(parsed?.glosses, words.length);
	if (glosses.every((gloss) => !gloss)) throw new Error('The model returned no word meanings. Please try again.');

	const phrases = validExpressions(parsed?.expressions, words.length).map((phrase) => ({
		...phrase,
		start: phrase.start + section.start,
		end: phrase.end + section.start
	}));
	return { section, words: glosses, phrases };
}

/** A phrase's meaning is a few words; the rest is room for GPT-OSS's reasoning. */
const MAX_PHRASE_TOKENS = 640;

/**
 * Translates a range of words the learner selected, as it is used in its text.
 *
 * @param phrase The selected words, exactly as they appear in the text.
 * @param text The text around it, for context (see `phraseContext`).
 * @param endpoint The learner's LLM.
 * @param language Source and target language names.
 * @returns The meaning, a few words in the target language.
 * @throws With a readable message when the model fails or returns nothing.
 */
export async function translatePhrase(
	phrase: string,
	text: string,
	endpoint: LlmEndpoint,
	language: TranslationLanguage
): Promise<string> {
	const { language: source, translationTarget: target } = language;
	const system = `You translate ${source} phrases into ${target} for a language learner who selected them in a text.
Give the meaning of the phrase as it is used in that text: natural ${target}, as short as the phrase allows, no explanations. A misspoken phrase gets its most likely intended meaning in brackets with a question mark.
Return only JSON: { "meaning": string }`;
	const user = [`Text: "${text.trim()}"`, `Phrase: "${phrase.trim()}"`].join('\n');

	const raw = await chatCompletion(
		endpoint,
		[
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		],
		{ json: true, temperature: 0.1, maxTokens: MAX_PHRASE_TOKENS }
	);
	const parsed = extractJson(raw) as { meaning?: unknown } | null;
	const meaning = typeof parsed?.meaning === 'string' ? parsed.meaning.trim() : '';

	if (!meaning) throw new Error('The model returned no meaning for that phrase. Please try again.');
	return meaning;
}
