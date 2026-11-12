// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Writes one speaking prompt in the learner's language of instruction.
 *
 * Prompts used to be English sentences translated at session start, which made
 * English the source every language depended on. This adapter writes the
 * prompt directly in the instruction language; the catalogue in
 * `practice/promptCatalogue.ts` and its English entries are only the fallback
 * when there is no model to call.
 */
import { countWords } from '#lib/config.js';
import { couldBeWrittenIn } from '#lib/languages/textLanguage.js';
import type { RunMode } from '#lib/adapters/db/index.js';
import { chatCompletion } from './client';
import { extractJson } from './evaluate';
import type { LlmEndpoint } from './types';

/**
 * A prompt short enough to read in the practice bar's two lines: a task of 5–6
 * words, never a paragraph. The word cap is enforced after generation; the
 * character cap catches one runaway token in a language with long words.
 */
const MAX_TITLE_CHARS = 50;
const MAX_PROMPT_WORDS = 6;
const MAX_TEXT_CHARS = 140;
/** The model's answer is two short strings; this is ample, and caps a runaway reply. */
const PROMPT_TOPIC_TOKENS = 300;
/** Recency of the topics named in the request, so the model does not repeat them. */
const MAX_AVOIDED_TOPICS = 12;

export interface PromptTopicRequest {
	/** The learner's configured LLM. */
	endpoint: LlmEndpoint;
	/** The language the prompt must be written in, e.g. `Spanish`. */
	instructionLanguage: string;
	/** Its ISO 639-1 code, used to check the model answered in that language. */
	instructionLanguageId: string;
	/** The language being studied, e.g. `French`. */
	targetLanguage: string;
	/** The learner's level, e.g. `B1`. */
	level: string;
	/** The session's tone. */
	mode: RunMode;
	/** Titles of prompts already offered, so the model does not repeat them. */
	avoidTopics?: string[];
	signal?: AbortSignal;
}

export interface GeneratedPrompt {
	title: string;
	text: string;
}

const MODE_GUIDANCE: Record<RunMode, string> = {
	casual: 'a relaxed, everyday conversation topic',
	exam: 'a structured topic of the kind an oral exam asks for',
	freeflow: 'an open, personal topic'
};

/**
 * Generates one practice prompt in the learner's language of instruction.
 *
 * @param request The languages, level, mode and topics to avoid.
 * @returns A validated, non-repeating `{ title, text }`.
 * @throws With a readable message when the model fails, answers in another
 *   language, or repeats a recent topic; the caller falls back to the
 *   catalogue.
 */
export async function generatePromptTopic(request: PromptTopicRequest): Promise<GeneratedPrompt> {
	const avoidTopics = (request.avoidTopics ?? []).slice(0, MAX_AVOIDED_TOPICS);
	const avoidLine =
		avoidTopics.length > 0
			? `Do not repeat any of these recent topics: ${avoidTopics.map((topic) => `"${topic}"`).join(', ')}.`
			: '';

	const system = [
		`You write one speaking-practice prompt for a learner studying ${request.targetLanguage} at level ${request.level}.`,
		`Write both the title and the task in ${request.instructionLanguage}, never in ${request.targetLanguage}.`,
		`Make it ${MODE_GUIDANCE[request.mode]}.`,
		'The task is 5 or 6 words, never more than 6, telling the learner what to talk about. Do not answer it, offer vocabulary, or write dialogue; never write a paragraph.',
		avoidLine,
		'Return only JSON: { "title": string, "text": string }'
	]
		.filter((line) => line !== '')
		.join('\n');

	const raw = await chatCompletion(
		request.endpoint,
		[
			{ role: 'system', content: system },
			{ role: 'user', content: `Write the next prompt in ${request.instructionLanguage}.` }
		],
		{
			json: true,
			temperature: 0.9,
			maxTokens: PROMPT_TOPIC_TOKENS,
			signal: request.signal
		}
	);

	const generated = parsePromptTopic(raw);
	validatePromptTopic(generated, request, avoidTopics);
	return generated;
}

function parsePromptTopic(raw: string): GeneratedPrompt {
	const parsed = extractJson(raw) as { title?: unknown; text?: unknown } | null;
	const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
	const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';

	if (!title || !text) {
		throw new Error('The model returned no prompt. Please try again.');
	}
	if (title.length > MAX_TITLE_CHARS) {
		throw new Error('The model’s prompt title was too long. Please try again.');
	}
	if (text.length > MAX_TEXT_CHARS) {
		throw new Error('The model’s prompt was too long. Please try again.');
	}
	if (countWords(text) > MAX_PROMPT_WORDS) {
		throw new Error(`The model’s prompt was longer than ${MAX_PROMPT_WORDS} words. Please try again.`);
	}
	return { title, text };
}

function validatePromptTopic(
	generated: GeneratedPrompt,
	request: PromptTopicRequest,
	avoidTopics: string[]
): void {
	// Letters, not vocabulary: this catches a model that answers in a script
	// the instruction language does not use. Same-script mix-ups cannot be
	// told apart this way.
	const isInstructionLanguage =
		couldBeWrittenIn(generated.title, request.instructionLanguageId) &&
		couldBeWrittenIn(generated.text, request.instructionLanguageId);
	if (!isInstructionLanguage) {
		throw new Error(`The model did not write the prompt in ${request.instructionLanguage}. Please try again.`);
	}

	const repeatsATopic = avoidTopics.some(
		(topic) => normalizeTopic(topic) === normalizeTopic(generated.title)
	);
	if (repeatsATopic) {
		throw new Error('The model repeated a recent prompt. Please try again.');
	}
}

/** A topic title without case or punctuation, so two spellings of one title still match. */
function normalizeTopic(topic: string): string {
	return topic.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
