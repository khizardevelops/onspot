// SPDX-License-Identifier: AGPL-3.0-or-later

import { chatCompletion } from './client';
import { extractJson } from './evaluate';
import type { TranslationLanguage } from './translationPrompt';
import type { ChatMessage, LlmEndpoint } from './types';
import type { PhraseGloss, TextGlosses } from '../db/types';
import { tokenizeWords } from '#lib/utils/words.js';

/**
 * Hover translations: the meaning of each word of a text, in the sense it has
 * in that sentence ("allé" → "went", not the dictionary "gone"), plus the
 * multi-word expressions that only make sense together ("pomme de terre" →
 * "potato"). A dictionary cannot do this, and text may only leave the device
 * through the learner's own LLM, so the configured model glosses every word of
 * an attempt's texts in one call, the first time the learner hovers one. Any
 * other range the learner selects is translated on its own (`translatePhrase`).
 */

/** An expression longer than this is a clause, not something to read as one word. */
const MAX_EXPRESSION_WORDS = 6;

/** A meaning is one to four words: a few output tokens each, with room for punctuation. */
const TOKENS_PER_GLOSS = 7;
/** GPT-OSS reasons before answering, even at low effort (130–440 tokens measured). */
const REASONING_HEADROOM = 512;
const MIN_GLOSS_TOKENS = 256;
/** Two 240-word texts fit; Groq reserves prompt + this against its per-minute limit. */
const MAX_GLOSS_TOKENS = 4096;

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

function glossMessages(texts: string[], language: TranslationLanguage): ChatMessage[] {
	const { language: source, translationTarget: target } = language;

	const system = `You give ${source}-to-${target} word meanings for a language learner who hovers over words.
For every numbered word, give its meaning in ${target} as it is used in that sentence:
- 1 to 4 words, lowercase unless it is a name; the inflected sense ("allé" → "went", "j'ai" → "I have"); no explanations.
- A name stays as it is. A misspoken or non-existent word gets its most likely intended meaning in brackets with a question mark, e.g. "[late?]".
Also list the expressions: runs of 2 to ${MAX_EXPRESSION_WORDS} consecutive words that must be read together because translating them word by word gives a wrong or misleading meaning, such as compound nouns ("pomme de terre" → "potato"), fixed expressions ("tout à fait" → "absolutely", "il y a" → "there is", "en retard" → "late", "tout à coup" → "suddenly") and verb phrases ("avoir besoin de" → "to need").
If the word-by-word meanings already read correctly together, it is NOT an expression: ordinary phrases such as "avec ma sœur", "nous avons acheté", "dans un petit café", "c'était très bon" or "au marché" are not. Most sentences have none or one. Give each expression as its first and last word number and its meaning in context.
Return only JSON: { "texts": [ { "glosses": [string, ...], "expressions": [ { "from": number, "to": number, "meaning": string } ] } ] }, one entry per text, with exactly one gloss per numbered word, in the same order.`;

	const user = texts
		.map((text, textIndex) => {
			const numberedWords = glossWords(text).map((word, wordIndex) => `${wordIndex + 1}. ${word}`);
			return [`Text ${textIndex + 1}: """${text.trim()}"""`, 'Words:', ...numberedWords].join('\n');
		})
		.join('\n\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

/**
 * True once a text's word meanings have been fetched. A text can hold
 * translated selections before that, which do not count.
 */
export function hasWordMeanings(glosses: TextGlosses | null): boolean {
	return (glosses?.words.length ?? 0) > 0;
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

/**
 * Glosses every word of the given texts with the configured LLM, and finds the
 * expressions to read as one.
 *
 * @param texts Target-language texts, e.g. an attempt's transcript and correct version.
 * @param endpoint The learner's LLM.
 * @param language Source and target language names.
 * @param signal Cancels the request.
 * @returns For each text, one meaning per word (see `glossWords`; blank where the
 *   model gave none) and its expressions.
 * @throws With a readable message when the model fails or returns no glosses at all.
 */
export async function generateWordGlosses(
	texts: string[],
	endpoint: LlmEndpoint,
	language: TranslationLanguage,
	signal?: AbortSignal
): Promise<TextGlosses[]> {
	const wordCounts = texts.map((text) => glossWords(text).length);
	const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
	if (totalWords === 0) return texts.map(() => ({ words: [], phrases: [] }));

	const budget = totalWords * TOKENS_PER_GLOSS + REASONING_HEADROOM;
	const maxTokens = Math.min(MAX_GLOSS_TOKENS, Math.max(MIN_GLOSS_TOKENS, budget));
	const raw = await chatCompletion(endpoint, glossMessages(texts, language), {
		json: true,
		temperature: 0.1,
		maxTokens,
		signal
	});

	const parsed = extractJson(raw) as { texts?: Array<{ glosses?: unknown; expressions?: unknown }> } | null;
	const entries = Array.isArray(parsed?.texts) ? parsed.texts : [];
	const glosses = wordCounts.map((count, index) => ({
		words: alignedGlosses(entries[index]?.glosses, count),
		phrases: validExpressions(entries[index]?.expressions, count)
	}));

	if (glosses.every((text) => text.words.every((gloss) => !gloss))) {
		throw new Error('The model returned no word meanings. Please try again.');
	}
	return glosses;
}

/** A phrase's meaning is a few words; the rest is room for GPT-OSS's reasoning. */
const MAX_PHRASE_TOKENS = 640;

/**
 * Translates a range of words the learner selected, as it is used in its text.
 *
 * @param phrase The selected words, exactly as they appear in the text.
 * @param text The whole text, for context.
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
