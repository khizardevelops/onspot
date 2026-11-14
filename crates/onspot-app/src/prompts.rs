// SPDX-License-Identifier: AGPL-3.0-or-later

//! The bundled speaking prompts moved from `src/lib/practice/promptCatalogue.ts`.

use once_cell::sync::Lazy;
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
