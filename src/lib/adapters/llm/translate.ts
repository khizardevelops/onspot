import type { TranslationBreakdownItem, TranslationSet } from '../db/types';
import { chatCompletion } from './client';
import { extractJson } from './evaluate';
import {
	DETAILED_TRANSLATION_SCHEMA,
	TRANSLATION_RULES
} from './translationPrompt';
import type { ChatMessage, LlmEndpoint } from './types';

const MAX_TRANSLATION_TOKENS = 2048;

function translationMessages(transcript: string): ChatMessage[] {
	return [
		{
			role: 'system',
			content: `You are an expert French-to-English translation engine. Translate the source into distinct study views.

Return only a JSON object with this exact structure:
{
  "translations": ${DETAILED_TRANSLATION_SCHEMA}
}

${TRANSLATION_RULES}

For "wordBreakdown", map the source's primary tokens or morphemes in order to their isolated English equivalents. Split contractions when useful, such as "m'" → "me" and "appelle" → "call". Keep each item brief.`
		},
		{
			role: 'user',
			content: ['French transcript:', '"""', transcript.trim(), '"""'].join('\n')
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

/** Generates the three translation views without re-running attempt feedback. */
export async function generateTranslations(
	transcript: string,
	endpoint: LlmEndpoint,
	signal?: AbortSignal
): Promise<TranslationSet> {
	const raw = await chatCompletion(endpoint, translationMessages(transcript), {
		json: true,
		temperature: 0.1,
		maxTokens: MAX_TRANSLATION_TOKENS,
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
	const translations: TranslationSet = {
		version: 2,
		idiomatic,
		idiomaticVariants: stringArray(source.idiomaticVariants, idiomatic),
		literal: stringField(source.literal),
		wordForWord: stringField(source.wordForWord),
		wordBreakdown: breakdown(source.wordBreakdown)
	};
	if (!translations.idiomatic || !translations.literal || !translations.wordForWord) {
		throw new Error('The model did not return all three translation variants. Please try again.');
	}
	return translations;
}
