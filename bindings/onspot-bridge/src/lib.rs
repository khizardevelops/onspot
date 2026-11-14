// SPDX-License-Identifier: AGPL-3.0-or-later

//! The one bridge between onspot's core and every driver.
//!
//! Holds the command dispatcher, the wire types and the per-transport glue. It
//! contains no business logic: every command forwards to a use case in
//! `onspot-app`. Contract and versioning rules are in
//! `docs/architecture/BRIDGE.md`; the event catalog itself lives in the app
//! crate (ADR-004) and is re-exported here.

pub mod commands;
pub mod error;
pub mod language;
pub mod portability;
pub mod practice;
pub mod storage;
pub mod sync;

#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(all(feature = "tauri", not(target_arch = "wasm32")))]
pub mod tauri_support;

pub use commands::{
    dispatch, init_response, initialize, InitResponse, PingRequest, PingResponse, PING_COMMAND,
};
pub use error::BridgeError;
pub use language::{
    LanguageCancelResponse, LanguageDownloadResponse, LanguageProgressResponse,
    LANGUAGE_CANCEL_DOWNLOAD, LANGUAGE_DOWNLOAD, LANGUAGE_DOWNLOAD_PROGRESS,
};
pub use onspot_app::{Core, CoreConfig, EventSink, HostAdapters, UiEvent};
pub use portability::{
    ExportDatabaseResponse, RestoreCancelResponse, RestoreConfirmResponse, RestorePickResponse,
    EXPORT_DATABASE, RESTORE_CANCEL, RESTORE_CONFIRM, RESTORE_PICK,
};
pub use practice::{
    AcceptedResponse, OpenResponse, PracticeResponse, ResumeResponse, CORE_HOST_REPLY,
    PRACTICE_AUDIO_LEVEL, PRACTICE_CANCEL_RECORDING, PRACTICE_CLEAR_ERROR, PRACTICE_CONFIGURE,
    PRACTICE_DELETE_SESSION, PRACTICE_NEW_SESSION, PRACTICE_NEXT_PROMPT, PRACTICE_OPEN_SESSION,
    PRACTICE_PLAY_RECORDING, PRACTICE_PLAY_SEGMENT, PRACTICE_RENAME_SESSION,
    PRACTICE_RESUME_LAST_SESSION, PRACTICE_SET_ACTIVE_ATTEMPT, PRACTICE_SET_ATTEMPT_VOICE,
    PRACTICE_SET_PROMPT, PRACTICE_SNAPSHOT, PRACTICE_SPEAK_TEXT, PRACTICE_SPEAK_TRACK,
    PRACTICE_START_RECORDING, PRACTICE_STOP_AND_ANALYZE, PRACTICE_STT_PROGRESS,
};
pub use storage::{
    AttemptPreviewView, ChangedResponse, HistoryResponse, HistorySessionView, SearchRequest,
    SessionView, SettingView, SettingsLoadResponse, SettingsPatchRequest, SettingsPatchResponse,
    SettingsResponse, SetupView, HISTORY_DELETE, HISTORY_LIST, HISTORY_RENAME, HISTORY_SEARCH,
    SETTINGS_GET, SETTINGS_LIST, SETTINGS_LOAD, SETTINGS_PATCH, SETTINGS_SET,
};
pub use sync::{
    SyncAccountResponse, SyncConnectResponse, SyncDisconnectResponse, SyncNowResponse, SyncTarget,
    SYNC_ACCOUNT, SYNC_CONNECT, SYNC_DISCONNECT, SYNC_NOW,
};

/// The bridge contract's version. Bumped only with a new envelope whose fields
/// or semantics a driver must know about; individual commands carry their own
/// payload versions later.
pub const BRIDGE_VERSION: &str = "bridge.v1";

#[cfg(test)]
mod tests {
    #[test]
    fn bridge_version_is_v1() {
        assert_eq!(crate::BRIDGE_VERSION, "bridge.v1");
    }
}
