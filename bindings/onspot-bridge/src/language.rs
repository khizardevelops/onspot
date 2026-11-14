// SPDX-License-Identifier: AGPL-3.0-or-later

//! Language-data download commands and the host installer they call.
//!
//! The core plans and sequences the missing parts; the workers that fetch the
//! bytes stay in the driver behind `language.download_stt`,
//! `language.download_voice` and `language.cancel` host calls. The driver
//! reports progress back through `language.download_progress`, and the core
//! forwards one combined `download_progress` event to the UI.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use onspot_app::{Core, HostRpc, LanguageDownloadSnapshot, LanguagePlanInput, RunLanguageDownload};
use onspot_ports::{
    CancelToken, CoreError, DownloadProgressSink, LanguageDataInstaller, ModelProgress,
};

use crate::commands::serialize;
use crate::error::BridgeError;

pub const LANGUAGE_DOWNLOAD: &str = "language.download";
pub const LANGUAGE_CANCEL_DOWNLOAD: &str = "language.cancel_download";
pub const LANGUAGE_DOWNLOAD_PROGRESS: &str = "language.download_progress";

/// `language.download` arguments.
#[derive(Debug, Clone, Deserialize)]
pub struct LanguageDownloadRequest {
    pub input: LanguagePlanInput,
}

/// The download's state when it ends.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguageDownloadResponse {
    /// `ready` or `cancelled`; failures reject the command.
    pub status: String,
    /// Combined 0–100 progress.
    pub progress: f32,
    /// What the planner counted as missing when the download started.
    pub pending: onspot_app::PendingBytes,
    /// True only when every required part finished.
    pub ready: bool,
    /// The worker's latest status line.
    pub label: String,
}

impl From<LanguageDownloadSnapshot> for LanguageDownloadResponse {
    fn from(snapshot: LanguageDownloadSnapshot) -> Self {
        Self {
            status: snapshot.status,
            progress: snapshot.progress,
            pending: snapshot.pending,
            ready: snapshot.ready,
            label: snapshot.label,
        }
    }
}

/// `language.download_progress` arguments.
#[derive(Debug, Clone, Deserialize)]
pub struct LanguageProgressRequest {
    pub progress: ModelProgress,
}

/// Whether the progress reading found a running download.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguageProgressResponse {
    pub accepted: bool,
}

/// Whether a cancellation request was delivered.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguageCancelResponse {
    pub cancelled: bool,
}

/// Runs one language-data command, or returns `None` when it is not ours.
pub async fn dispatch(
    core: &Core,
    command: &str,
    payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        LANGUAGE_DOWNLOAD => download(core, payload).await.and_then(serialize),
        LANGUAGE_CANCEL_DOWNLOAD => cancel(core).await.and_then(serialize),
        LANGUAGE_DOWNLOAD_PROGRESS => progress(core, payload).and_then(serialize),
        _ => return None,
    };
    Some(result)
}

async fn download(core: &Core, payload: Value) -> Result<LanguageDownloadResponse, BridgeError> {
    if core.language_download().is_some() {
        return Err(BridgeError::new(
            "language.download_in_progress",
            "a language-data download is already running",
        ));
    }
    let request: LanguageDownloadRequest = parse(LANGUAGE_DOWNLOAD, payload)?;
    let installer: Arc<dyn LanguageDataInstaller> =
        Arc::new(HostLanguageInstaller::new(core.host_rpc().clone()));
    let session = Arc::new(RunLanguageDownload::new(
        request.input,
        installer,
        core.event_sink(),
    ));
    core.install_language_download(session.clone());

    let result = session.run().await;
    core.remove_language_download();

    result
        .map(LanguageDownloadResponse::from)
        .map_err(core_error)
}

async fn cancel(core: &Core) -> Result<LanguageCancelResponse, BridgeError> {
    core.cancel_language_download();
    // The core cannot reach a Web Worker: ask the driver to tear down whichever
    // fetch is in flight. The waiting download then observes cancellation.
    let installer = HostLanguageInstaller::new(core.host_rpc().clone());
    installer.cancel().await.map_err(core_error)?;
    Ok(LanguageCancelResponse { cancelled: true })
}

fn progress(core: &Core, payload: Value) -> Result<LanguageProgressResponse, BridgeError> {
    let request: LanguageProgressRequest = parse(LANGUAGE_DOWNLOAD_PROGRESS, payload)?;
    core.report_language_download_progress(&request.progress);
    Ok(LanguageProgressResponse {
        accepted: core.language_download().is_some(),
    })
}

fn parse<T: for<'de> Deserialize<'de>>(command: &str, payload: Value) -> Result<T, BridgeError> {
    serde_json::from_value(payload).map_err(|error| BridgeError::invalid_payload(command, error))
}

fn core_error(error: CoreError) -> BridgeError {
    BridgeError::new(&error.code, error.message)
}

/// The driver's worker downloads over host calls.
pub struct HostLanguageInstaller {
    rpc: Arc<HostRpc>,
}

impl HostLanguageInstaller {
    /// Creates the installer over the core's host-call registry.
    pub fn new(rpc: Arc<HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl LanguageDataInstaller for HostLanguageInstaller {
    async fn download_stt(
        &self,
        language_id: &str,
        progress: &dyn DownloadProgressSink,
        _token: &CancelToken,
    ) -> Result<(), CoreError> {
        // Progress arrives out of band through `language.download_progress`
        // while this host call is waiting, so the sink is unused here.
        let _ = progress;
        call(
            &self.rpc,
            "language.download_stt",
            json!({ "languageId": language_id }),
        )
        .await
    }

    async fn download_voice(
        &self,
        voice_id: &str,
        progress: &dyn DownloadProgressSink,
        _token: &CancelToken,
    ) -> Result<(), CoreError> {
        let _ = progress;
        call(
            &self.rpc,
            "language.download_voice",
            json!({ "voiceId": voice_id }),
        )
        .await
    }

    async fn cancel(&self) -> Result<(), CoreError> {
        call(&self.rpc, "language.cancel", json!({})).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl LanguageDataInstaller for HostLanguageInstaller {
    async fn download_stt(
        &self,
        language_id: &str,
        progress: &dyn DownloadProgressSink,
        _token: &CancelToken,
    ) -> Result<(), CoreError> {
        let _ = progress;
        call(
            &self.rpc,
            "language.download_stt",
            json!({ "languageId": language_id }),
        )
        .await
    }

    async fn download_voice(
        &self,
        voice_id: &str,
        progress: &dyn DownloadProgressSink,
        _token: &CancelToken,
    ) -> Result<(), CoreError> {
        let _ = progress;
        call(
            &self.rpc,
            "language.download_voice",
            json!({ "voiceId": voice_id }),
        )
        .await
    }

    async fn cancel(&self) -> Result<(), CoreError> {
        call(&self.rpc, "language.cancel", json!({})).await
    }
}

async fn call(rpc: &HostRpc, method: &str, payload: Value) -> Result<(), CoreError> {
    rpc.call(method, payload).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_response_keeps_the_snapshot_fields() {
        let response = LanguageDownloadResponse::from(LanguageDownloadSnapshot {
            status: String::from("ready"),
            progress: 100.0,
            pending: onspot_app::PendingBytes {
                stt: 0,
                voice: 0,
                explanation_voice: 0,
                storage: 0,
                transfer: 0,
            },
            ready: true,
            label: String::from("done"),
        });
        assert_eq!(response.status, "ready");
        assert!(response.ready);
        assert_eq!(response.progress, 100.0);
    }
}
