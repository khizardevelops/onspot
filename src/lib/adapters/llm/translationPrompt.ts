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

/**
 * Shared few-shot rules for initial evaluation and retroactive translation.
 * The contrast between literal and word-for-word is explicit because models
 * otherwise tend to collapse both into the same grammatical English sentence.
 */
export const TRANSLATION_RULES = `Translation rules:
- Idiomatic: convey the true meaning, tone, and intent in fluent native English. Adapt phrasing when needed. Put the best rendering in "idiomatic".
- "idiomaticVariants": provide 0–2 substantially different but equally valid natural renderings. Do not create variants that differ only in punctuation or contractions. Never place literal or broken English here.
- Literal: use grammatical English, but preserve the French clause order, lexical choices, tense/aspect, and reflexive structure as closely as English permits. Do not paraphrase into a more natural English idiom. For example, "je m'appelle" is "I call myself", not "my name is" and not "I am called".
- Word-for-word: map every French token or meaningful morpheme in exact sequence. Do not repair grammar, reorder words, paraphrase, or insert helper words with no source token. Split apostrophe clitics conceptually: "je m'appelle" becomes "I me call". Broken English is required when the French structure differs.
- Literal and word-for-word must not be identical when preserving the source tokens requires ungrammatical English.
- Preserve names exactly. Do not add facts or correct the learner's meaning.

Required contrastive example:
French: "Bonjour Mademoiselle, je m'appelle Jean-Hétongue et j'ai parlé en français ici."
Idiomatic: "Hello Miss, my name is Jean-Hétongue and I've spoken in French here."
Literal: "Good day Miss, I call myself Jean-Hétongue and I have spoken in French here."
Word-for-word: "Good day Miss, I me call Jean-Hétongue and I have spoken in French here."`;
