// SPDX-License-Identifier: AGPL-3.0-or-later

//! Evaluation JSON extraction and validation, ported from
//! `src/lib/adapters/llm/evaluate.ts` and the `stripThinking` helper.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use onspot_domain::{
    ConnectorSuggestion, EvaluationCorrection, EvaluationResult, FollowUp, VocabularySuggestion,
};
use onspot_dsp::words::same_words;

use crate::explanation::{
    compose_explanation, format_explanation, normalize_follow_up, separate_follow_up,
};
use crate::json_repair::repair_json;
use crate::prompt::{is_category, is_exam_status, is_severity};

static THINK_BLOCK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<think[\s\S]*?</think>").expect("think block"));
static FENCED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)```(?:json)?\s*([\s\S]*?)```").expect("fenced JSON"));

/// Removes `<think>` reasoning blocks and truncates an unclosed one.
pub fn strip_thinking(text: &str) -> String {
    let without_blocks = THINK_BLOCK.replace_all(text, "");
    let lower = without_blocks.to_lowercase();
    let open = lower.find("<think");
    open.map_or_else(
        || without_blocks.trim().to_owned(),
        |position| without_blocks[..position].trim().to_owned(),
    )
}

fn closing_brace(text: &str, start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let bytes = text.as_bytes();
    let mut index = start;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if byte == b'\\' {
                index += 1;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
        } else if byte == b'{' {
            depth += 1;
        } else if byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

const CUT_OFF: &str = "The model’s reply was cut off before it finished. Please try again.";
const MALFORMED: &str = "The model returned malformed JSON. Please try again.";
const NO_OBJECT: &str = "The model did not return a JSON object.";

/// Pulls the first balanced JSON object out of a model response.
pub fn extract_json(raw: &str) -> Result<Value, String> {
    let trimmed = strip_thinking(raw);
    let fenced = FENCED.captures(&trimmed);
    let candidate = fenced
        .as_ref()
        .map_or(trimmed.as_str(), |captures| &captures[1]);
    let start = candidate.find('{').ok_or_else(|| String::from(NO_OBJECT))?;
    let end = closing_brace(candidate, start).ok_or_else(|| String::from(CUT_OFF))?;
    let last = candidate.rfind('}').map(|index| index + 1).unwrap_or(start);

    for span in [&candidate[start..=end], &candidate[start..last]] {
        if let Some(repaired) = repair_json(span) {
            if let Ok(value) = serde_json::from_str(&repaired) {
                return Ok(value);
            }
        }
    }
    Err(String::from(MALFORMED))
}

fn as_string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn as_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn map_correction(raw: &Value) -> Option<EvaluationCorrection> {
    let fields = raw.as_object()?;
    let category = as_string(fields.get("category"));
    let severity = as_string(fields.get("severity"));
    if !is_category(&category) || !is_severity(&severity) {
        return None;
    }
    let original = as_string(fields.get("original"));
    let replacement = as_string(fields.get("replacement"));
    if original.is_empty() && replacement.is_empty() {
        return None;
    }
    if !original.is_empty() && !replacement.is_empty() && same_words(&original, &replacement) {
        return None;
    }

    let replacement_translation =
        Some(as_string(fields.get("replacementTranslation"))).filter(|text| !text.is_empty());
    let speak_text = Some(as_string(fields.get("speakText"))).filter(|text| !text.is_empty());
    let exam_status = Some(as_string(fields.get("examStatus"))).filter(|text| is_exam_status(text));

    Some(EvaluationCorrection {
        category,
        severity,
        label: {
            let label = as_string(fields.get("label"));
            if label.is_empty() {
                String::from("Correction")
            } else {
                label
            }
        },
        original,
        replacement,
        replacement_translation,
        explanation: as_string(fields.get("explanation")),
        speak_text,
        exam_status,
        formal_alternatives: as_string_array(fields.get("formalAlternatives")),
    })
}

fn map_vocabulary(raw: &Value) -> Option<VocabularySuggestion> {
    let fields = raw.as_object()?;
    let original = as_string(fields.get("original"));
    let suggestion = as_string(fields.get("suggestion"));
    if original.is_empty() || suggestion.is_empty() {
        return None;
    }
    Some(VocabularySuggestion {
        original,
        suggestion,
        why: as_string(fields.get("why")),
    })
}

fn map_connector(raw: &Value) -> Option<ConnectorSuggestion> {
    let fields = raw.as_object()?;
    let connector = as_string(fields.get("connector"));
    if connector.is_empty() {
        return None;
    }
    Some(ConnectorSuggestion {
        connector,
        instead_of: Some(as_string(fields.get("insteadOf"))).filter(|text| !text.is_empty()),
        why: as_string(fields.get("why")),
    })
}

fn explanation_and_follow_up(
    raw_explanation: &Value,
    raw_follow_up: &Value,
) -> (String, Option<FollowUp>) {
    let composed = compose_explanation(raw_explanation);
    let (parts, asked) = separate_follow_up(&composed);
    let explanation = format_explanation(&parts).trim().to_owned();
    let follow_up = normalize_follow_up(raw_follow_up)
        .map(|(question, translation)| FollowUp {
            question,
            translation,
        })
        .or_else(|| {
            asked.map(|question| FollowUp {
                question,
                translation: String::new(),
            })
        });
    (explanation, follow_up)
}

/// Validates and normalises one model response into a trusted evaluation.
pub fn normalize_evaluation(
    raw: &Value,
    transcript: &str,
    language: Option<&str>,
) -> EvaluationResult {
    let fields = raw.as_object();

    let mut corrections: Vec<EvaluationCorrection> = fields
        .and_then(|fields| fields.get("corrections"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(map_correction).collect())
        .unwrap_or_default();
    let vocabulary: Vec<VocabularySuggestion> = fields
        .and_then(|fields| fields.get("vocabulary"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(map_vocabulary).collect())
        .unwrap_or_default();
    let connectors: Vec<ConnectorSuggestion> = fields
        .and_then(|fields| fields.get("connectors"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(map_connector).collect())
        .unwrap_or_default();

    let corrected = as_string(fields.and_then(|fields| fields.get("correctedText")));
    let corrected_text = if corrected.trim().is_empty() {
        transcript.to_owned()
    } else {
        corrected
    };
    let raw_follow_up = fields
        .and_then(|fields| fields.get("followUp"))
        .unwrap_or(&Value::Null);
    let raw_explanation = fields
        .and_then(|fields| fields.get("explanation"))
        .unwrap_or(&Value::Null);
    let (explanation, follow_up) = explanation_and_follow_up(raw_explanation, raw_follow_up);

    let spoken = as_string(fields.and_then(|fields| fields.get("spokenLanguage")));
    let wrong_language = language.is_some_and(|language| {
        !spoken.is_empty()
            && !spoken.to_lowercase().contains(&language.to_lowercase())
            && !transcript.trim().is_empty()
    });
    if wrong_language {
        let language = language.unwrap_or_default();
        let spoken = spoken.clone();
        let spoken_explanation = crate::explanation::speakable_explanation(&explanation);
        corrections.clear();
        corrections.push(EvaluationCorrection {
            category: String::from("grammar"),
            severity: String::from("error"),
            label: format!("Answered in {spoken} instead of {language}"),
            original: transcript.trim().to_owned(),
            replacement: if corrected_text != transcript.trim() {
                corrected_text.clone()
            } else {
                String::new()
            },
            replacement_translation: None,
            explanation: if spoken_explanation.is_empty() {
                format!("This take was spoken in {spoken}. Answer the prompt in {language}.")
            } else {
                spoken_explanation
            },
            speak_text: None,
            exam_status: None,
            formal_alternatives: Vec::new(),
        });
    }

    EvaluationResult {
        corrected_text,
        explanation,
        follow_up,
        corrections,
        vocabulary,
        connectors,
    }
}
