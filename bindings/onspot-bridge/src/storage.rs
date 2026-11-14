// SPDX-License-Identifier: AGPL-3.0-or-later

//! The storage commands: settings rows and the history read path.
//!
//! Each command forwards to a service in `onspot-app` and marshals its result.
//! Mutations emit the change event the driver subscribes to.

use std::collections::BTreeMap;

use onspot_app::{AppSettings, HistoryService, SettingsService};
use onspot_domain::{AttemptPreview, Session, SessionSetup, Setting};
use onspot_ports::{HistoryStore, SettingsStore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::commands::serialize;
use crate::error::BridgeError;
use crate::Core;

pub const HISTORY_LIST: &str = "history.list";
pub const HISTORY_SEARCH: &str = "history.search";
pub const HISTORY_RENAME: &str = "history.rename";
pub const HISTORY_DELETE: &str = "history.delete";
pub const SETTINGS_LIST: &str = "settings.list";
pub const SETTINGS_GET: &str = "settings.get";
pub const SETTINGS_SET: &str = "settings.set";
pub const SETTINGS_LOAD: &str = "settings.load";
pub const SETTINGS_PATCH: &str = "settings.patch";

/// A session as the history screen receives it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub setup: Option<SetupView>,
}

/// The stored session setup.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SetupView {
    pub target_language: String,
    pub instruction_language: String,
    pub tts_mode: String,
    pub tts_voice: String,
    pub explanation_voice: String,
    pub target_speech_pace: f64,
}

/// One take's searchable preview.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct AttemptPreviewView {
    pub id: String,
    pub session_id: String,
    pub transcript: String,
    pub duration_sec: f64,
    pub audio_key: Option<String>,
    pub created_at: String,
}

/// A session together with its takes.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct HistorySessionView {
    pub session: SessionView,
    pub attempts: Vec<AttemptPreviewView>,
}

/// The history commands' shared response.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub sessions: Vec<HistorySessionView>,
}

/// `history.search` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
}

/// `history.rename` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRequest {
    pub session_id: String,
    pub title: String,
}

/// `history.delete` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub session_id: String,
}

/// Whether a rename or delete matched a row.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ChangedResponse {
    pub changed: bool,
}

/// One settings row.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SettingView {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

/// `settings.list` response.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    pub settings: Vec<SettingView>,
}

/// `settings.get` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingKeyRequest {
    pub key: String,
}

/// `settings.get` response.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SettingValueResponse {
    pub value: Option<String>,
}

/// `settings.set` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingSetRequest {
    pub key: String,
    pub value: String,
}

/// `settings.load` response: the normalised document and the rows it was
/// built from (after the Automatic-model migration writes).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadResponse {
    pub settings: AppSettings,
    pub rows: Vec<SettingView>,
}

/// `settings.patch` arguments: field name to JSON-encoded value.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatchRequest {
    pub patch: BTreeMap<String, String>,
}

/// `settings.patch` response.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatchResponse {
    pub settings: AppSettings,
    pub changed: bool,
}

/// Runs one storage command, or reports that it is not a storage command.
pub async fn dispatch(
    core: &Core,
    command: &str,
    payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        HISTORY_LIST => history_list(core).await.and_then(serialize),
        HISTORY_SEARCH => history_search(core, payload).await.and_then(serialize),
        HISTORY_RENAME => history_rename(core, payload).await.and_then(serialize),
        HISTORY_DELETE => history_delete(core, payload).await.and_then(serialize),
        SETTINGS_LIST => settings_list(core).await.and_then(serialize),
        SETTINGS_GET => settings_get(core, payload).await.and_then(serialize),
        SETTINGS_SET => settings_set(core, payload).await.and_then(serialize),
        SETTINGS_LOAD => settings_load(core).await.and_then(serialize),
        SETTINGS_PATCH => settings_patch(core, payload).await.and_then(serialize),
        _ => return None,
    };
    Some(result)
}

fn history_store(core: &Core) -> Result<&dyn HistoryStore, BridgeError> {
    core.hosts()
        .history
        .as_deref()
        .ok_or_else(|| BridgeError::unavailable("history"))
}

fn settings_store(core: &Core) -> Result<&dyn SettingsStore, BridgeError> {
    core.hosts()
        .settings
        .as_deref()
        .ok_or_else(|| BridgeError::unavailable("settings"))
}

async fn history_list(core: &Core) -> Result<HistoryResponse, BridgeError> {
    let store = history_store(core)?;
    let service = HistoryService::new(store);
    let sessions = service.list().await.map_err(store_error)?;
    Ok(HistoryResponse {
        sessions: sessions.iter().map(history_view).collect(),
    })
}

async fn history_search(core: &Core, payload: Value) -> Result<HistoryResponse, BridgeError> {
    let request: SearchRequest = parse(HISTORY_SEARCH, payload)?;
    let store = history_store(core)?;
    let service = HistoryService::new(store);
    let sessions = service
        .search(&request.query, request.regex, request.case_sensitive)
        .await
        .map_err(|error| match error {
            onspot_app::HistoryError::Search(error) => BridgeError::new(
                "history.invalid_regex",
                format!("the search expression is invalid: {error}"),
            ),
            onspot_app::HistoryError::Store(error) => store_error(error),
        })?;
    Ok(HistoryResponse {
        sessions: sessions.iter().map(history_view).collect(),
    })
}

async fn history_rename(core: &Core, payload: Value) -> Result<ChangedResponse, BridgeError> {
    let request: RenameRequest = parse(HISTORY_RENAME, payload)?;
    let store = history_store(core)?;
    let service = HistoryService::new(store);
    let changed = service
        .rename(&request.session_id, &request.title)
        .await
        .map_err(store_error)?;
    if changed {
        let sequence = core.next_sequence();
        core.emit(onspot_app::UiEvent::HistoryChanged { seq: sequence });
    }
    Ok(ChangedResponse { changed })
}

async fn history_delete(core: &Core, payload: Value) -> Result<ChangedResponse, BridgeError> {
    let request: SessionRequest = parse(HISTORY_DELETE, payload)?;
    let store = history_store(core)?;
    let service = HistoryService::new(store);
    let changed = service
        .delete(&request.session_id)
        .await
        .map_err(store_error)?;
    if changed {
        let sequence = core.next_sequence();
        core.emit(onspot_app::UiEvent::HistoryChanged { seq: sequence });
    }
    Ok(ChangedResponse { changed })
}

async fn settings_list(core: &Core) -> Result<SettingsResponse, BridgeError> {
    let store = settings_store(core)?;
    let service = SettingsService::new(store);
    let settings = service.list().await.map_err(store_error)?;
    Ok(SettingsResponse {
        settings: settings.iter().map(setting_view).collect(),
    })
}

async fn settings_get(core: &Core, payload: Value) -> Result<SettingValueResponse, BridgeError> {
    let request: SettingKeyRequest = parse(SETTINGS_GET, payload)?;
    let store = settings_store(core)?;
    let service = SettingsService::new(store);
    let value = service.get(&request.key).await.map_err(store_error)?;
    Ok(SettingValueResponse { value })
}

async fn settings_set(core: &Core, payload: Value) -> Result<ChangedResponse, BridgeError> {
    let request: SettingSetRequest = parse(SETTINGS_SET, payload)?;
    let store = settings_store(core)?;
    let service = SettingsService::new(store);
    service
        .set(&request.key, &request.value)
        .await
        .map_err(store_error)?;
    let sequence = core.next_sequence();
    core.emit(onspot_app::UiEvent::SettingsChanged { seq: sequence });
    Ok(ChangedResponse { changed: true })
}

async fn settings_load(core: &Core) -> Result<SettingsLoadResponse, BridgeError> {
    let store = settings_store(core)?;
    let service = SettingsService::new(store);
    let (loaded, rows) = service.load_document().await.map_err(store_error)?;
    Ok(SettingsLoadResponse {
        settings: loaded.settings,
        rows: rows.iter().map(setting_view).collect(),
    })
}

async fn settings_patch(core: &Core, payload: Value) -> Result<SettingsPatchResponse, BridgeError> {
    let request: SettingsPatchRequest = parse(SETTINGS_PATCH, payload)?;
    let store = settings_store(core)?;
    let service = SettingsService::new(store);
    let result = service
        .patch_document(&request.patch)
        .await
        .map_err(store_error)?;
    if result.changed {
        let sequence = core.next_sequence();
        core.emit(onspot_app::UiEvent::SettingsChanged { seq: sequence });
    }
    Ok(SettingsPatchResponse {
        settings: result.settings,
        changed: result.changed,
    })
}

fn parse<T: for<'de> Deserialize<'de>>(command: &str, payload: Value) -> Result<T, BridgeError> {
    serde_json::from_value(payload).map_err(|error| BridgeError::invalid_payload(command, error))
}

fn store_error(error: onspot_ports::StoreError) -> BridgeError {
    BridgeError::new("storage.failed", error.message)
}

fn history_view(entry: &onspot_app::HistorySession) -> HistorySessionView {
    HistorySessionView {
        session: session_view(&entry.session),
        attempts: entry.attempts.iter().map(preview_view).collect(),
    }
}

fn session_view(session: &Session) -> SessionView {
    SessionView {
        id: session.id.clone(),
        title: session.title.clone(),
        mode: session.mode.clone(),
        started_at: session.started_at.clone(),
        ended_at: session.ended_at.clone(),
        created_at: session.created_at.clone(),
        updated_at: session.updated_at.clone(),
        setup: session.setup.as_ref().map(setup_view),
    }
}

fn setup_view(setup: &SessionSetup) -> SetupView {
    SetupView {
        target_language: setup.target_language.clone(),
        instruction_language: setup.instruction_language.clone(),
        tts_mode: setup.tts_mode.clone(),
        tts_voice: setup.tts_voice.clone(),
        explanation_voice: setup.explanation_voice.clone(),
        target_speech_pace: setup.target_speech_pace,
    }
}

fn preview_view(preview: &AttemptPreview) -> AttemptPreviewView {
    AttemptPreviewView {
        id: preview.id.clone(),
        session_id: preview.session_id.clone(),
        transcript: preview.transcript.clone(),
        duration_sec: preview.duration_sec,
        audio_key: preview.audio_key.clone(),
        created_at: preview.created_at.clone(),
    }
}

fn setting_view(setting: &Setting) -> SettingView {
    SettingView {
        key: setting.key.clone(),
        value: setting.value.clone(),
        updated_at: setting.updated_at.clone(),
    }
}
