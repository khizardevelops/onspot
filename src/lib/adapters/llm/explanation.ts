// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The spoken explanation's markup, and its follow-up question.
 *
 * The LLM does not write the explanation as prose. It returns its mistakes as
 * data (`said`, `say`, `why`) plus a short note, and `composeExplanation`
 * writes the sentences after checking them: a "fix" that says the same words,
 * a repeated mistake or an empty replacement cannot be caught in free text,
 * but is easy to drop from data. The result is markup in the language of
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
import { overlappingWords, sameWords } from '#lib/utils/words.js';

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
 * Writes parts back as canonical markup: only known, balanced tags remain.
 *
 * @param parts Parts from `parseExplanation`.
 * @returns Markup that `parseExplanation` reads back into the same parts.
 */
export function formatExplanation(parts: ExplanationPart[]): string {
	return parts
		.map((part) => (part.highlight ? `<${part.highlight}>${part.text}</${part.highlight}>` : part.text))
		.join('');
}

/**
 * Validates an LLM explanation at the boundary: strips stray markup and
 * collapses whitespace, so what is stored is always well-formed.
 *
 * @param raw The `explanation` string the model returned.
 * @returns Canonical markup, or '' when nothing readable remains.
 */
export function normalizeExplanation(raw: string): string {
	const collapsed = raw.replace(/\s+/g, ' ').trim();
	return formatExplanation(parseExplanation(collapsed)).trim();
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
 * Validates the LLM's follow-up at the boundary: plain text only, no tags.
 *
 * @param raw The `followUp` value the model returned.
 * @returns The follow-up, or null when there is no question.
 */
export function normalizeFollowUp(raw: unknown): FollowUp | null {
	if (!raw || typeof raw !== 'object') return null;

	const fields = raw as Record<string, unknown>;
	const question = typeof fields.question === 'string' ? speakableExplanation(fields.question) : '';
	const translation = typeof fields.translation === 'string' ? speakableExplanation(fields.translation) : '';

	return question ? { question, translation } : null;
}

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

// ------------------------------------------------------------ Composing from the model's data

/** The explanation names only the most important mistakes; the Feedback panel lists all of them. */
export const EXPLANATION_MAX_MISTAKES = 3;

/**
 * A spoken line longer than this is no longer "compact": the model wandered,
 * so the plain fallback sentence is used instead. The prompt asks for 25.
 */
const MAX_LINE_WORDS = 40;

/**
 * Fallback wording, used only when the model's own line for a mistake is
 * missing or fails the checks. Written in the language of instruction (English
 * for every language today), as a teacher would say it.
 */
const FALLBACK = {
	replace: (said: string, say: string) => `You said <wrong>${said}</wrong>; say <right>${say}</right> instead.`,
	leaveOut: (said: string) => `You can leave out <wrong>${said}</wrong>.`,
	allCorrect: 'Nice, that was all correct.'
} as const;

/** One mistake as the model reports it, after validation. */
export interface ExplanationMistake {
	/** The learner's words, as transcribed. */
	said: string;
	/** What to say instead; empty when the words should simply go. */
	say: string;
	/**
	 * The teacher's spoken sentence about it, in the language of instruction,
	 * with highlight tags; the fallback wording when the model's line failed.
	 */
	line: string;
}

const SENTENCE_END = /[.!?…]$/;

function asText(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Plain text: every tag and markdown mark removed. */
function plainText(value: unknown): string {
	return speakableExplanation(asText(value));
}

/** Text that may keep `<key>` highlights, the only tag that makes sense in a note. */
function textWithKeywords(value: unknown): string {
	const parts = parseExplanation(asText(value).replace(/\s+/g, ' ').trim()).map((part) =>
		part.highlight === 'key' ? part : { ...part, highlight: null }
	);
	return formatExplanation(parts).trim();
}

function asSentence(text: string): string {
	return SENTENCE_END.test(text) ? text : `${text}.`;
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Highlights a phrase the model quoted without its tag, so every line shows
 * the mistake and the fix the same way. Only plain text is searched, and only
 * when no part already carries that highlight.
 */
function highlightPhrase(parts: ExplanationPart[], phrase: string, highlight: ExplanationHighlight): ExplanationPart[] {
	if (!phrase || parts.some((part) => part.highlight === highlight)) return parts;

	const wanted = phrase.toLocaleLowerCase();
	for (const [position, part] of parts.entries()) {
		if (part.highlight) continue;

		const at = part.text.toLocaleLowerCase().indexOf(wanted);
		if (at === -1) continue;

		const before = { text: part.text.slice(0, at), highlight: null };
		const quoted = { text: part.text.slice(at, at + phrase.length), highlight };
		const after = { text: part.text.slice(at + phrase.length), highlight: null };
		const replacement = [before, quoted, after].filter((piece) => piece.text);
		return [...parts.slice(0, position), ...replacement, ...parts.slice(position + 1)];
	}

	return parts;
}

/**
 * The model's spoken line for a mistake, if it can be trusted: it must name
 * the fix (when there is one) and stay compact. Otherwise the fallback wording.
 */
function spokenLine(said: string, say: string, rawLine: unknown): string {
	const fallback = say ? FALLBACK.replace(said, say) : FALLBACK.leaveOut(said);

	const markup = normalizeExplanation(asText(rawLine));
	const lineText = speakableExplanation(markup);
	const namesTheFix = say === '' || overlappingWords(say, lineText);
	if (!lineText || !namesTheFix || wordCount(lineText) > MAX_LINE_WORDS) return fallback;

	const withMistake = highlightPhrase(parseExplanation(markup), said, 'wrong');
	const withFix = highlightPhrase(withMistake, say, 'right');
	return asSentence(formatExplanation(withFix).trim());
}

/**
 * Validates the model's mistakes: each needs the learner's words and a fix
 * that actually changes them; a mistake already named (the same words, or
 * words inside them) is not named again; at most `EXPLANATION_MAX_MISTAKES`
 * are kept, in the model's order. Each keeps the model's own spoken line when
 * that line passes its checks.
 *
 * @param raw The model's `explanation.mistakes` value.
 * @returns The mistakes worth saying.
 */
export function validMistakes(raw: unknown): ExplanationMistake[] {
	if (!Array.isArray(raw)) return [];

	const mistakes: ExplanationMistake[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;

		const fields = entry as Record<string, unknown>;
		const said = plainText(fields.said);
		const say = plainText(fields.say);

		const changesSomething = say === '' || !sameWords(said, say);
		// "en tarp" after "détruit en tarp" is the same mistake named again.
		const alreadyNamed = mistakes.some((named) => overlappingWords(named.said, said));
		if (!said || !changesSomething || alreadyNamed) continue;

		mistakes.push({ said, say, line: spokenLine(said, say, fields.line) });
	}

	return mistakes.slice(0, EXPLANATION_MAX_MISTAKES);
}

/**
 * Writes the spoken explanation from the model's structured reply: its short
 * opening note, then one spoken line per validated mistake.
 *
 * @param raw The model's `explanation` value: `{ note, mistakes }`. A plain
 *   string (a model that ignored the schema) is accepted as prose markup.
 * @returns Canonical explanation markup.
 */
export function composeExplanation(raw: unknown): string {
	if (typeof raw === 'string') return normalizeExplanation(raw);
	if (!raw || typeof raw !== 'object') return '';

	const fields = raw as Record<string, unknown>;
	const sentences: string[] = [];

	const note = textWithKeywords(fields.note);
	if (note) sentences.push(asSentence(note));
	sentences.push(...validMistakes(fields.mistakes).map((mistake) => mistake.line));
	if (sentences.length === 0) sentences.push(FALLBACK.allCorrect);

	return normalizeExplanation(sentences.join(' '));
}
