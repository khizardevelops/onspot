// SPDX-License-Identifier: AGPL-3.0-or-later

//! The evaluation result the practice loop persists.
//!
//! The LLM adapter owns prompt rendering, JSON repair and model quirks; these
//! are the validated shapes the application sees. Categories and severities
//! stay as the stored strings (`grammar`, `error`, …) so the repository and the
//! existing copy do not change.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::FollowUp;

/// Which OpenAI-compatible endpoint and model to call.
///
/// The API key is never here: the host adds it from its `SecretStore` when the
/// HTTP request crosses the bridge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpoint {
    /// Base URL up to but excluding `/chat/completions`.
    pub base_url: String,
    /// Provider id (`groq`, `deepseek`, `custom`) used by the host to pick a key.
    pub provider: String,
    pub model: String,
    /// Models to continue with when the preferred one is out of room.
    #[serde(default)]
    pub fallback_models: Vec<String>,
    /// A short hash of the key the host will add (`keyIdOf` in the driver),
    /// never the key itself. The usage ledger and the rate-limit pacing count
    /// per key, so two accounts on one provider never share a budget.
    #[serde(default)]
    pub key_id: String,
}

/// What the core asks an evaluation adapter to judge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRequest {
    /// What the recognizer heard.
    pub transcript: String,
    /// The prompt the learner answered.
    pub prompt: String,
    /// `exam`, `casual` or `freeflow`.
    pub mode: String,
    /// CEFR-ish level id from Settings.
    pub level: String,
    /// Target language name, e.g. `French`.
    pub language: String,
    /// Language of instruction name, e.g. `English`.
    pub translation_target: String,
    /// The endpoint and model chosen in Settings.
    pub endpoint: LlmEndpoint,
}

/// One correction the model proposed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationCorrection {
    pub category: String,
    pub severity: String,
    pub label: String,
    pub original: String,
    pub replacement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_translation: Option<String>,
    pub explanation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speak_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exam_status: Option<String>,
    #[serde(default)]
    pub formal_alternatives: Vec<String>,
}

/// A vocabulary upgrade.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularySuggestion {
    pub original: String,
    pub suggestion: String,
    pub why: String,
}

/// A connector upgrade.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSuggestion {
    pub connector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instead_of: Option<String>,
    pub why: String,
}

/// The validated result of one evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationResult {
    /// The faithful corrected version; equals the transcript when nothing was wrong.
    pub corrected_text: String,
    /// Spoken coaching markup in the language of instruction.
    pub explanation: String,
    pub follow_up: Option<FollowUp>,
    pub corrections: Vec<EvaluationCorrection>,
    pub vocabulary: Vec<VocabularySuggestion>,
    pub connectors: Vec<ConnectorSuggestion>,
}
