// SPDX-License-Identifier: AGPL-3.0-or-later

//! The record reads and writes screens need outside a practice run: a
//! session's setup, the reminder's last practice, cached speech audio and a
//! sync provider's metadata. Each command only marshals; the rules are in
//! `onspot-app`.

use std::sync::Arc;

use onspot_app::{AppSettings, Core, SettingsService};
use onspot_domain::{AudioAsset, SessionSetup, SyncMetadata};
use onspot_ports::{HistoryStore, RecordsStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::commands::serialize;
use crate::error::BridgeError;

pub const SESSIONS_LATEST_SETUP: &str = "sessions.latest_setup";
pub const SESSIONS_OPEN_SETUP: &str = "sessions.open_setup";
pub const SESSIONS_SAVE_SETUP: &str = "sessions.save_setup";
pub const REMINDERS_LAST_PRACTISED: &str = "reminders.last_practised";
pub const AUDIO_GET: &str = "audio.get";
pub const AUDIO_PUT: &str = "audio.put";
pub const SYNC_METADATA: &str = "sync.metadata";

/// The newest session and the setup it was practised with.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LatestSetupResponse {
    /// Null before the first session.
    pub session_id: Option<String>,
    pub setup: Option<SessionSetup>,
}

/// `sessions.open_setup` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSetupRequest {
    pub session_id: String,
    /// True to take the session's own setup; false to keep the settings.
    pub restore: bool,
}

/// The setup a session opens with; null when no session has that id.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct OpenSetupResponse {
    pub setup: Option<SessionSetup>,
}

/// `sessions.save_setup` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSetupRequest {
    pub session_id: String,
    pub setup: SessionSetup,
    /// The change time (RFC 3339).
    pub now: String,
}

/// When the learner last practised.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LastPractisedResponse {
    /// Milliseconds since the epoch; null before any practice. A timestamp
    /// fits a JS number exactly.
    #[ts(type = "number | null")]
    pub at_ms: Option<u64>,
}

/// `audio.get` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioKeyRequest {
    pub key: String,
}

/// One cached clip; null when nothing is stored under the key.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct AudioResponse {
    pub asset: Option<AudioAsset>,
}

/// `audio.put` arguments: the clip as it is stored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPutRequest {
    pub asset: AudioAsset,
}

/// `sync.metadata` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadataRequest {
    pub provider: String,
}

/// What this device last knew about a provider's copy.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadataResponse {
    pub metadata: Option<SyncMetadata>,
}

/// Runs one record command, or returns `None` when it is not ours.
pub async fn dispatch(
    core: &Core,
    command: &str,
    payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        SESSIONS_LATEST_SETUP => latest_setup(core).await.and_then(serialize),
        SESSIONS_OPEN_SETUP => open_setup(core, payload).await.and_then(serialize),
        SESSIONS_SAVE_SETUP => save_setup(core, payload).await.and_then(serialize),
        REMINDERS_LAST_PRACTISED => last_practised(core).await.and_then(serialize),
        AUDIO_GET => audio_get(core, payload).await.and_then(serialize),
        AUDIO_PUT => audio_put(core, payload).await.and_then(serialize),
        SYNC_METADATA => sync_metadata(core, payload).await.and_then(serialize),
        _ => return None,
    };
    Some(result)
}

async fn latest_setup(core: &Core) -> Result<LatestSetupResponse, BridgeError> {
    let settings = current_settings(core).await?;
    let latest = onspot_app::latest_session_setup(
        history(core)?.as_ref(),
        records(core)?.as_ref(),
        &settings,
    )
    .await
    .map_err(storage_error)?;
    let (session_id, setup) = latest.map_or((None, None), |(id, setup)| (Some(id), Some(setup)));
    Ok(LatestSetupResponse { session_id, setup })
}

async fn open_setup(core: &Core, payload: Value) -> Result<OpenSetupResponse, BridgeError> {
    let request: OpenSetupRequest = parse(SESSIONS_OPEN_SETUP, payload)?;
    let settings = current_settings(core).await?;
    let setup = onspot_app::open_session_setup(
        records(core)?.as_ref(),
        &settings,
        &request.session_id,
        request.restore,
    )
    .await
    .map_err(storage_error)?;
    Ok(OpenSetupResponse { setup })
}

async fn save_setup(core: &Core, payload: Value) -> Result<Value, BridgeError> {
    let request: SaveSetupRequest = parse(SESSIONS_SAVE_SETUP, payload)?;
    let saved = onspot_app::save_session_setup(
        records(core)?.as_ref(),
        &request.session_id,
        &request.setup,
        &request.now,
    )
    .await
    .map_err(storage_error)?;
    Ok(serde_json::json!({ "saved": saved }))
}

async fn last_practised(core: &Core) -> Result<LastPractisedResponse, BridgeError> {
    let at_ms = onspot_app::last_practised_at(history(core)?.as_ref(), records(core)?.as_ref())
        .await
        .map_err(storage_error)?;
    Ok(LastPractisedResponse { at_ms })
}

async fn audio_get(core: &Core, payload: Value) -> Result<AudioResponse, BridgeError> {
    let request: AudioKeyRequest = parse(AUDIO_GET, payload)?;
    let asset = records(core)?
        .get_audio(&request.key)
        .await
        .map_err(storage_error)?;
    Ok(AudioResponse { asset })
}

async fn audio_put(core: &Core, payload: Value) -> Result<Value, BridgeError> {
    let request: AudioPutRequest = parse(AUDIO_PUT, payload)?;
    records(core)?
        .put_audio(&request.asset)
        .await
        .map_err(storage_error)?;
    Ok(serde_json::json!({}))
}

async fn sync_metadata(core: &Core, payload: Value) -> Result<SyncMetadataResponse, BridgeError> {
    let request: SyncMetadataRequest = parse(SYNC_METADATA, payload)?;
    let metadata = records(core)?
        .get_sync_metadata(&request.provider)
        .await
        .map_err(storage_error)?;
    Ok(SyncMetadataResponse { metadata })
}

/// The settings document as the core reads it.
async fn current_settings(core: &Core) -> Result<AppSettings, BridgeError> {
    let store = core
        .hosts()
        .settings
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let (loaded, _) = SettingsService::new(store.as_ref())
        .load_document()
        .await
        .map_err(storage_error)?;
    Ok(loaded.settings)
}

fn records(core: &Core) -> Result<Arc<dyn RecordsStore>, BridgeError> {
    core.hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))
}

fn history(core: &Core) -> Result<Arc<dyn HistoryStore>, BridgeError> {
    core.hosts()
        .history
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))
}

fn parse<T: for<'de> Deserialize<'de>>(command: &str, payload: Value) -> Result<T, BridgeError> {
    serde_json::from_value(payload).map_err(|error| BridgeError::invalid_payload(command, error))
}

fn storage_error(error: StoreError) -> BridgeError {
    BridgeError::new("storage.failed", error.message)
}
