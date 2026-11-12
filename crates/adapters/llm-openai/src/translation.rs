// SPDX-License-Identifier: AGPL-3.0-or-later

//! Translation request/response handling for the v3 prompt.

use onspot_domain::{LlmEndpoint, TranslationBreakdownItem, TranslationSet};
use onspot_ports::{CancelToken, CoreError};

use crate::client::OpenAiEvaluator;
use crate::parse::extract_json;
use crate::translation_prompt::translation_messages;

/// The prompt format version this adapter writes.
pub const TRANSLATION_SET_VERSION: i64 = 3;

fn text(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn variants(value: Option<&serde_json::Value>, idiomatic: &str) -> Vec<String> {
    let mut output: Vec<String> = Vec::new();
    if let Some(items) = value.and_then(serde_json::Value::as_array) {
        for item in items {
            let value = text(Some(item));
            if !value.is_empty() && value != idiomatic && !output.contains(&value) {
                output.push(value);
            }
            if output.len() == 2 {
                break;
            }
        }
    }
    output
}

fn breakdown(value: Option<&serde_json::Value>) -> Vec<TranslationBreakdownItem> {
    value
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let source = text(item.get("source"));
                    let target = text(item.get("target"));
                    (!source.is_empty() && !target.is_empty())
                        .then_some(TranslationBreakdownItem { source, target })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parses one model reply into the stored translation shape.
pub fn parse_translation(raw: &str) -> Result<TranslationSet, CoreError> {
    let parsed = extract_json(raw).map_err(|message| {
        CoreError::new(
            "translations.invalid_json",
            format!("The model returned unusable translation JSON: {message}"),
        )
    })?;
    let source = parsed.get("translations").unwrap_or(&parsed);
    let idiomatic = text(source.get("idiomatic"));
    let literal = text(source.get("literal"));
    let word_for_word = text(source.get("wordForWord"));
    if idiomatic.is_empty() || literal.is_empty() || word_for_word.is_empty() {
        return Err(CoreError::new(
            "translations.incomplete",
            "The model did not return all three translation variants. Please try again.",
        ));
    }

    Ok(TranslationSet {
        version: Some(TRANSLATION_SET_VERSION),
        instruction_language: None,
        idiomatic: idiomatic.clone(),
        idiomatic_variants: variants(source.get("idiomaticVariants"), &idiomatic),
        literal,
        word_for_word,
        word_breakdown: breakdown(source.get("wordBreakdown")),
    })
}

impl OpenAiEvaluator {
    /// Translates one text into the three study views.
    pub async fn translate(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<TranslationSet, CoreError> {
        let messages = translation_messages(text, language, translation_target);
        let raw = self
            .complete(endpoint, &messages, 3072, false, 0.1, token)
            .await?;
        parse_translation(&raw)
    }
}
