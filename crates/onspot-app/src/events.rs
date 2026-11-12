// SPDX-License-Identifier: AGPL-3.0-or-later

//! The events the core sends to a driver, and the sink a driver supplies.
//!
//! The catalog lives here rather than in the bridge (a small deviation from the
//! master prompt, recorded in ADR-004): a use case must be able to emit an event
//! without depending on a driver-facing crate, and the dependency arrows only
//! point inward. `onspot-bridge` re-exports these types and serializes them for
//! each transport.
//!
//! Events are additive. A driver that meets an unknown `event` value ignores it.

use serde::Serialize;
use ts_rs::TS;

use crate::practice::PracticeSnapshot;

/// Something a driver shows or records. Serialized with a `event` tag, e.g.
/// `{ "event": "pong", "seq": 2 }`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum UiEvent {
    /// The bridge is alive; `seq` increases with every event the core emits.
    Pong { seq: u32 },
    /// A recoverable failure the driver should map to learner-facing copy.
    Error { code: String, message: String },
    /// One or more settings rows changed; drivers re-read the snapshot.
    SettingsChanged { seq: u32 },
    /// A session was renamed or deleted; drivers reload the history list.
    HistoryChanged { seq: u32 },
    /// The whole practice view changed; drivers replace their snapshot.
    PracticeStateChanged { snapshot: Box<PracticeSnapshot> },
    /// Live microphone level while recording, 0..1.
    AudioLevel { level: f32 },
    /// Recognizer download/load progress.
    TranscriptionProgress { progress: f32, status: String },
    /// The take is being judged.
    EvaluationStarted,
    /// One take finished and its rows were written.
    AttemptPersisted { attempt_id: String },
    /// The take held no speech; nothing was sent to the recognizer.
    TakeSilent,
    /// Play this track through the host's audio graph.
    SpeakTrack { attempt_id: String, kind: String },
    /// Play one sentence of a take's corrected text.
    PlaySegment {
        attempt_id: String,
        text: String,
        index: u32,
    },
    /// Speak arbitrary text (a correction or a practice phrase).
    SpeakText { text: String },
    /// Play the take's stored recording.
    PlayRecording { attempt_id: String },
    /// The core asks the driver to perform one host operation and reply.
    HostRequest {
        id: u32,
        method: String,
        /// JSON-encoded arguments.
        payload: String,
    },
}

/// Where the core delivers its events.
///
/// The sink is thread-safe on native targets because a Tauri command can be
/// called from any runtime thread. On wasm the sink is a JavaScript callback,
/// which is single-threaded, so the bounds are deliberately weaker there.
#[cfg(not(target_arch = "wasm32"))]
pub trait EventSink: Send + Sync {
    /// Delivers one event. A sink must not block; a driver that cannot keep up
    /// drops events rather than stalling the core.
    fn emit(&self, event: &UiEvent);
}

/// Where the core delivers its events (wasm: same-thread JavaScript callback).
#[cfg(target_arch = "wasm32")]
pub trait EventSink {
    /// Delivers one event.
    fn emit(&self, event: &UiEvent);
}
