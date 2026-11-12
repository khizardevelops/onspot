// SPDX-License-Identifier: AGPL-3.0-or-later

//! The driver-supplied settings one practice run needs.
//!
//! Typed `AppSettings` stays in TypeScript until P7 (ADR-008), so the driver
//! hands the core this narrow snapshot whenever it changes. It contains no
//! secret and no provider endpoint.

use onspot_domain::LlmEndpoint;
use onspot_ports::EngineMode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The language, level and voice choices for the open session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PracticeConfig {
    /// Target language id, e.g. `fr`.
    pub target_language_id: String,
    /// Target language name, e.g. `French`.
    pub target_language_name: String,
    /// Language of instruction id, e.g. `en`.
    pub instruction_language_id: String,
    /// Language of instruction name, e.g. `English`.
    pub instruction_language_name: String,
    /// CEFR-ish level id from Settings.
    pub level: String,
    /// Default tone for a new draft; an open session keeps its recorded mode.
    pub mode: String,
    pub tts_mode: EngineMode,
    /// Speech-to-text path for the take.
    pub stt_mode: EngineMode,
    pub tts_voice: String,
    pub explanation_voice: String,
    /// The LLM endpoint chosen in Settings (no API key).
    pub llm_endpoint: LlmEndpoint,
    /// Playback pace, `1.0` being normal.
    pub pace: f32,
    /// Whether the explanation track can be spoken with the current voices.
    pub explanation_audio_available: bool,
    /// The take limit, today 60 seconds.
    pub max_seconds: u32,
}
