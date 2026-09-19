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
	/** Learner's native language name, e.g. `English`. */
	translationTarget: string;
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

	// The contrastive example is what fixed strict literal/word-for-word output
	// for French in the model lab; keep it where it applies.
	if (language.toLowerCase() !== 'french') return rules;

	return `${rules}

Required contrastive example:
French: "Bonjour Mademoiselle, je m'appelle Jean-Hétongue et j'ai parlé en français ici."
Idiomatic: "Hello Miss, my name is Jean-Hétongue and I've spoken in French here."
Literal: "Good day Miss, I call myself Jean-Hétongue and I have spoken in French here."
Word-for-word: "Good day Miss, I me call Jean-Hétongue and I have spoken in French here."`;
}
