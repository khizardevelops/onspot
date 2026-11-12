// SPDX-License-Identifier: AGPL-3.0-or-later

//! What the practice screen renders, computed by the core.
//!
//! Session and attempt rows stay domain types; the view adds the correction
//! list the card shows and the derived flags the screen used to compute. It is
//! internal until the bridge generates its wire mirror.

use onspot_domain::{Attempt, Correction, Prompt};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The only phases a take can be in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PracticePhase {
    Idle,
    Recording,
    Transcribing,
    Evaluating,
    Error,
}

/// The prompt the learner answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PromptView {
    pub id: String,
    pub title: String,
    pub text: String,
    /// True when an English catalogue entry is shown for lack of a prompt in
    /// the language of instruction.
    pub english_fallback: bool,
}

impl From<&Prompt> for PromptView {
    fn from(prompt: &Prompt) -> Self {
        Self {
            id: prompt.id.clone(),
            title: prompt.title.clone(),
            text: prompt.text.clone(),
            english_fallback: false,
        }
    }
}

/// One take as the card renders it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct AttemptView {
    pub attempt: Attempt,
    pub corrections: Vec<Correction>,
}

/// A learner-facing error with its stable code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ErrorView {
    pub code: String,
    pub message: String,
}

/// Recognizer download/load progress as the screen shows it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProgressView {
    /// 0–100.
    pub progress: f32,
    /// Short status copy forwarded from the engine.
    pub status: String,
}

impl From<onspot_ports::ModelProgress> for ProgressView {
    fn from(progress: onspot_ports::ModelProgress) -> Self {
        Self {
            progress: progress.progress,
            status: progress.status,
        }
    }
}

/// The complete practice snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PracticeSnapshot {
    pub phase: PracticePhase,
    pub prompt: PromptView,
    /// Tone for the session; locked once a session row exists.
    pub mode: String,
    pub elapsed_seconds: f64,
    /// Microphone level, 0..1.
    pub level: f32,
    pub progress: Option<ProgressView>,
    pub status_text: String,
    pub error: Option<ErrorView>,
    pub session_id: Option<String>,
    pub attempts: Vec<AttemptView>,
    pub active_attempt_id: Option<String>,
    /// Whether the explanation track can be spoken now.
    pub explanation_audio_available: bool,
}

impl PracticeSnapshot {
    /// The empty draft before any prompt is chosen.
    pub fn empty(mode: impl Into<String>) -> Self {
        Self {
            phase: PracticePhase::Idle,
            prompt: PromptView {
                id: String::new(),
                title: String::new(),
                text: String::new(),
                english_fallback: false,
            },
            mode: mode.into(),
            elapsed_seconds: 0.0,
            level: 0.0,
            progress: None,
            status_text: String::new(),
            error: None,
            session_id: None,
            attempts: Vec::new(),
            active_attempt_id: None,
            explanation_audio_available: false,
        }
    }

    /// Replaces the prompt, keeping the current tone and takes.
    pub fn with_prompt(mut self, prompt: PromptView) -> Self {
        self.prompt = prompt;
        self
    }
}
