// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whole-database export and restore commands and the host ports they call.
//!
//! The core owns the flow and the format checks. The dialog and the filesystem
//! live in the driver, so `FileSystemSink` crosses as `fs.save`/`fs.pick` host
//! calls. The database image crosses as `db.export_bytes`/`db.import_bytes`
//! unless the driver supplies its own `DatabaseFile` (the native rusqlite
//! driver does). Bytes travel base64-encoded because the bridge envelope is
//! JSON on both transports.

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use onspot_app::{
    backup_date, Core, ExportDatabase, HostRpc, PickRestore, RestoreDatabase, StagedRestore,
};
use onspot_ports::{CoreError, DatabaseFile, FileSystemSink, PickedFile, RestoreCounts};

use crate::commands::serialize;
use crate::error::BridgeError;

pub const EXPORT_DATABASE: &str = "export.database";
pub const RESTORE_PICK: &str = "restore.pick";
pub const RESTORE_CONFIRM: &str = "restore.confirm";
pub const RESTORE_CANCEL: &str = "restore.cancel";

const BASE64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// What an export wrote, or that the save dialog was cancelled.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ExportDatabaseResponse {
    /// True only after the file was saved.
    pub saved: bool,
    /// The name the save dialog suggested.
    pub file_name: String,
}

/// The file waiting for the learner's restore confirmation.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RestorePickResponse {
    /// `None` when the learner cancelled the picker.
    pub file_name: Option<String>,
}

/// What a confirmed restore put back on the device.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RestoreConfirmResponse {
    /// Sessions in the restored database.
    pub sessions: u32,
    /// Takes across those sessions.
    pub attempts: u32,
}

/// Whether a staged restore was discarded.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RestoreCancelResponse {
    /// Always true: cancelling is idempotent.
    pub cancelled: bool,
}

/// Runs one portability command, or returns `None` when it is not ours.
pub async fn dispatch(
    core: &Core,
    command: &str,
    _payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        EXPORT_DATABASE => export_database(core).await.and_then(serialize),
        RESTORE_PICK => restore_pick(core).await.and_then(serialize),
        RESTORE_CONFIRM => restore_confirm(core).await.and_then(serialize),
        RESTORE_CANCEL => {
            core.clear_staged_restore();
            serialize(RestoreCancelResponse { cancelled: true })
        }
        _ => return None,
    };
    Some(result)
}

async fn export_database(core: &Core) -> Result<ExportDatabaseResponse, BridgeError> {
    let sink = HostFileSystemSink::new(core.host_rpc().clone());
    let native = core.hosts().database_file.clone();
    let host_database;
    let database: &dyn DatabaseFile = match native.as_deref() {
        Some(database) => database,
        None => {
            host_database = HostDatabaseFile::new(core.host_rpc().clone());
            &host_database
        }
    };

    let result = ExportDatabase::new(database, &sink)
        .execute(&backup_date())
        .await
        .map_err(core_error)?;

    Ok(ExportDatabaseResponse {
        saved: result.saved,
        file_name: result.file_name,
    })
}

async fn restore_pick(core: &Core) -> Result<RestorePickResponse, BridgeError> {
    let sink = HostFileSystemSink::new(core.host_rpc().clone());
    let staged = PickRestore::new(&sink)
        .execute()
        .await
        .map_err(core_error)?;

    let Some(StagedRestore { file_name, bytes }) = staged else {
        core.clear_staged_restore();
        return Ok(RestorePickResponse { file_name: None });
    };

    core.stage_restore(PickedFile {
        file_name: file_name.clone(),
        bytes,
    });
    Ok(RestorePickResponse {
        file_name: Some(file_name),
    })
}

async fn restore_confirm(core: &Core) -> Result<RestoreConfirmResponse, BridgeError> {
    let staged = core.take_staged_restore().ok_or_else(|| {
        BridgeError::new(
            "restore.not_staged",
            "no backup is waiting for confirmation",
        )
    })?;

    let native = core.hosts().database_file.clone();
    let host_database;
    let database: &dyn DatabaseFile = match native.as_deref() {
        Some(database) => database,
        None => {
            host_database = HostDatabaseFile::new(core.host_rpc().clone());
            &host_database
        }
    };

    let RestoreCounts { sessions, attempts } = RestoreDatabase::new(database)
        .execute(&staged.bytes)
        .await
        .map_err(core_error)?;

    Ok(RestoreConfirmResponse {
        sessions: u32::try_from(sessions).unwrap_or(u32::MAX),
        attempts: u32::try_from(attempts).unwrap_or(u32::MAX),
    })
}

fn core_error(error: CoreError) -> BridgeError {
    BridgeError::new(&error.code, error.message)
}

/// The driver's Save-as and Open dialogs over a host call.
pub struct HostFileSystemSink {
    rpc: Arc<HostRpc>,
}

impl HostFileSystemSink {
    /// Creates the sink over the core's host-call registry.
    pub fn new(rpc: Arc<HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl FileSystemSink for HostFileSystemSink {
    async fn save(&self, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError> {
        save_via_host(&self.rpc, file_name, bytes).await
    }

    async fn pick(&self) -> Result<Option<PickedFile>, CoreError> {
        pick_via_host(&self.rpc).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl FileSystemSink for HostFileSystemSink {
    async fn save(&self, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError> {
        save_via_host(&self.rpc, file_name, bytes).await
    }

    async fn pick(&self) -> Result<Option<PickedFile>, CoreError> {
        pick_via_host(&self.rpc).await
    }
}

async fn save_via_host(rpc: &HostRpc, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError> {
    let reply = rpc
        .call(
            "fs.save",
            json!({
                "fileName": file_name,
                "bytesBase64": BASE64.encode(bytes),
            }),
        )
        .await?;
    let response: SaveReply = parse_reply("fs.save", reply)?;
    Ok(response.saved)
}

async fn pick_via_host(rpc: &HostRpc) -> Result<Option<PickedFile>, CoreError> {
    let reply = rpc.call("fs.pick", json!({})).await?;
    let response: PickReply = parse_reply("fs.pick", reply)?;
    match response.file {
        Some(file) => Ok(Some(PickedFile {
            file_name: file.file_name,
            bytes: decode("fs.pick", &file.bytes_base64)?,
        })),
        None => Ok(None),
    }
}

/// The database image over a host call, for drivers without a native port.
pub struct HostDatabaseFile {
    rpc: Arc<HostRpc>,
}

impl HostDatabaseFile {
    /// Creates the database image over the core's host-call registry.
    pub fn new(rpc: Arc<HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl DatabaseFile for HostDatabaseFile {
    async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
        export_via_host(&self.rpc).await
    }

    async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
        import_via_host(&self.rpc, bytes).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl DatabaseFile for HostDatabaseFile {
    async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
        export_via_host(&self.rpc).await
    }

    async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
        import_via_host(&self.rpc, bytes).await
    }
}

async fn export_via_host(rpc: &HostRpc) -> Result<Vec<u8>, CoreError> {
    let reply = rpc.call("db.export_bytes", json!({})).await?;
    let response: ExportBytesReply = parse_reply("db.export_bytes", reply)?;
    decode("db.export_bytes", &response.bytes_base64)
}

async fn import_via_host(rpc: &HostRpc, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
    let reply = rpc
        .call(
            "db.import_bytes",
            json!({ "bytesBase64": BASE64.encode(bytes) }),
        )
        .await?;
    let response: ImportReply = parse_reply("db.import_bytes", reply)?;
    Ok(RestoreCounts {
        sessions: response.sessions as usize,
        attempts: response.attempts as usize,
    })
}

fn decode(method: &str, value: &str) -> Result<Vec<u8>, CoreError> {
    BASE64.decode(value).map_err(|error| {
        CoreError::new(
            "core.host_invalid_reply",
            format!("the driver's {method} bytes were not base64: {error}"),
        )
    })
}

fn parse_reply<T: for<'de> Deserialize<'de>>(method: &str, reply: Value) -> Result<T, CoreError> {
    serde_json::from_value(reply).map_err(|error| {
        CoreError::new(
            "core.host_invalid_reply",
            format!("the driver's {method} reply was invalid: {error}"),
        )
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveReply {
    saved: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickReply {
    file: Option<PickReplyFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickReplyFile {
    file_name: String,
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBytesReply {
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportReply {
    sessions: u32,
    attempts: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_bytes_round_trip_through_base64() {
        let bytes = b"SQLite format 3\0payload";
        let encoded = BASE64.encode(bytes);
        assert_eq!(decode("test", &encoded).expect("decode"), bytes);
    }

    #[test]
    fn invalid_base64_reports_a_stable_code() {
        let error = decode("test", "not base64!").expect_err("invalid");
        assert_eq!(error.code, "core.host_invalid_reply");
    }
}
