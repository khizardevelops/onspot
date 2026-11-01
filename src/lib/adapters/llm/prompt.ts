// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatMessage, EvaluationRequest } from './types';
import { evaluationGuidance, levelNote } from './languageGuidance';
import { EXPLANATION_MAX_MISTAKES } from './explanation';

const CATEGORIES = ['grammar', 'register', 'filler', 'style'] as const;
const SEVERITIES = ['error', 'warning', 'suggestion'] as const;
const EXAM_STATUSES = ['strictly-avoid', 'avoid', 'use-sparingly', 'allowed'] as const;

/** Vocabulary upgrades suggested for one take, at most. */
export const MAX_VOCABULARY_SUGGESTIONS = 3;

/**
 * The spoken explanation is read aloud after every take, so it must stay
 * short: a 15-word opening and three 25-word lines stay under about 35 seconds
 * of speech at a normal pace, and usually there are fewer.
 */
const EXPLANATION_MAX_LINE_WORDS = 25;
const EXPLANATION_MAX_NOTE_WORDS = 15;

function schemaFor(language: string, translationTarget: string): string {
	return `{
  "spokenLanguage": string,       // the language the learner mainly spoke, named in English, e.g. "${language}", "English"
  "correctedText": string,        // "Did you mean to say…?": what the learner was trying to say, in correct, natural ${language}
  "explanation": {                // what the teacher says out loud (see Explanation rules)
    "note": string,
    "mistakes": [ { "said": string, "say": string, "line": string } ]
  },
  "followUp": {                   // the question that keeps them talking (see Explanation rules)
    "question": string,           // in ${language}
    "translation": string         // the same question in ${translationTarget}
  },
  "corrections": [
    {
      "category": "grammar" | "register" | "filler" | "style",
      "severity": "error" | "warning" | "suggestion",
      "label": string,            // specific issue, e.g. "Greeting used for someone else"; never repeat category/severity
      "original": string,         // the exact substring to change
      "replacement": string,      // what it should be; EXACTLY "" when original should simply be removed
      "replacementTranslation": string, // native-language meaning of the replacement
      "explanation": string,      // why, in the learner's native language, aimed at a learner
      "speakText": string,        // OPTIONAL: one corrected sentence to read aloud
      "examStatus": "strictly-avoid" | "avoid" | "use-sparingly" | "allowed",
      "formalAlternatives": string[] // OPTIONAL: formal replacements for a casual connector
    }
  ],
  "vocabulary": [
    { "original": string, "suggestion": string, "why": string }
  ],
  "connectors": [
    { "connector": string, "insteadOf": string, "why": string }
  ]
}`;
}

/** How the spoken explanation and its follow-up are written (the app checks them; see `explanation.ts`). */
function explanationRulesFor(language: string, translationTarget: string): string {
	return `Explanation rules (the top-level "explanation" and "followUp" fields):
- "explanation" is what a friendly, direct ${language} teacher says out loud to the student right after they finish speaking. It is spoken by text-to-speech, so write natural spoken ${translationTarget}: talk to them ("you"), contractions are fine, short and warm. Never sound like a report or a grammar label.
  - Bad: "Incorrect article usage before a proper name."
  - Good: "Just say <right>New York</right>; city names don't take an article."
- Keep it compact: one quick spoken line per mistake and nothing extra.
- "mistakes": at most ${EXPLANATION_MAX_MISTAKES} real mistakes, most important first, each also present in "corrections". [] when there are none.
  - A mistake is something wrong or clearly unnatural that has a better way to say it. "say" must differ from "said". Never list something you would repeat unchanged.
  - Only list a mistake when you are sure what the learner meant. If you would have to guess the fix, it is not a mistake (see the next rule).
  - "said": the learner's words, copied exactly from the transcript (the shortest phrase that shows the mistake).
  - "say": the corrected ${language}; "" only when the words should simply be left out.
  - "line": the teacher's spoken sentence about this mistake, at most ${EXPLANATION_MAX_LINE_WORDS} words: what they said, what to say instead, and the reason in everyday words. It must contain "say" in <right>…</right> and quote "said" in <wrong>…</wrong>.
  - Name each mistake once; never list the same words twice. Skip optional suggestions.
- A phrase that is grammatical but whose meaning is unclear, or that looks like a speech-recognition slip, is NOT a mistake and NOT a correction: never invent what they might have meant. If it matters, say in "note" which words you didn't catch, and let "followUp" ask what they meant.
- "note": an optional short opening the teacher says first, at most ${EXPLANATION_MAX_NOTE_WORDS} words: a quick genuine reaction to what they said or specific praise, or which words were unclear. Never preview or repeat a mistake the lines cover. With no mistakes, it is the whole reply: say it was correct and name one specific thing they did well.
- Wrap every other ${language} word you mention in <key>…</key> (a verb, an auxiliary, a grammar term). No other tags, no markdown, no lists.
- "followUp": always one short question in ${language} that continues their topic, at their level, so they keep speaking in their next take; "translation" is that question in natural ${translationTarget}. Plain text, no tags.
- Examples (for a French learner; write your own words, react to what this student actually said${translationTarget === 'English' ? '' : `; they are in English only to show the form, so write yours in ${translationTarget}`}):
  "explanation": { "note": "You described that trip really vividly.", "mistakes": [
    { "said": "dans Paris", "say": "à Paris", "line": "You said <wrong>dans Paris</wrong>, but with a city we say <right>à Paris</right>." },
    { "said": "j'ai allé", "say": "je suis allé", "line": "And it's <right>je suis allé</right>, not <wrong>j'ai allé</wrong>: <key>aller</key> uses <key>être</key> in the past." } ] },
  "followUp": { "question": "Qu'est-ce que vous avez préféré à Paris ?", "translation": "What did you like best in Paris?" }

  "explanation": { "note": "That was all correct, and <key>du coup</key> sounded really natural.", "mistakes": [] },
  "followUp": { "question": "Vous y retournez cet été ?", "translation": "Are you going back this summer?" }`;
}

function rulesFor(language: string, translationTarget: string): string {
	return `Rules:
- The transcript comes from speech recognition. Ignore obvious transcription artefacts (misheard proper nouns, missing punctuation) unless they change the meaning; do not "correct" the recogniser's mistakes as if they were the learner's.
- Only correct what the learner actually said. Never invent context or content.
- "correctedText" is the sentence the learner was trying to say, said correctly and naturally. Stay faithful to them: keep their meaning, ideas, order and amount of detail; fix every error and warning; do not add, drop or embellish content, and do not apply optional suggestions. If there is nothing to fix, copy the transcript unchanged.
- The learner must answer in ${language}. Set "spokenLanguage" to the language most of the transcript is in. If it is not ${language}, return an empty "corrections" array and no explanation mistakes, give the ${language} version of what they meant as "correctedText", and use "explanation.note" to tell them they answered in the wrong language.
- A word or phrase from another language inside ${language} speech is a mistake: correct it to ${language} with category "grammar", severity "error" (unless it is a proper noun or a loanword ${language} speakers really use).
- grammar → severity "error". register and filler issues → "warning". optional polish → "suggestion".
- For register/filler corrections, set "examStatus" and give "formalAlternatives" where a formal connector exists.
- Connectors: prefer connectors that are appropriate for spoken ${language} and, in exam mode, formal. Do not suggest written-only connectors the learner cannot say.
- Vocabulary: suggest at most ${MAX_VOCABULARY_SUGGESTIONS} upgrades that a fluent speaker would plausibly use. If there is nothing worth changing, return [].
- Corrections must use "original" exactly as it appears in the transcript.
- If a word or phrase should be omitted, put it in "original" and set "replacement" to the empty string. Do not use arrows, dashes, "remove", or explanatory text as a replacement.
- Make "label" name the concrete learning issue. Do not repeat its category or severity (bad: "Register inappropriate"; good: "Greeting used for someone else").
- A correction must change something: its "replacement" never has the same words as its "original". Something that is only unclear is not a correction.
- When the learner made no mistakes, return an empty "corrections" array and say so in "explanation.note".
- Write every correction "explanation", "replacementTranslation", "why", "note" and "line" field in ${translationTarget}; keep "correctedText", suggested replacements and "say" in ${language}.
- Every correction with a non-empty "replacement" must include "replacementTranslation": the ${translationTarget} meaning of the suggested replacement.
- Return ONLY the JSON object. No markdown, no commentary outside it.${
		evaluationGuidance(language, translationTarget) ? `\n\n${evaluationGuidance(language, translationTarget)}` : ''
	}`;
}

/**
 * The evaluation request. The system message is the same for every take in a
 * language (its schema and rules, about 2,800 tokens), and everything about
 * this take (level, tone, prompt, transcript) comes after it in the user
 * message. Providers cache a prompt's unchanged opening (Groq bills it at half
 * price and leaves it out of rate limits; DeepSeek far below that), so only
 * the short tail is paid in full.
 */
/** Which part of a long take a request checks (see `evaluateAttempt`), 1-based. */
export interface EvaluationPart {
	number: number;
	count: number;
}

export function buildEvaluationMessages(request: EvaluationRequest, part?: EvaluationPart): ChatMessage[] {
	const { language, translationTarget } = request;
	const toneNote =
		request.mode === 'exam'
			? `This is EXAM practice: prioritise formal, correct ${language} suitable for the exam.`
			: `This is CASUAL practice: prioritise natural, idiomatic spoken ${language}; note formality differences but do not insist on them.`;

	const system = [
		`You are a patient ${language} speaking coach for a ${translationTarget}-speaking learner. The user message gives their level, the kind of practice and the prompt they answered.`,
		`Analyse the spoken ${language} transcript they produced and respond with JSON matching this schema:`,
		schemaFor(language, translationTarget),
		rulesFor(language, translationTarget),
		explanationRulesFor(language, translationTarget)
	].join('\n\n');

	const user = [
		`The learner is at CEFR level ${request.level}${levelNote(language, request.level)}.`,
		toneNote,
		`They were given this prompt: "${request.prompt}".`,
		'',
		...(part ? ['', partNote(part)] : []),
		'',
		'Transcript of the learner speaking:',
		'"""',
		request.transcript.trim(),
		'"""'
	].join('\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

/**
 * Tells the model it sees one part of a longer answer. The parts' replies
 * are joined: correct versions and corrections in order, the first part's
 * note, mistakes taken from every part, the last part's follow-up question.
 */
function partNote({ number, count }: EvaluationPart): string {
	const followUp = number === count ? 'Ask the follow-up question about the answer as a whole, as far as you can see it.' : 'The follow-up question of this part is not used; keep it short.';
	return `This transcript is part ${number} of ${count} of one longer answer; the other parts are checked separately. Check and correct only this part: "correctedText" and "corrections" cover this part alone. In the explanation, pick this part's most useful mistakes. ${followUp}`;
}

export function isCategory(value: unknown): value is (typeof CATEGORIES)[number] {
	return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isSeverity(value: unknown): value is (typeof SEVERITIES)[number] {
	return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function isExamStatus(value: unknown): value is (typeof EXAM_STATUSES)[number] {
	return typeof value === 'string' && (EXAM_STATUSES as readonly string[]).includes(value);
}
