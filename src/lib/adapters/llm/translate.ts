// SPDX-License-Identifier: AGPL-3.0-or-later

import { TRANSLATION_SET_VERSION, type TranslationBreakdownItem, type TranslationSet } from '../db/types';
import { chatCompletion } from './client';
import { extractJson } from './evaluate';
import {
	DETAILED_TRANSLATION_SCHEMA,
	translationRules,
	type TranslationLanguage
} from './translationPrompt';
import type { ChatMessage, LlmEndpoint } from './types';
import { sentenceChunks } from '#lib/utils/textChunks.js';
import { tokenizeWords } from '#lib/utils/words.js';

/**
 * Words translated in one request. Every word comes back four or five times
 * (idiomatic, its variants, literal, word for word) plus its breakdown entry,
 * so a longer text is translated in parts of whole sentences: each reply then
 * fits its budget, and each request a fraction of Groq's free per-minute
 * allowance.
 */
const TRANSLATION_PART_WORDS = 60;

/**
 * Reply tokens per source word across all the views, with room to spare:
 * a 60-word part's answer took ~950 (2026-11-01, GPT-OSS 120B). A reply cut
 * off by its budget is invalid JSON and fails.
 */
const REPLY_TOKENS_PER_WORD = 20;
/** GPT-OSS reasons before answering, even at low effort: 130–700 tokens measured (477 on that part). */
const REASONING_HEADROOM = 900;
const MIN_TRANSLATION_TOKENS = 1024;
const MAX_TRANSLATION_TOKENS = 3072;

function translationMessages(
	text: string,
	translation: TranslationLanguage
): ChatMessage[] {
	return [
		{
			role: 'system',
			content: `You are an expert ${translation.language}-to-${translation.translationTarget} translation engine. Translate the source into distinct study views.

Return only a JSON object with this exact structure:
{
  "translations": ${DETAILED_TRANSLATION_SCHEMA}
}

${translationRules(translation)}

For "wordBreakdown", map the source's primary tokens or morphemes in order to their isolated ${translation.translationTarget} equivalents. Split contractions when useful. Keep each item brief. Leave punctuation out: no entries for commas, full stops or other marks.`
		},
		{
			role: 'user',
			content: [
				`${translation.language} text:`,
				'"""',
				text.trim(),
				'"""'
			].join('\n')
		}
	];
}

function stringField(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown, exclude = ''): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(stringField).filter((item) => item && item !== exclude))].slice(0, 2);
}

function breakdown(value: unknown): TranslationBreakdownItem[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => {
			const entry = item as Record<string, unknown>;
			return { source: stringField(entry?.source), target: stringField(entry?.target) };
		})
		.filter((item) => item.source && item.target);
}

/** Translates one part of a text: all the views, as the model returned them. */
async function translatePart(
	text: string,
	endpoint: LlmEndpoint,
	translation: TranslationLanguage,
	signal?: AbortSignal
): Promise<Omit<TranslationSet, 'version'>> {
	const words = tokenizeWords(text).filter((token) => token.word).length;
	const maxTokens = Math.min(MAX_TRANSLATION_TOKENS, Math.max(MIN_TRANSLATION_TOKENS, words * REPLY_TOKENS_PER_WORD + REASONING_HEADROOM));
	const raw = await chatCompletion(endpoint, translationMessages(text, translation), {
		json: true,
		temperature: 0.1,
		maxTokens,
		signal
	});
	const parsed = extractJson(raw);
	if (!parsed || typeof parsed !== 'object') throw new Error('The model returned no translations.');
	const root = parsed as Record<string, unknown>;
	const source =
		root.translations && typeof root.translations === 'object'
			? (root.translations as Record<string, unknown>)
			: root;
	const idiomatic = stringField(source.idiomatic);
	const part = {
		idiomatic,
		idiomaticVariants: stringArray(source.idiomaticVariants, idiomatic),
		literal: stringField(source.literal),
		wordForWord: stringField(source.wordForWord),
		wordBreakdown: breakdown(source.wordBreakdown)
	};
	if (!part.idiomatic || !part.literal || !part.wordForWord) {
		throw new Error('The model did not return all three translation variants. Please try again.');
	}
	return part;
}

/**
 * Joins the parts of a long text's translation in order. A variant of the
 * whole is each part's variant at that position (a part without one keeps
 * its idiomatic rendering there).
 */
function joinParts(parts: Omit<TranslationSet, 'version'>[]): Omit<TranslationSet, 'version'> {
	const join = (pick: (part: Omit<TranslationSet, 'version'>) => string) => parts.map(pick).join(' ');
	const variantCount = Math.max(0, ...parts.map((part) => part.idiomaticVariants.length));

	return {
		idiomatic: join((part) => part.idiomatic),
		idiomaticVariants: Array.from({ length: variantCount }, (_, position) =>
			join((part) => part.idiomaticVariants[position] ?? part.idiomatic)
		),
		literal: join((part) => part.literal),
		wordForWord: join((part) => part.wordForWord),
		wordBreakdown: parts.flatMap((part) => part.wordBreakdown)
	};
}

/**
 * Generates the three translation views without re-running attempt feedback.
 * A long text is translated in parts of whole sentences (`TRANSLATION_PART_WORDS`),
 * sent together; the rate-limit pacing spreads them over time and models.
 *
 * @param text What to translate: the take's correct version ("Did you mean to
 *   say?"), which is the transcript itself when there was nothing to fix.
 */
export async function generateTranslations(
	text: string,
	endpoint: LlmEndpoint,
	translation: TranslationLanguage,
	signal?: AbortSignal
): Promise<TranslationSet> {
	const parts = sentenceChunks(text, TRANSLATION_PART_WORDS).map((span) => text.slice(span.start, span.end));
	const translated = await Promise.all(
		(parts.length > 0 ? parts : [text]).map((part) => translatePart(part, endpoint, translation, signal))
	);
	return { version: TRANSLATION_SET_VERSION, ...joinParts(translated) };
}
