// SPDX-License-Identifier: AGPL-3.0-or-later

//! Practice-loop capabilities: capture, speech-to-text, read-back and playback.
//!
//! The core owns the loop and chooses what to say; a host performs the audio
//! work. Audio crosses the boundary as bytes plus a MIME type, never as a
//! driver object. BYOK secrets stay in the driver: these requests name a mode
//! and a voice, and the host resolves the endpoint and key.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{CancelToken, CoreError};
use onspot_domain::LlmEndpoint;

/// A recorded or synthesized audio payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobHandle {
    /// Container MIME type, e.g. `audio/webm` or `audio/ogg`.
    pub mime: String,
    /// The encoded bytes.
    pub bytes: Vec<u8>,
}

/// One finished microphone take.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFrame {
    /// 16 kHz mono samples, ready for the recognizer.
    pub pcm: Vec<f32>,
    /// Sample rate of `pcm` (today always 16,000).
    pub sample_rate: u32,
    /// The take as recorded, for storage and cloud upload.
    pub blob: BlobHandle,
    /// Measured duration; wall-clock when the decoder cannot report one.
    pub duration_sec: f64,
}

/// A recognizer's text for a take.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
}

/// Download/load progress, in the shape the practice view already shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProgress {
    /// 0–100.
    pub progress: f32,
    /// Short status copy forwarded from the engine.
    pub status: String,
}

/// Whether a speech engine runs on the device or through a BYOK endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum EngineMode {
    Local,
    Cloud,
}

/// Capture limits for one take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    /// The practice limit, in seconds (today 60).
    pub max_seconds: u32,
}

/// What to transcribe and how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttOptions {
    /// Target language id; selects the model and decoder language.
    pub language_id: String,
    pub mode: EngineMode,
}

/// One piece of text the core decided to speak.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPiece {
    pub text: String,
    /// Language whose voice reads it.
    pub language_id: String,
    /// Chosen voice id; the host falls back to the language default.
    pub voice: String,
    pub mode: EngineMode,
    /// Playback pace chosen in Settings, `1.0` being normal.
    pub pace: f32,
    /// An existing attempt whose clip cache may hold this text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    /// Render again even when a cached clip exists.
    #[serde(default)]
    pub force: bool,
}

/// A synthesized clip, ready for playback or storage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Which spoken track of a take is playing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechTrack {
    Said,
    Corrected,
    Explanation,
    FollowUp,
    Segment,
    Recording,
    Correction,
}

/// One playback request for the shared player.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackRequest {
    pub attempt_id: String,
    pub track: SpeechTrack,
    /// Sentence text for a segment, or a label for other tracks.
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_index: Option<u32>,
    pub clip: AudioClip,
}

/// Receives live microphone levels while a take is recording.
#[cfg(not(target_arch = "wasm32"))]
pub trait AudioLevelSink: Send + Sync {
    /// Reports a 0..1 level.
    fn level(&self, level: f32);
}

/// Receives live microphone levels while a take is recording.
#[cfg(target_arch = "wasm32")]
pub trait AudioLevelSink {
    /// Reports a 0..1 level.
    fn level(&self, level: f32);
}

/// Receives recognizer progress.
#[cfg(not(target_arch = "wasm32"))]
pub trait SttProgressSink: Send + Sync {
    /// Reports model download/load progress.
    fn progress(&self, progress: &ModelProgress);
}

/// Receives recognizer progress.
#[cfg(target_arch = "wasm32")]
pub trait SttProgressSink {
    /// Reports model download/load progress.
    fn progress(&self, progress: &ModelProgress);
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::sync::Arc;

    use async_trait::async_trait;

    use super::*;

    /// Opens and closes the microphone for one take.
    #[async_trait]
    pub trait AudioCapture: Send + Sync {
        /// Opens the microphone and starts metering.
        async fn start(
            &self,
            options: &CaptureOptions,
            levels: Arc<dyn AudioLevelSink>,
        ) -> Result<(), CoreError>;

        /// Ends the take and returns its encoded and 16 kHz forms.
        async fn stop(&self) -> Result<AudioFrame, CoreError>;

        /// Stops without producing a take. Idempotent.
        async fn cancel(&self) -> Result<(), CoreError>;
    }

    /// Turns a take into text, locally or through a BYOK endpoint.
    #[async_trait]
    pub trait SttEngine: Send + Sync {
        /// Transcribes one take, reporting download/load progress.
        async fn transcribe(
            &self,
            frame: &AudioFrame,
            options: &SttOptions,
            progress: &dyn SttProgressSink,
            token: &CancelToken,
        ) -> Result<Transcript, CoreError>;
    }

    /// Synthesizes one text piece with the chosen voice.
    #[async_trait]
    pub trait TtsEngine: Send + Sync {
        /// Returns one playable clip.
        async fn synthesize(
            &self,
            piece: &SpeechPiece,
            token: &CancelToken,
        ) -> Result<AudioClip, CoreError>;
    }

    /// Plays clips through the shared player.
    #[async_trait]
    pub trait AudioPlayback: Send + Sync {
        /// Unlocks playback inside a user gesture.
        fn prime(&self);

        /// Starts one clip. A newer request stops the previous clip.
        async fn play(&self, request: PlaybackRequest) -> Result<(), CoreError>;

        /// Stops the current clip. Idempotent.
        fn stop(&self);
    }

    /// Monotonic time and cancellable sleeping.
    #[async_trait]
    pub trait Clock: Send + Sync {
        /// Milliseconds since an arbitrary fixed point.
        fn now_ms(&self) -> u64;

        /// Waits for `milliseconds`; `false` when the token cancelled the wait.
        async fn sleep(&self, milliseconds: u64, token: &CancelToken) -> bool;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use std::sync::Arc;

    use async_trait::async_trait;

    use super::*;

    /// Opens and closes the microphone for one take.
    #[async_trait(?Send)]
    pub trait AudioCapture {
        /// Opens the microphone and starts metering.
        async fn start(
            &self,
            options: &CaptureOptions,
            levels: Arc<dyn AudioLevelSink>,
        ) -> Result<(), CoreError>;

        /// Ends the take and returns its encoded and 16 kHz forms.
        async fn stop(&self) -> Result<AudioFrame, CoreError>;

        /// Stops without producing a take. Idempotent.
        async fn cancel(&self) -> Result<(), CoreError>;
    }

    /// Turns a take into text, locally or through a BYOK endpoint.
    #[async_trait(?Send)]
    pub trait SttEngine {
        /// Transcribes one take, reporting download/load progress.
        async fn transcribe(
            &self,
            frame: &AudioFrame,
            options: &SttOptions,
            progress: &dyn SttProgressSink,
            token: &CancelToken,
        ) -> Result<Transcript, CoreError>;
    }

    /// Synthesizes one text piece with the chosen voice.
    #[async_trait(?Send)]
    pub trait TtsEngine {
        /// Returns one playable clip.
        async fn synthesize(
            &self,
            piece: &SpeechPiece,
            token: &CancelToken,
        ) -> Result<AudioClip, CoreError>;
    }

    /// Plays clips through the shared player.
    #[async_trait(?Send)]
    pub trait AudioPlayback {
        /// Unlocks playback inside a user gesture.
        fn prime(&self);

        /// Starts one clip. A newer request stops the previous clip.
        async fn play(&self, request: PlaybackRequest) -> Result<(), CoreError>;

        /// Stops the current clip. Idempotent.
        fn stop(&self);
    }

    /// Monotonic time and cancellable sleeping.
    #[async_trait(?Send)]
    pub trait Clock {
        /// Milliseconds since an arbitrary fixed point.
        fn now_ms(&self) -> u64;

        /// Waits for `milliseconds`; `false` when the token cancelled the wait.
        async fn sleep(&self, milliseconds: u64, token: &CancelToken) -> bool;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::{AudioCapture, AudioPlayback, Clock, SttEngine, TtsEngine};
#[cfg(target_arch = "wasm32")]
pub use web::{AudioCapture, AudioPlayback, Clock, SttEngine, TtsEngine};

/// A prompt the model wrote, ready to store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPrompt {
    pub title: String,
    pub text: String,
}

/// What the next prompt should be about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub target_language_id: String,
    pub target_language: String,
    pub instruction_language_id: String,
    pub instruction_language: String,
    /// The Unicode scripts the instruction language uses.
    #[serde(default)]
    pub instruction_scripts: Vec<String>,
    /// CEFR-ish level id from Settings.
    pub level: String,
    /// `exam`, `casual` or `freeflow`.
    pub mode: String,
    /// Recent titles to avoid.
    pub avoid_topics: Vec<String>,
    /// The learner's configured LLM, without a key.
    pub endpoint: LlmEndpoint,
}

/// Writes a prompt through the learner's LLM, when configured.
///
/// Prompt text and catalogue data stay in the driver during P3 (P7 moves the
/// catalogue); the core still chooses when a prompt is needed and what to do
/// when none can be written.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
pub trait PromptSource: Send + Sync {
    /// Returns a new prompt, or `None` when no model is configured or it failed.
    async fn write(
        &self,
        request: &PromptRequest,
        token: &CancelToken,
    ) -> Result<Option<GeneratedPrompt>, CoreError>;
}

/// Writes a prompt through the learner's LLM, when configured.
#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
pub trait PromptSource {
    /// Returns a new prompt, or `None` when no model is configured or it failed.
    async fn write(
        &self,
        request: &PromptRequest,
        token: &CancelToken,
    ) -> Result<Option<GeneratedPrompt>, CoreError>;
}

/// Judges one take.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
pub trait EvaluationPort: Send + Sync {
    /// Returns the validated evaluation, or a stable failure code.
    async fn evaluate(
        &self,
        request: &onspot_domain::EvaluationRequest,
        token: &CancelToken,
    ) -> Result<onspot_domain::EvaluationResult, CoreError>;
}

/// Judges one take.
#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
pub trait EvaluationPort {
    /// Returns the validated evaluation, or a stable failure code.
    async fn evaluate(
        &self,
        request: &onspot_domain::EvaluationRequest,
        token: &CancelToken,
    ) -> Result<onspot_domain::EvaluationResult, CoreError>;
}

/// Generates ids and nondeterministic choices.
///
/// Tests supply a counter; the drivers use `crypto.randomUUID` and
/// `crypto.getRandomValues`. Keeping this outward makes fixtures and scenario
/// tests deterministic without freezing production ids.
#[cfg(not(target_arch = "wasm32"))]
pub trait IdSource: Send + Sync {
    /// A new id with a readable prefix, e.g. `attempt-…`.
    fn new_id(&self, prefix: &str) -> String;

    /// A uniform index in `0..upper`; `0` when `upper` is zero.
    fn random_index(&self, upper: usize) -> usize;
}

/// Generates ids and nondeterministic choices.
#[cfg(target_arch = "wasm32")]
pub trait IdSource {
    /// A new id with a readable prefix, e.g. `attempt-…`.
    fn new_id(&self, prefix: &str) -> String;

    /// A uniform index in `0..upper`; `0` when `upper` is zero.
    fn random_index(&self, upper: usize) -> usize;
}
