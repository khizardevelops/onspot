// SPDX-License-Identifier: AGPL-3.0-or-later

//! The port traits: one per outward capability (LLM, STT, TTS, capture,
//! playback, SQL, secrets, HTTP, OAuth, blobs, clock, ids, notifications,
//! events, repositories).
//!
//! Every port is async and object-safe so a use case can hold `dyn` and a test
//! can supply a fake. The catalog and the adapter that implements each port
//! today are in `docs/architecture/PORTS.md`.
//!
//! P2 adds `SqlDriver` and the history/settings repository ports it backs.
//! P3 adds cancellation, the stable error shape and the practice audio ports.

pub mod device;
mod error;
pub mod files;
pub mod language_data;
pub mod llm;
pub mod practice;
pub mod sql;
pub mod sync;
mod token;

pub use device::DeviceStore;
pub use error::CoreError;
pub use files::{DatabaseFile, FileSystemSink, PickedFile, RestoreCounts};
pub use language_data::{DownloadProgressSink, LanguageDataInstaller};
pub use llm::{
    HttpBytesRequest, HttpBytesResponse, HttpClient, HttpRequest, HttpResponse, LlmProvider,
    PromptTopicRequest,
};
pub use practice::{
    AudioCapture, AudioClip, AudioFrame, AudioLevelSink, AudioPlayback, BlobHandle, CaptureOptions,
    Clock, EngineMode, EvaluationPort, GeneratedPrompt, IdSource, ModelProgress, PlaybackRequest,
    PromptRequest, PromptSource, SpeechPiece, SpeechTrack, SttEngine, SttOptions, SttProgressSink,
    Transcript, TtsEngine,
};
pub use token::{CancelToken, CANCELLED_CODE};

pub use sql::{
    HistoryStore, RecordsStore, SettingsStore, SqlDriver, SqlError, SqlRow, SqlStatement, SqlValue,
    StoreError,
};
pub use sync::{OAuthBroker, RemoteSnapshot, SyncAccount, SyncProvider, SyncStore};
