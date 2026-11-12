// SPDX-License-Identifier: AGPL-3.0-or-later

//! The remaining storage-facing records moved in P2.
//!
//! Field names and JSON shapes match `src/lib/adapters/db/types.ts` after the
//! camelCase wire rename. The database columns stay snake_case and are mapped
//! by the repositories, exactly as the legacy adapter maps them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A speaking prompt: a bundled catalogue entry or one generated for a learner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct Prompt {
    pub id: String,
    pub title: String,
    pub text: String,
    pub category: Option<String>,
    /// Target language id this prompt belongs to (ISO 639-1).
    pub language: Option<String>,
    /// Instruction language id the title and text are written in.
    pub instruction_language: String,
    pub created_at: String,
}

/// One token/morpheme mapping inside a translation set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct TranslationBreakdownItem {
    pub source: String,
    pub target: String,
}

/// The three ways to render the learner's sentence, plus the token mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct TranslationSet {
    /// Format version; missing on attempts from before the stricter prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// Language of instruction it is written in; missing means English.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction_language: Option<String>,
    pub idiomatic: String,
    pub idiomatic_variants: Vec<String>,
    pub literal: String,
    pub word_for_word: String,
    pub word_breakdown: Vec<TranslationBreakdownItem>,
}

/// The follow-up question and its meaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct FollowUp {
    pub question: String,
    pub translation: String,
}

/// The meaning of several words read together; `end` is inclusive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct PhraseGloss {
    pub start: i64,
    pub end: i64,
    pub meaning: String,
    /// `expression` or `selection`, kept as the stored string.
    pub origin: String,
}

/// A range of a text's word tokens; `end` inclusive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct GlossedRange {
    pub start: i64,
    pub end: i64,
}

/// One text's hover translations: a meaning per word token, and its phrases.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct TextGlosses {
    pub words: Vec<String>,
    pub phrases: Vec<PhraseGloss>,
    /// Part-of-speech label per word token, parallel to `words`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<Vec<String>>,
    /// The sections whose POS labels have been fetched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos_sections: Option<Vec<GlossedRange>>,
    /// The sections whose meanings have been fetched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sections: Option<Vec<GlossedRange>>,
}

/// Hover translations per text of an attempt, keyed by a hash of the text.
pub type WordGlosses = BTreeMap<String, TextGlosses>;

/// One recorded answer inside a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct Attempt {
    pub id: String,
    pub session_id: String,
    pub prompt_id: Option<String>,
    pub prompt_text: String,
    pub transcript: String,
    pub corrected_text: Option<String>,
    pub translation: Option<String>,
    pub translations: Option<TranslationSet>,
    pub tts_voice: Option<String>,
    pub explanation: Option<String>,
    pub follow_up: Option<FollowUp>,
    pub word_glosses: Option<WordGlosses>,
    pub duration_sec: f64,
    #[ts(type = "number")]
    pub word_count: i64,
    pub audio_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One correction the LLM produced for an attempt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct Correction {
    pub id: String,
    pub attempt_id: String,
    pub category: String,
    pub severity: String,
    pub label: String,
    pub original: String,
    pub replacement: String,
    pub replacement_translation: Option<String>,
    /// Character offsets of `original` in the attempt transcript.
    #[ts(type = "number | null")]
    pub start: Option<i64>,
    #[ts(type = "number | null")]
    pub end: Option<i64>,
    pub explanation: String,
    pub speak_text: Option<String>,
    pub exam_status: Option<String>,
    pub formal_alternatives: Vec<String>,
    #[ts(type = "number")]
    pub sort_order: i64,
    pub created_at: String,
}

/// Stored microphone audio. Base64 text keeps both drivers portable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct AudioAsset {
    pub key: String,
    pub attempt_id: Option<String>,
    pub mime: String,
    pub data_base64: String,
    pub created_at: String,
}

/// A generated prompt waiting to be sent to the shared prompt database.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct PromptSubmission {
    pub id: String,
    pub title: String,
    pub text: String,
    pub instruction_language: String,
    pub target_language: String,
    pub level: String,
    pub mode: String,
    pub created_at: String,
    pub attempts: i64,
    pub last_attempt_at: Option<String>,
    pub last_error: Option<String>,
}

/// Sync bookkeeping for one BYOC provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct SyncMetadata {
    pub provider: String,
    pub remote_file_id: Option<String>,
    pub etag: Option<String>,
    pub last_synced_at: Option<String>,
    pub cursor: Option<String>,
    pub updated_at: String,
}
