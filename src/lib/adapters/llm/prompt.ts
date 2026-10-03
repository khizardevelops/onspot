import type { ChatMessage, EvaluationRequest } from './types';
import { TRANSLATION_SCHEMA, translationRules, type TranslationLanguage } from './translationPrompt';
import { evaluationGuidance, levelNote } from './languageGuidance';

const CATEGORIES = ['grammar', 'register', 'filler', 'style'] as const;
const SEVERITIES = ['error', 'warning', 'suggestion'] as const;
const EXAM_STATUSES = ['strictly-avoid', 'avoid', 'use-sparingly', 'allowed'] as const;

function schemaFor(language: string): string {
	return `{
  "spokenLanguage": string,       // the language the learner mainly spoke, named in English, e.g. "${language}", "English"
  "correctedText": string,        // the learner's transcript with your corrections applied
  "naturalSpeech": string,        // fluent, natural spoken ${language} version of what they meant
  "translations": ${TRANSLATION_SCHEMA},
  "summary": string,              // at most two short sentences of coaching, in the learner's native language
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

function rulesFor(language: string, translationTarget: string): string {
	return `Rules:
- The transcript comes from speech recognition. Ignore obvious transcription artefacts (misheard proper nouns, missing punctuation) unless they change the meaning; do not "correct" the recogniser's mistakes as if they were the learner's.
- Only correct what the learner actually said. Never invent context or content.
- The learner must answer in ${language}. Set "spokenLanguage" to the language most of the transcript is in. If it is not ${language}, return an empty "corrections" array, give the ${language} version of what they meant as "correctedText" and "naturalSpeech", and use "summary" to tell them they answered in the wrong language.
- A word or phrase from another language inside ${language} speech is a mistake: correct it to ${language} with category "grammar", severity "error" (unless it is a proper noun or a loanword ${language} speakers really use).
- grammar → severity "error". register and filler issues → "warning". optional polish → "suggestion".
- For register/filler corrections, set "examStatus" and give "formalAlternatives" where a formal connector exists.
- Connectors: prefer connectors that are appropriate for spoken ${language} and, in exam mode, formal. Do not suggest written-only connectors the learner cannot say.
- Vocabulary: suggest at most 3 upgrades that a fluent speaker would plausibly use. If there is nothing worth changing, return [].
- Corrections must use "original" exactly as it appears in the transcript.
- If a word or phrase should be omitted, put it in "original" and set "replacement" to the empty string. Do not use arrows, dashes, "remove", or explanatory text as a replacement.
- Make "label" name the concrete learning issue. Do not repeat its category or severity (bad: "Register inappropriate"; good: "Greeting used for someone else").
- When the learner made no mistakes, return an empty "corrections" array and say so in "summary".
- "summary": at most two short sentences. State the main issue and the fix; never pad or repeat what the corrections already say.
- Write "summary", "explanation", "replacementTranslation" and "why" fields in ${translationTarget}; keep correctedText, naturalSpeech and suggested replacements in ${language}.
${translationRules({ language, translationTarget })}
- Every correction with a non-empty "replacement" must include "replacementTranslation": the ${translationTarget} meaning of the suggested replacement.
- Return ONLY the JSON object. No markdown, no commentary outside it.${
		evaluationGuidance(language, translationTarget) ? `\n\n${evaluationGuidance(language, translationTarget)}` : ''
	}`;
}

export function buildEvaluationMessages(request: EvaluationRequest): ChatMessage[] {
	const translation: TranslationLanguage = {
		language: request.language,
		translationTarget: request.translationTarget
	};
	const toneNote =
		request.mode === 'exam'
			? `This is EXAM practice: prioritise formal, correct ${request.language} suitable for the exam.`
			: `This is CASUAL practice: prioritise natural, idiomatic spoken ${request.language}; note formality differences but do not insist on them.`;

	const system = [
		`You are a patient ${request.language} speaking coach for a ${request.translationTarget}-speaking learner at CEFR level ${request.level}${levelNote(request.language, request.level)}.`,
		toneNote,
		`The learner was given this prompt: "${request.prompt}".`,
		`Analyse the spoken ${request.language} transcript they produced and respond with JSON matching this schema:`,
		schemaFor(request.language),
		rulesFor(request.language, request.translationTarget)
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
