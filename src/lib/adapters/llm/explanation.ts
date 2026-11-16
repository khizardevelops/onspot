// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading the spoken explanation's markup, for the screen and for speech.
 *
 * The LLM does not write the explanation as prose. It returns its mistakes as
 * data (`said`, `say`, `why`) plus a short note, and the core
 * (`llm-openai::explanation`) writes the sentences after checking them: a
 * "fix" that says the same words, a repeated mistake or an empty replacement
 * cannot be caught in free text, but is easy to drop from data. The result is
 * markup in the language of
 * instruction, with every target-language quote in one of three tags. The
 * tags carry the learner highlights on screen and mark which words are in the
 * target language, so a future local voice can hand those spans to the
 * target-language voice.
 *
 *   <wrong>…</wrong>  what the learner said wrongly, quoted as they said it
 *   <right>…</right>  the correct form to say instead
 *   <key>…</key>      another target-language word or phrase worth remembering
 *
 * The follow-up question is a separate field with its own translation
 * (`FollowUp`). Takes saved before that carried it inline as `<ask>…</ask>`,
 * so the parser still knows the tag and `separateFollowUp` lifts it out.
 */

import type { FollowUp } from '../db/types';

export const EXPLANATION_HIGHLIGHTS = ['wrong', 'right', 'key', 'ask'] as const;

export type ExplanationHighlight = (typeof EXPLANATION_HIGHLIGHTS)[number];

/** One run of explanation text: plain instruction-language text, or one highlight. */
export interface ExplanationPart {
	text: string;
	highlight: ExplanationHighlight | null;
}

/** A known tag with its content. Tags are never nested, so the shortest match is the right one. */
const HIGHLIGHT_TAG = /<(wrong|right|key|ask)>([\s\S]*?)<\/\1>/g;

/** Any other tag-like markup (unknown, unclosed or nested tags), which is dropped. */
const STRAY_TAG = /<\/?[a-z]+>/gi;

/** Markdown emphasis the model sometimes adds despite the rules; it would be read aloud. */
const MARKDOWN_EMPHASIS = /\*\*|__/g;

function cleanText(text: string): string {
	return text.replace(STRAY_TAG, '').replace(MARKDOWN_EMPHASIS, '');
}

/**
 * Splits explanation markup into plain and highlighted parts.
 *
 * Tolerant by design, because the markup comes from an LLM: unknown, unclosed
 * or nested tags are removed and their text kept as plain text, so a malformed
 * reply still reads correctly instead of showing raw angle brackets.
 *
 * @param markup Explanation text with optional highlight tags.
 * @returns The parts in reading order; empty parts are omitted.
 */
export function parseExplanation(markup: string): ExplanationPart[] {
	const parts: ExplanationPart[] = [];
	let readFrom = 0;

	const pushPart = (rawText: string, highlight: ExplanationHighlight | null): void => {
		const text = cleanText(rawText);
		if (text) parts.push({ text, highlight });
	};

	for (const match of markup.matchAll(HIGHLIGHT_TAG)) {
		const tagStart = match.index ?? 0;
		const highlight = match[1] as ExplanationHighlight;
		const content = match[2];

		pushPart(markup.slice(readFrom, tagStart), null);
		pushPart(content, highlight);
		readFrom = tagStart + match[0].length;
	}

	pushPart(markup.slice(readFrom), null);
	return parts;
}



/**
 * The explanation as text-to-speech should read it: the same words, no tags.
 *
 * @param markup Explanation text with optional highlight tags.
 * @returns Plain text, with whitespace collapsed.
 */
export function speakableExplanation(markup: string): string {
	const spokenText = parseExplanation(markup)
		.map((part) => part.text)
		.join('');

	return spokenText.replace(/\s+/g, ' ').trim();
}

export type { FollowUp };


/**
 * Splits an explanation into its own parts and the follow-up question that
 * older takes carried inside it as `<ask>`.
 *
 * @param markup Explanation markup.
 * @returns The explanation without `<ask>` parts, and the first asked question, if any.
 */
export function separateFollowUp(markup: string): { parts: ExplanationPart[]; askedQuestion: string | null } {
	const allParts = parseExplanation(markup);
	const askedQuestion = allParts.find((part) => part.highlight === 'ask')?.text.trim() || null;
	const parts = allParts.filter((part) => part.highlight !== 'ask');

	return { parts, askedQuestion };
}
