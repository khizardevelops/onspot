// SPDX-License-Identifier: AGPL-3.0-or-later

//! Merges the pre-SQLite JSON backup format into the database.
//!
//! Ported from `importLegacyJsonBackup` in `src/lib/utils/export.ts`. The
//! driver still reads the file; parsing, validation and the merge order live
//! here so every driver imports the same backup the same way.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use onspot_domain::{
    Attempt, AudioAsset, Correction, Prompt, Session, SessionSetup, TranslationBreakdownItem,
    TranslationSet,
};
use onspot_ports::{HistoryStore, RecordsStore, SettingsStore, StoreError};

use crate::language::{catalog, language};
use crate::settings::{DEFAULT_TARGET_SPEECH_PACE, SPEECH_PACES};

/// Counts after a format-1 JSON backup has been merged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub sessions: u32,
    pub attempts: u32,
    pub corrections: u32,
    pub recordings: u32,
    pub settings: u32,
}

/// A backup the learner can be told about, without leaking JSON internals.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LegacyImportError {
    #[error("This is not a readable onspot JSON backup.")]
    NotJson,
    #[error(
        "Choose an onspot JSON backup with format 1. For a .sqlite backup, use Restore database."
    )]
    WrongFormat,
    #[error("{0}")]
    Store(String),
}

impl From<StoreError> for LegacyImportError {
    fn from(error: StoreError) -> Self {
        Self::Store(error.to_string())
    }
}

fn is_record(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn as_array(value: Option<&Value>) -> Vec<&Map<String, Value>> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(is_record).collect())
        .unwrap_or_default()
}

fn text(value: Option<&Value>, fallback: &str) -> String {
    value.and_then(Value::as_str).unwrap_or(fallback).to_owned()
}

fn nullable_text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_owned)
}

fn number(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn integer(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_f64).map(|value| value as i64)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn translation(value: Option<&Value>) -> Option<TranslationSet> {
    let fields = value.and_then(is_record)?;
    let idiomatic = text(fields.get("idiomatic"), "");
    if idiomatic.is_empty() {
        return None;
    }
    let variants = strings(fields.get("idiomaticVariants"))
        .into_iter()
        .filter(|variant| *variant != idiomatic)
        .collect::<Vec<_>>();
    let breakdown = fields
        .get("wordBreakdown")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(is_record)
                .filter_map(|item| {
                    let source = text(item.get("source"), "");
                    let target = text(item.get("target"), "");
                    (!source.is_empty() && !target.is_empty())
                        .then_some(TranslationBreakdownItem { source, target })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let version = fields
        .get("version")
        .and_then(Value::as_i64)
        .filter(|version| *version > 0);
    Some(TranslationSet {
        version,
        instruction_language: nullable_text(fields.get("instructionLanguage")),
        idiomatic,
        idiomatic_variants: variants,
        literal: text(fields.get("literal"), ""),
        word_for_word: text(fields.get("wordForWord"), ""),
        word_breakdown: breakdown,
    })
}

fn setup(value: Option<&Value>) -> Option<SessionSetup> {
    let parsed = match value {
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw).ok()?,
        Some(value) => value.clone(),
        None => return None,
    };
    let fields = is_record(&parsed)?;
    let target = text(fields.get("targetLanguage"), "");
    let instruction = text(fields.get("instructionLanguage"), "");
    language(&target)?;
    if !catalog()
        .instruction_languages
        .iter()
        .any(|candidate| candidate.id == instruction)
        || target == instruction
    {
        return None;
    }
    let pace = number(fields.get("targetSpeechPace"), DEFAULT_TARGET_SPEECH_PACE);
    Some(SessionSetup {
        target_language: target,
        instruction_language: instruction,
        tts_mode: if fields.get("ttsMode").and_then(Value::as_str) == Some("cloud") {
            String::from("cloud")
        } else {
            String::from("local")
        },
        tts_voice: text(fields.get("ttsVoice"), ""),
        explanation_voice: text(fields.get("explanationVoice"), ""),
        target_speech_pace: if SPEECH_PACES.contains(&pace) {
            pace
        } else {
            DEFAULT_TARGET_SPEECH_PACE
        },
    })
}

fn valid_category(value: &str) -> bool {
    matches!(value, "grammar" | "register" | "filler" | "style")
}

fn valid_severity(value: &str) -> bool {
    matches!(value, "error" | "warning" | "suggestion")
}

fn valid_exam_status(value: &str) -> bool {
    matches!(
        value,
        "strictly-avoid" | "avoid" | "use-sparingly" | "allowed"
    )
}

/// Merges one format-1 backup. Existing rows with the same ids are replaced;
/// unrelated local data is never cleared.
pub async fn import_legacy_json(
    json: &str,
    history: &dyn HistoryStore,
    records: &dyn RecordsStore,
    settings: Option<&dyn SettingsStore>,
    now: &str,
) -> Result<LegacyImportResult, LegacyImportError> {
    let decoded: Value = serde_json::from_str(json).map_err(|_| LegacyImportError::NotJson)?;
    let root = is_record(&decoded).ok_or(LegacyImportError::NotJson)?;
    if root.get("app").and_then(Value::as_str) != Some("onspot")
        || root.get("format").and_then(Value::as_i64) != Some(1)
    {
        return Err(LegacyImportError::WrongFormat);
    }

    let mut known_sessions: BTreeSet<String> = history
        .list_sessions()
        .await?
        .into_iter()
        .map(|session| session.id)
        .collect();
    let mut session_count = 0u32;

    for row in as_array(root.get("sessions")) {
        let id = text(row.get("id"), "");
        let title = text(row.get("title"), "");
        if id.is_empty() || title.is_empty() {
            continue;
        }
        let mode = match row.get("mode").and_then(Value::as_str) {
            Some("casual") => "casual",
            Some("freeflow") => "freeflow",
            _ => "exam",
        };
        records
            .put_session(&Session {
                id: id.clone(),
                title,
                mode: mode.to_owned(),
                started_at: text(row.get("startedAt"), now),
                ended_at: nullable_text(row.get("endedAt")),
                created_at: text(row.get("createdAt"), now),
                updated_at: text(row.get("updatedAt"), now),
                setup: setup(row.get("setup")),
            })
            .await?;
        known_sessions.insert(id);
        session_count += 1;
    }

    for row in as_array(root.get("prompts")) {
        let id = text(row.get("id"), "");
        let title = text(row.get("title"), "");
        let body = text(row.get("text"), "");
        if id.is_empty() || title.is_empty() || body.is_empty() {
            continue;
        }
        records
            .put_prompt(&Prompt {
                id,
                title,
                text: body,
                category: nullable_text(row.get("category")),
                language: Some(text(row.get("language"), "fr")),
                instruction_language: text(row.get("instructionLanguage"), "en"),
                created_at: text(row.get("createdAt"), now),
            })
            .await?;
    }

    let mut imported_attempts = BTreeSet::new();
    let mut attempt_count = 0u32;
    for row in as_array(root.get("attempts")) {
        let id = text(row.get("id"), "");
        let session_id = text(row.get("sessionId"), "");
        if id.is_empty() || !known_sessions.contains(&session_id) {
            continue;
        }
        records
            .put_attempt(&Attempt {
                id: id.clone(),
                session_id,
                prompt_id: nullable_text(row.get("promptId")),
                prompt_text: text(row.get("promptText"), ""),
                transcript: text(row.get("transcript"), ""),
                corrected_text: nullable_text(row.get("correctedText")),
                translation: nullable_text(row.get("translation")),
                translations: translation(row.get("translations")),
                tts_voice: nullable_text(row.get("ttsVoice")),
                explanation: nullable_text(row.get("explanation"))
                    .or_else(|| nullable_text(row.get("summary"))),
                follow_up: None,
                word_glosses: None,
                duration_sec: number(row.get("durationSec"), 0.0),
                word_count: integer(row.get("wordCount")).unwrap_or(0),
                audio_key: nullable_text(row.get("audioKey")),
                created_at: text(row.get("createdAt"), now),
                updated_at: text(row.get("updatedAt"), now),
            })
            .await?;
        imported_attempts.insert(id);
        attempt_count += 1;
    }

    let mut corrections_by_attempt: BTreeMap<String, Vec<Correction>> = BTreeMap::new();
    for row in as_array(root.get("corrections")) {
        let id = text(row.get("id"), "");
        let attempt_id = text(row.get("attemptId"), "");
        let category = text(row.get("category"), "");
        let severity = text(row.get("severity"), "");
        if id.is_empty()
            || !imported_attempts.contains(&attempt_id)
            || !valid_category(&category)
            || !valid_severity(&severity)
        {
            continue;
        }
        let exam_status = text(row.get("examStatus"), "");
        corrections_by_attempt
            .entry(attempt_id.clone())
            .or_default()
            .push(Correction {
                id,
                attempt_id,
                category,
                severity,
                label: text(row.get("label"), ""),
                original: text(row.get("original"), ""),
                replacement: text(row.get("replacement"), ""),
                replacement_translation: nullable_text(row.get("replacementTranslation")),
                start: integer(row.get("start")),
                end: integer(row.get("end")),
                explanation: text(row.get("explanation"), ""),
                speak_text: nullable_text(row.get("speakText")),
                exam_status: valid_exam_status(&exam_status).then_some(exam_status),
                formal_alternatives: strings(row.get("formalAlternatives")),
                sort_order: integer(row.get("sortOrder")).unwrap_or(0),
                created_at: text(row.get("createdAt"), now),
            });
    }
    let mut correction_count = 0u32;
    for (attempt_id, corrections) in &corrections_by_attempt {
        correction_count += corrections.len() as u32;
        records.replace_corrections(attempt_id, corrections).await?;
    }

    let mut recording_count = 0u32;
    for row in as_array(root.get("recordings")) {
        let attempt_id = text(row.get("attemptId"), "");
        let data_base64 = text(row.get("dataBase64"), "");
        if !imported_attempts.contains(&attempt_id) || data_base64.is_empty() {
            continue;
        }
        records
            .put_audio(&AudioAsset {
                key: format!("attempt:{attempt_id}"),
                attempt_id: Some(attempt_id),
                mime: text(row.get("mime"), "audio/webm"),
                data_base64,
                created_at: now.to_owned(),
            })
            .await?;
        recording_count += 1;
    }

    let mut setting_count = 0u32;
    if let Some(settings) = settings {
        for row in as_array(root.get("settings")) {
            let key = text(row.get("key"), "");
            let value = row.get("value").and_then(Value::as_str);
            if key.starts_with("onspot.setting.") {
                if let Some(value) = value {
                    settings.set(&key, value).await?;
                    setting_count += 1;
                }
            }
        }
    }

    Ok(LegacyImportResult {
        sessions: session_count,
        attempts: attempt_count,
        corrections: correction_count,
        recordings: recording_count,
        settings: setting_count,
    })
}
