import type { ChatMessage, EvaluationRequest } from './types';
import { TRANSLATION_RULES, TRANSLATION_SCHEMA } from './translationPrompt';

const CATEGORIES = ['grammar', 'register', 'filler', 'style'] as const;
const SEVERITIES = ['error', 'warning', 'suggestion'] as const;
const EXAM_STATUSES = ['strictly-avoid', 'avoid', 'use-sparingly', 'allowed'] as const;

const SCHEMA = `{
  "correctedText": string,        // the learner's transcript with your corrections applied
  "naturalSpeech": string,        // fluent, natural spoken French version of what they meant
  "translations": ${TRANSLATION_SCHEMA},
  "summary": string,              // at most two short sentences of coaching, in English
  "corrections": [
    {
      "category": "grammar" | "register" | "filler" | "style",
      "severity": "error" | "warning" | "suggestion",
      "label": string,            // short name, e.g. "Elision", "Agreement", "Filler word"
      "original": string,         // the exact substring to change
      "replacement": string,      // what it should be
      "replacementTranslation": string, // English meaning of the replacement
      "explanation": string,      // why, in English, aimed at a learner
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

const RULES = `Rules:
- The transcript comes from speech recognition. Ignore obvious transcription artefacts (misheard proper nouns, missing punctuation) unless they change the meaning; do not "correct" the recogniser's mistakes as if they were the learner's.
- Only correct what the learner actually said. Never invent context or content.
- grammar → severity "error". register and filler issues → "warning". optional polish → "suggestion".
- For register/filler corrections, set "examStatus" and give "formalAlternatives" where a formal connector exists.
- Connectors: prefer connectors that are appropriate for spoken French and, in exam mode, formal (e.g. "par conséquent", "en réalité", "cependant"). Do not suggest written-only connectors the learner cannot say.
- Vocabulary: suggest at most 3 upgrades that a fluent speaker would plausibly use. If there is nothing worth changing, return [].
- Corrections must use "original" exactly as it appears in the transcript.
- When the learner made no mistakes, return an empty "corrections" array and say so in "summary".
- "summary": at most two short sentences. State the main issue and the fix; never pad or repeat what the corrections already say.
${TRANSLATION_RULES}
- Every correction with a non-empty "replacement" must include "replacementTranslation": the English meaning of the suggested replacement.
- Return ONLY the JSON object. No markdown, no commentary outside it.`;

export function buildEvaluationMessages(request: EvaluationRequest): ChatMessage[] {
	const toneNote =
		request.mode === 'exam'
			? 'This is EXAM practice: prioritise formal, correct French suitable for the exam.'
			: 'This is CASUAL practice: prioritise natural, idiomatic spoken French; note formality differences but do not insist on them.';

	const system = [
		`You are a patient French speaking coach for an English-speaking learner at CEFR level ${request.level}.`,
		toneNote,
		`The learner was given this prompt: "${request.prompt}".`,
		'Analyse the spoken French transcript they produced and respond with JSON matching this schema:',
		SCHEMA,
		RULES
	].join('\n\n');

	const user = [
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

export function isCategory(value: unknown): value is (typeof CATEGORIES)[number] {
	return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function isSeverity(value: unknown): value is (typeof SEVERITIES)[number] {
	return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function isExamStatus(value: unknown): value is (typeof EXAM_STATUSES)[number] {
	return typeof value === 'string' && (EXAM_STATUSES as readonly string[]).includes(value);
}
