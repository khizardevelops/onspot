// SPDX-License-Identifier: AGPL-3.0-or-later

//! Translation prompt rendering, ported from
//! `src/lib/adapters/llm/translationPrompt.ts` (v3).

use crate::language_guidance::translation_guidance;

/// The JSON shape the translation request asks for.
pub const DETAILED_TRANSLATION_SCHEMA: &str = r#"{
  "idiomatic": string,
  "idiomaticVariants": string[],
  "literal": string,
  "wordForWord": string,
  "wordBreakdown": [
    { "source": string, "target": string }
  ]
}"#;

fn english_example_note(translation_target: &str) -> String {
    if translation_target == "English" {
        String::new()
    } else {
        format!(
            "\nThe contrastive example is in English only to show the three structures; write every translation in {translation_target}."
        )
    }
}

/// The rules that keep the three translation views structurally distinct.
pub fn translation_rules(language: &str, translation_target: &str) -> String {
    let rules = r#"Translation rules:
- Idiomatic: convey the true meaning, tone, and intent in fluent native {{translationTarget}}. Adapt phrasing when needed. Put the best rendering in "idiomatic".
- "idiomaticVariants": provide 0–2 substantially different but equally valid natural renderings. Do not create variants that differ only in punctuation or contractions. Never place literal or broken {{translationTarget}} here.
- Literal: use grammatical {{translationTarget}}, but preserve the {{language}} clause order, lexical choices, tense/aspect, and reflexive structure as closely as {{translationTarget}} permits. Do not paraphrase into a more natural {{translationTarget}} idiom.
- Word-for-word: map every {{language}} token or meaningful morpheme in exact sequence. Do not repair grammar, reorder words, paraphrase, or insert helper words with no source token. Split apostrophe clitics conceptually. Broken {{translationTarget}} is required when the {{language}} structure differs.
- Literal and word-for-word must not be identical when preserving the source tokens requires ungrammatical {{translationTarget}}.
- Preserve names exactly. Do not add facts or correct the learner's meaning."#
        .replace("{{language}}", language)
        .replace("{{translationTarget}}", translation_target);

    let extra = translation_guidance(language, translation_target);
    if !extra.is_empty() {
        return format!(
            "{rules}\n\n{extra}{}",
            english_example_note(translation_target)
        );
    }
    if language.to_lowercase() != "french" {
        return rules;
    }

    format!(
        "{rules}{}

Required contrastive example:
French: \"Bonjour Mademoiselle, je m'appelle Jean-Hétongue et j'ai parlé en français ici.\"
Idiomatic: \"Hello Miss, my name is Jean-Hétongue and I've spoken in French here.\"
Literal: \"Good day Miss, I call myself Jean-Hétongue and I have spoken in French here.\"
Word-for-word: \"Good day Miss, I me call Jean-Hétongue and I have spoken in French here.\"",
        english_example_note(translation_target)
    )
}

/// Renders the two chat messages for one translation request.
pub fn translation_messages(
    text: &str,
    language: &str,
    translation_target: &str,
) -> Vec<crate::prompt::ChatMessage> {
    vec![
        crate::prompt::ChatMessage {
            role: String::from("system"),
            content: format!(
                "You are an expert {language}-to-{translation_target} translation engine. Translate the source into distinct study views.

Return only a JSON object with this exact structure:
{{
  \"translations\": {DETAILED_TRANSLATION_SCHEMA}
}}

{}

For \"wordBreakdown\", map the source's primary tokens or morphemes in order to their isolated {translation_target} equivalents. Split contractions when useful. Keep each item brief. Leave punctuation out: no entries for commas, full stops or other marks.",
                translation_rules(language, translation_target)
            ),
        },
        crate::prompt::ChatMessage {
            role: String::from("user"),
            content: format!("{language} text:\n\"\"\"\n{}\n\"\"\"", text.trim()),
        },
    ]
}
