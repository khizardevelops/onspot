// SPDX-License-Identifier: AGPL-3.0-or-later

import { translationGuidance } from './languageGuidance';

export const TRANSLATION_SCHEMA = `{
  "idiomatic": string,
  "idiomaticVariants": string[],
  "literal": string,
  "wordForWord": string
}`;

export const DETAILED_TRANSLATION_SCHEMA = `{
  "idiomatic": string,
  "idiomaticVariants": string[],
  "literal": string,
  "wordForWord": string,
  "wordBreakdown": [
    { "source": string, "target": string }
  ]
}`;

export interface TranslationLanguage {
	/** Source language name, e.g. `French`. */
	language: string;
	/** The language of instruction, by its English name, e.g. `English`, `Spanish`. */
	translationTarget: string;
}

/**
 * The worked examples are written in English. For any other language of
 * instruction they still show the structure, but the model must not copy their
 * language.
 */
function englishExampleNote(translationTarget: string): string {
	if (translationTarget === 'English') return '';
	return `\nThe contrastive example is in English only to show the three structures; write every translation in ${translationTarget}.`;
}

/**
 * The rules that keep the three translation views structurally distinct.
 * Models otherwise collapse literal and word-for-word into the same polished
 * sentence. Language names are substituted so the same prompt serves any
 * approved language.
 */
export function translationRules({ language, translationTarget }: TranslationLanguage): string {
	const rules = `Translation rules:
- Idiomatic: convey the true meaning, tone, and intent in fluent native ${translationTarget}. Adapt phrasing when needed. Put the best rendering in "idiomatic".
- "idiomaticVariants": provide 0–2 substantially different but equally valid natural renderings. Do not create variants that differ only in punctuation or contractions. Never place literal or broken ${translationTarget} here.
- Literal: use grammatical ${translationTarget}, but preserve the ${language} clause order, lexical choices, tense/aspect, and reflexive structure as closely as ${translationTarget} permits. Do not paraphrase into a more natural ${translationTarget} idiom.
- Word-for-word: map every ${language} token or meaningful morpheme in exact sequence. Do not repair grammar, reorder words, paraphrase, or insert helper words with no source token. Split apostrophe clitics conceptually. Broken ${translationTarget} is required when the ${language} structure differs.
- Literal and word-for-word must not be identical when preserving the source tokens requires ungrammatical ${translationTarget}.
- Preserve names exactly. Do not add facts or correct the learner's meaning.`;

	// A language's own rules and contrastive example (Japanese: SOV order,
	// particles, romaji in the breakdown). Contrastive examples are what fixed
	// strict literal/word-for-word output in the model lab.
	const extra = translationGuidance(language, translationTarget);
	if (extra) return `${rules}\n\n${extra}${englishExampleNote(translationTarget)}`;
	if (language.toLowerCase() !== 'french') return rules;

	return `${rules}${englishExampleNote(translationTarget)}

Required contrastive example:
French: "Bonjour Mademoiselle, je m'appelle Jean-Hétongue et j'ai parlé en français ici."
Idiomatic: "Hello Miss, my name is Jean-Hétongue and I've spoken in French here."
Literal: "Good day Miss, I call myself Jean-Hétongue and I have spoken in French here."
Word-for-word: "Good day Miss, I me call Jean-Hétongue and I have spoken in French here."`;
}
