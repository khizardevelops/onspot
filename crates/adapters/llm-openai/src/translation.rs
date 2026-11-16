// SPDX-License-Identifier: AGPL-3.0-or-later

//! Translation request/response handling for the v3 prompt.

use onspot_domain::{LlmEndpoint, TranslationBreakdownItem, TranslationSet};
use onspot_ports::{CancelToken, CoreError};

use futures::future::try_join_all;
use onspot_dsp::segments::sentence_chunks;
use onspot_dsp::speech::count_words;

use crate::client::{CompletionOptions, OpenAiEvaluator};
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

/// Words translated in one request: a long text is translated in parts of
/// whole sentences, sent together; the rate-limit pacing spreads them over
/// time and models.
const TRANSLATION_PART_WORDS: usize = 60;

/// Reply tokens per word across the three views and the word breakdown.
const REPLY_TOKENS_PER_WORD: usize = 20;
/// GPT-OSS reasons before answering, even at low effort.
const REASONING_HEADROOM: usize = 900;
const MIN_TRANSLATION_TOKENS: usize = 1_024;
const MAX_TRANSLATION_TOKENS: usize = 3_072;

/// Translations should be the likeliest reading, not a creative one.
const TRANSLATION_TEMPERATURE: f32 = 0.1;

impl OpenAiEvaluator {
    /// Translates one text into the three study views.
    ///
    /// @param text What to translate: the take's correct version ("Did you
    ///   mean to say?"), which is the transcript itself when there was nothing to fix.
    pub async fn translate(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<TranslationSet, CoreError> {
        let chunks = sentence_chunks(text, TRANSLATION_PART_WORDS);
        let parts: Vec<&str> = if chunks.is_empty() {
            vec![text]
        } else {
            chunks.iter().map(|span| span.of(text)).collect()
        };

        let asks = parts
            .iter()
            .map(|part| self.translate_part(part, endpoint, language, translation_target, token));
        let translated = try_join_all(asks).await?;
        Ok(join_parts(translated))
    }

    /// Translates one part of a text: all the views, as the model returned them.
    async fn translate_part(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<TranslationSet, CoreError> {
        let words = count_words(text);
        let budget = (words * REPLY_TOKENS_PER_WORD + REASONING_HEADROOM)
            .clamp(MIN_TRANSLATION_TOKENS, MAX_TRANSLATION_TOKENS);
        let options = CompletionOptions {
            json: true,
            temperature: TRANSLATION_TEMPERATURE,
            max_tokens: budget as u32,
            ..CompletionOptions::default()
        };

        let messages = translation_messages(text, language, translation_target);
        let raw = self
            .chat_completion(endpoint, &messages, options, token)
            .await?;
        parse_translation(&raw)
    }
}

/// Joins the parts of a long text's translation, each view in order. A part
/// with fewer idiomatic variants stands in with its idiomatic reading.
fn join_parts(parts: Vec<TranslationSet>) -> TranslationSet {
    if parts.len() == 1 {
        return parts.into_iter().next().expect("one part");
    }

    let join = |pick: &dyn Fn(&TranslationSet) -> &str| {
        parts.iter().map(pick).collect::<Vec<_>>().join(" ")
    };
    let variant_count = parts
        .iter()
        .map(|part| part.idiomatic_variants.len())
        .max()
        .unwrap_or(0);
    let idiomatic_variants = (0..variant_count)
        .map(|position| {
            join(&|part: &TranslationSet| {
                part.idiomatic_variants
                    .get(position)
                    .map_or(part.idiomatic.as_str(), String::as_str)
            })
        })
        .collect();

    TranslationSet {
        version: Some(TRANSLATION_SET_VERSION),
        instruction_language: None,
        idiomatic: join(&|part| part.idiomatic.as_str()),
        idiomatic_variants,
        literal: join(&|part| part.literal.as_str()),
        word_for_word: join(&|part| part.word_for_word.as_str()),
        word_breakdown: parts
            .iter()
            .flat_map(|part| part.word_breakdown.clone())
            .collect(),
    }
}
