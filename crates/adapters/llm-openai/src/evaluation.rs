// SPDX-License-Identifier: AGPL-3.0-or-later

//! Judging one take, ported from `src/lib/adapters/llm/evaluate.ts`.
//!
//! The reply holds the whole correct version and every correction, so a long
//! take would not fit the reply budget: it is checked in parts of whole
//! sentences instead, sent together and paced by the rate-limit pacing. The
//! shared instructions are the same for every part, so the provider serves
//! them from its cache.

use futures::future::try_join_all;
use onspot_domain::{EvaluationRequest, EvaluationResult};
use onspot_dsp::segments::sentence_chunks;
use onspot_ports::{CancelToken, CoreError};
use serde_json::{json, Map, Value};

use crate::client::{CompletionOptions, OpenAiEvaluator};
use crate::explanation::EXPLANATION_MAX_MISTAKES;
use crate::parse::{extract_json, normalize_evaluation};
use crate::prompt::{
    build_evaluation_messages, EvaluationPart, MAX_EVALUATION_TOKENS, MAX_VOCABULARY_SUGGESTIONS,
};

/// Words of a take checked in one request (a five-minute answer is about 700
/// words, which would not fit `MAX_EVALUATION_TOKENS`).
const EVALUATION_PART_WORDS: usize = 260;

/// How long feedback waits for the learner's own model before a fallback
/// takes it: long enough for any per-minute allowance to refill. The fallbacks
/// are weaker at this job (GPT-OSS 20B missed corrections and broke its JSON on
/// a long take, 2026-11-01), so they only step in when the learner's model is
/// out for longer, e.g. its daily allowance is used up.
const EVALUATION_PATIENCE_MS: u64 = 45_000;

impl OpenAiEvaluator {
    /// Sends a transcript to the configured LLM and returns a structured
    /// evaluation. A long take is checked in parts whose replies are joined.
    pub async fn evaluate(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        // Silence (or a mic that captured nothing) transcribes to "". Sending
        // that spends a paid call and comes back as invented feedback on nothing.
        if request.transcript.trim().is_empty() {
            return Err(CoreError::new(
                "llm.empty_transcript",
                "No speech was recognised in that take. Check your microphone and try again.",
            ));
        }

        let transcript = request.transcript.as_str();
        let parts: Vec<&str> = sentence_chunks(transcript, EVALUATION_PART_WORDS)
            .into_iter()
            .map(|span| span.of(transcript))
            .collect();

        if parts.len() <= 1 {
            let reply = self.evaluate_part(request, transcript, None, token).await?;
            return Ok(normalize_evaluation(
                &reply,
                transcript,
                Some(&request.language),
            ));
        }

        let count = parts.len();
        let asks = parts.iter().enumerate().map(|(index, part)| {
            let numbered = EvaluationPart {
                number: index + 1,
                count,
            };
            self.evaluate_part(request, part, Some(numbered), token)
        });
        let replies = try_join_all(asks).await?;
        let joined = join_part_replies(&replies, &parts);
        Ok(normalize_evaluation(
            &joined,
            transcript,
            Some(&request.language),
        ))
    }

    async fn evaluate_part(
        &self,
        request: &EvaluationRequest,
        transcript: &str,
        part: Option<EvaluationPart>,
        token: &CancelToken,
    ) -> Result<Value, CoreError> {
        let messages = build_evaluation_messages(
            transcript,
            &request.prompt,
            &request.mode,
            &request.level,
            &request.language,
            &request.translation_target,
            part,
        );
        let options = CompletionOptions {
            json: true,
            max_tokens: MAX_EVALUATION_TOKENS,
            patience_ms: EVALUATION_PATIENCE_MS,
            ..CompletionOptions::default()
        };
        let raw = self
            .chat_completion(&request.endpoint, &messages, options, token)
            .await?;
        extract_json(&raw).map_err(|message| {
            CoreError::new(
                "llm.invalid_json",
                format!("The model returned unusable JSON: {message}"),
            )
        })
    }
}

/// Joins the raw replies for the parts of a long take into the reply for the
/// whole: the correct versions and corrections in order, the opening note of
/// the first part, the explanation's mistakes taken from every part in turn
/// (so they span the take), and the follow-up question of the last part.
///
/// @param parts Each part's transcript, standing in for a part whose reply lacks a correct version.
fn join_part_replies(replies: &[Value], parts: &[&str]) -> Value {
    let empty = Map::new();
    let records: Vec<&Map<String, Value>> = replies
        .iter()
        .map(|reply| reply.as_object().unwrap_or(&empty))
        .collect();
    let explanations: Vec<&Map<String, Value>> = records
        .iter()
        .map(|record| {
            record
                .get("explanation")
                .and_then(Value::as_object)
                .unwrap_or(&empty)
        })
        .collect();

    let spoken_language = first_text(records.iter().map(|record| record.get("spokenLanguage")));
    let corrected_text = records
        .iter()
        .zip(parts)
        .map(|(record, part)| {
            let corrected = text_of(record.get("correctedText")).trim().to_owned();
            if corrected.is_empty() {
                (*part).to_owned()
            } else {
                corrected
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let note = first_text(
        explanations
            .iter()
            .map(|explanation| explanation.get("note")),
    );
    let mistakes = interleave(
        explanations
            .iter()
            .map(|explanation| list_of(explanation.get("mistakes")))
            .collect(),
    );
    let follow_up = records
        .iter()
        .rev()
        .find_map(|record| record.get("followUp").filter(|value| is_truthy(value)))
        .cloned()
        .unwrap_or(Value::Null);
    let corrections: Vec<Value> = records
        .iter()
        .flat_map(|record| list_of(record.get("corrections")))
        .collect();
    let vocabulary = interleave(
        records
            .iter()
            .map(|record| list_of(record.get("vocabulary")))
            .collect(),
    );
    let connectors: Vec<Value> = records
        .iter()
        .flat_map(|record| list_of(record.get("connectors")))
        .collect();

    json!({
        "spokenLanguage": spoken_language,
        "correctedText": corrected_text,
        "explanation": {
            "note": note,
            "mistakes": mistakes.into_iter().take(EXPLANATION_MAX_MISTAKES).collect::<Vec<_>>(),
        },
        "followUp": follow_up,
        "corrections": corrections,
        "vocabulary": vocabulary.into_iter().take(MAX_VOCABULARY_SUGGESTIONS).collect::<Vec<_>>(),
        "connectors": connectors,
    })
}

/// Takes one item from each list in turn: the first of every list, then the
/// second, and so on.
fn interleave(lists: Vec<Vec<Value>>) -> Vec<Value> {
    let longest = lists.iter().map(Vec::len).max().unwrap_or(0);
    (0..longest)
        .flat_map(|position| {
            lists
                .iter()
                .filter_map(move |list| list.get(position).cloned())
        })
        .collect()
}

fn list_of(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

fn text_of(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or_default()
}

/// The first non-empty text among the values.
fn first_text<'a>(values: impl Iterator<Item = Option<&'a Value>>) -> String {
    values
        .map(text_of)
        .find(|text| !text.is_empty())
        .unwrap_or_default()
        .to_owned()
}

/// JavaScript truthiness for a JSON value, as the joined `followUp` used it.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_join_in_order_with_mistakes_taken_in_turn() {
        let replies = vec![
            json!({
                "spokenLanguage": "French",
                "correctedText": "Je suis allé.",
                "explanation": { "note": "Bien.", "mistakes": [{ "said": "a" }, { "said": "b" }] },
                "followUp": { "question": "Et après ?" },
                "corrections": [{ "label": "one" }],
                "vocabulary": [{ "word": "v1" }],
            }),
            json!({
                "correctedText": "",
                "explanation": { "note": "", "mistakes": [{ "said": "c" }] },
                "followUp": null,
                "corrections": [{ "label": "two" }],
                "vocabulary": [{ "word": "v2" }],
            }),
        ];

        let joined = join_part_replies(&replies, &["Je suis allé.", "Puis rentré."]);

        assert_eq!(joined["spokenLanguage"], "French");
        assert_eq!(joined["correctedText"], "Je suis allé. Puis rentré.");
        assert_eq!(joined["explanation"]["note"], "Bien.");
        let said: Vec<&str> = joined["explanation"]["mistakes"]
            .as_array()
            .expect("mistakes")
            .iter()
            .map(|mistake| mistake["said"].as_str().expect("said"))
            .collect();
        assert_eq!(said, ["a", "c", "b"]);
        assert_eq!(joined["followUp"]["question"], "Et après ?");
        assert_eq!(joined["corrections"].as_array().map(Vec::len), Some(2));
        assert_eq!(joined["vocabulary"].as_array().map(Vec::len), Some(2));
    }
}
