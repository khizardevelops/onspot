// SPDX-License-Identifier: AGPL-3.0-or-later

//! The bundled speaking prompts moved from `src/lib/practice/promptCatalogue.ts`.

use once_cell::sync::Lazy;
use onspot_domain::Prompt;
use onspot_ports::{RecordsStore, StoreError};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One reviewed prompt, written in its instruction language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CataloguePrompt {
    pub id: String,
    pub instruction_language: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub target_languages: Option<Vec<String>>,
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Deserialize)]
struct Catalogue {
    prompts: Vec<CataloguePrompt>,
}

static CATALOGUE: Lazy<Vec<CataloguePrompt>> = Lazy::new(|| {
    serde_json::from_str::<Catalogue>(include_str!("../assets/prompts.json"))
        .expect("the checked-in prompt catalogue is valid")
        .prompts
});

/// Every bundled prompt, in registry order.
pub fn prompt_catalogue() -> &'static [CataloguePrompt] {
    &CATALOGUE
}

/// The prompts that suit an instruction/target language pair.
pub fn catalogue_prompts_for(
    instruction_language: &str,
    target_language: &str,
) -> Vec<CataloguePrompt> {
    CATALOGUE
        .iter()
        .filter(|prompt| {
            prompt.instruction_language == instruction_language
                && prompt.target_languages.as_ref().map_or(true, |targets| {
                    targets.iter().any(|target| target == target_language)
                })
        })
        .cloned()
        .collect()
}

/// The language of instruction every catalogue has prompts in.
pub const FALLBACK_INSTRUCTION_LANGUAGE: &str = "en";

/// The prompts a draft can offer for a language pair.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptCandidates {
    pub prompts: Vec<Prompt>,
    /// True when none exist in the language of instruction and the English
    /// ones stand in.
    pub english_fallback: bool,
}

/// The prompts stored for a studied language and a language of instruction,
/// seeding the bundled catalogue entries on first use. Ported from
/// `ensurePromptsSeeded`.
///
/// A language of instruction without catalogue entries yields an empty list:
/// the caller generates a prompt instead, and later calls find what it stored.
///
/// @param now The seeding time (RFC 3339), stamped on the stored prompts.
pub async fn seeded_prompts(
    records: &dyn RecordsStore,
    target_language: &str,
    instruction_language: &str,
    now: &str,
) -> Result<Vec<Prompt>, StoreError> {
    let instruction_language = known_instruction_language(instruction_language);
    let existing = records
        .list_prompts(Some(target_language), Some(instruction_language))
        .await?;
    if !existing.is_empty() {
        return Ok(existing);
    }

    let seeds = catalogue_prompts_for(instruction_language, target_language);
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    for seed in seeds {
        let prompt = Prompt {
            id: seed.id,
            title: seed.title,
            text: seed.text,
            category: seed.category,
            language: Some(target_language.to_owned()),
            instruction_language: instruction_language.to_owned(),
            created_at: now.to_owned(),
        };
        records.put_prompt(&prompt).await?;
    }
    records
        .list_prompts(Some(target_language), Some(instruction_language))
        .await
}

/// The prompts to choose from: the pair's own, or the English ones as a last
/// resort when nothing exists in the language of instruction.
pub async fn prompt_candidates(
    records: &dyn RecordsStore,
    target_language: &str,
    instruction_language: &str,
    now: &str,
) -> Result<PromptCandidates, StoreError> {
    let own = seeded_prompts(records, target_language, instruction_language, now).await?;
    if !own.is_empty() {
        return Ok(PromptCandidates {
            prompts: own,
            english_fallback: false,
        });
    }

    let english =
        seeded_prompts(records, target_language, FALLBACK_INSTRUCTION_LANGUAGE, now).await?;
    Ok(PromptCandidates {
        prompts: english,
        english_fallback: true,
    })
}

/// A known language of instruction, or the first one (English) for an
/// unknown id, as the driver's `getInstructionLanguage` resolves it.
fn known_instruction_language(id: &str) -> &str {
    let languages = &crate::language::catalog().instruction_languages;
    languages
        .iter()
        .find(|language| language.id == id)
        .or_else(|| languages.first())
        .map_or(FALLBACK_INSTRUCTION_LANGUAGE, |language| {
            language.id.as_str()
        })
}

/// The English text of a bundled prompt by its title.
pub fn english_prompt_text_by_title(title: &str) -> Option<String> {
    CATALOGUE
        .iter()
        .find(|prompt| prompt.instruction_language == "en" && prompt.title == title)
        .map(|prompt| prompt.text.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn english_and_target_specific_prompts_are_selected_like_the_registry() {
        let english = catalogue_prompts_for("en", "fr");
        assert!(english
            .iter()
            .any(|prompt| prompt.id == "en-morning-routine"));
        assert_eq!(english[0].instruction_language, "en");

        let russian = catalogue_prompts_for("ru", "fr");
        assert!(russian
            .iter()
            .all(|prompt| prompt.instruction_language == "ru"));
        assert_eq!(
            english_prompt_text_by_title("Morning routine").as_deref(),
            Some("Describe your morning routine.")
        );
        assert_eq!(english_prompt_text_by_title("missing"), None);
    }
}
