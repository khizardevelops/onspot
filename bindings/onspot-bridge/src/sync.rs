// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cloud-sync commands and the host ports they use.
//!
//! The core owns the conflict decision and the database replacement; the two
//! provider adapters own transport. The driver still supplies the HTTP
//! transport (`http.sync`), Google's OAuth flow (`oauth.*`) and, on the web,
//! the SQLite image (`db.*`), because those capabilities live in the webview.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use onspot_adapter_sync_drive::DriveSync;
use onspot_adapter_sync_webdav::{WebdavConfig, WebdavSync};
use onspot_app::{run_sync, Core, SyncChoice, SyncComparison, SyncRequest};
use onspot_ports::{
    CancelToken, Clock, CoreError, DatabaseFile, HttpBytesRequest, HttpBytesResponse, HttpClient,
    HttpRequest, HttpResponse, OAuthBroker, RecordsStore, SyncProvider, SyncStore,
};

use crate::commands::serialize;
use crate::error::BridgeError;

pub const SYNC_CONNECT: &str = "sync.connect";
pub const SYNC_ACCOUNT: &str = "sync.account";
pub const SYNC_DISCONNECT: &str = "sync.disconnect";
pub const SYNC_NOW: &str = "sync.now";

const BASE64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;
const DRIVE_PROVIDER: &str = "google-drive";

/// One destination and its configuration, as the driver knows it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTarget {
    /// `webdav` or `google-drive`.
    pub provider: String,
    #[serde(default)]
    pub webdav: Option<WebdavTarget>,
}

/// The WebDAV settings the driver passes in; credentials stay in the webview.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavTarget {
    pub base_url: String,
    #[serde(default)]
    pub path: String,
    pub username: String,
    pub password: String,
}

/// The label of a connected destination.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConnectResponse {
    pub label: String,
}

/// The label of a destination, or null when it has no usable authorization.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccountResponse {
    pub label: Option<String>,
}

/// Whether this device's authorization was forgotten.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDisconnectResponse {
    pub disconnected: bool,
}

/// What one sync attempt did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncNowResponse {
    pub decision: String,
    pub comparison: SyncComparison,
    pub completed: bool,
    /// True when the driver must mark the restored revision as synced.
    pub replaced_local: bool,
}

/// Runs one sync command, or returns `None` when it is not ours.
pub async fn dispatch(
    core: &Core,
    command: &str,
    payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        SYNC_CONNECT => connect(core, payload).await.and_then(serialize),
        SYNC_ACCOUNT => account(core, payload).await.and_then(serialize),
        SYNC_DISCONNECT => disconnect(core, payload).await.and_then(serialize),
        SYNC_NOW => sync_now(core, payload).await.and_then(serialize),
        _ => return None,
    };
    Some(result)
}

async fn connect(core: &Core, payload: Value) -> Result<SyncConnectResponse, BridgeError> {
    let target = parse_target(SYNC_CONNECT, payload)?;
    let provider = build_provider(core, &target)?;

    if target.provider == DRIVE_PROVIDER {
        // The webview runs Google's authorization UI, then the core proves the
        // token can reach the app-private folder.
        let account: OAuthAccount = call(&core_host_rpc(core), "oauth.connect", json!({}))
            .await
            .map_err(core_error)?;
        let _ = provider.probe().await.map_err(core_error)?;
        return Ok(SyncConnectResponse {
            label: account.unwrap_label(),
        });
    }

    let account = provider.connect().await.map_err(core_error)?;
    Ok(SyncConnectResponse {
        label: account.label,
    })
}

async fn account(core: &Core, payload: Value) -> Result<SyncAccountResponse, BridgeError> {
    let target = parse_target(SYNC_ACCOUNT, payload)?;

    if target.provider == DRIVE_PROVIDER {
        let account: OAuthAccount = call(&core_host_rpc(core), "oauth.account", json!({}))
            .await
            .map_err(core_error)?;
        return Ok(SyncAccountResponse {
            label: account.label,
        });
    }

    // A configured destination is connected as far as the settings screen is
    // concerned; `sync.connect` proves it and reports a bad login.
    let label = target
        .webdav
        .as_ref()
        .filter(|webdav| !webdav.base_url.trim().is_empty() && !webdav.username.trim().is_empty())
        .map(|webdav| label_of(&webdav.base_url));

    Ok(SyncAccountResponse { label })
}

async fn disconnect(core: &Core, payload: Value) -> Result<SyncDisconnectResponse, BridgeError> {
    let target = parse_target(SYNC_DISCONNECT, payload)?;

    if target.provider == DRIVE_PROVIDER {
        let _: Value = call(&core_host_rpc(core), "oauth.disconnect", json!({}))
            .await
            .map_err(core_error)?;
    }

    Ok(SyncDisconnectResponse { disconnected: true })
}

async fn sync_now(core: &Core, payload: Value) -> Result<SyncNowResponse, BridgeError> {
    let request: SyncNowRequest = serde_json::from_value(payload)
        .map_err(|error| BridgeError::invalid_payload(SYNC_NOW, error))?;
    let provider = build_provider(core, &request.target)?;
    let records = core
        .hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let store = RecordsSyncStore(records);

    let native = core.hosts().database_file.clone();
    let host_database;
    let database: &dyn DatabaseFile = match native.as_deref() {
        Some(database) => database,
        None => {
            host_database = HostDatabaseFile::new(core.host_rpc().clone());
            &host_database
        }
    };

    let outcome = run_sync(
        provider.as_ref(),
        &store,
        database,
        &SystemClock,
        &SyncRequest {
            revision: request.revision,
            synced_revision: request.synced_revision,
            choice: request.choice,
        },
    )
    .await
    .map_err(core_error)?;

    Ok(SyncNowResponse {
        decision: outcome.decision.as_str().to_owned(),
        comparison: outcome.comparison,
        completed: outcome.completed,
        replaced_local: outcome.replaced_local,
    })
}

fn parse_target(command: &str, payload: Value) -> Result<SyncTarget, BridgeError> {
    serde_json::from_value(payload).map_err(|error| BridgeError::invalid_payload(command, error))
}

fn build_provider(core: &Core, target: &SyncTarget) -> Result<Arc<dyn SyncProvider>, BridgeError> {
    let http = Arc::new(RpcHttp::new(core.host_rpc().clone())) as Arc<dyn HttpClient>;

    match target.provider.as_str() {
        DRIVE_PROVIDER => Ok(Arc::new(DriveSync::new(
            http,
            Arc::new(RpcOAuth::new(core.host_rpc().clone())),
        ))),
        "webdav" => {
            let webdav = target.webdav.as_ref().ok_or_else(|| {
                BridgeError::invalid_payload(
                    SYNC_NOW,
                    serde_json::from_str::<Value>("missing webdav config").expect_err("invalid"),
                )
            })?;
            let provider = WebdavSync::new(
                WebdavConfig {
                    base_url: webdav.base_url.clone(),
                    path: webdav.path.clone(),
                    username: webdav.username.clone(),
                    password: webdav.password.clone(),
                },
                http,
            )
            .map_err(core_error)?;
            Ok(Arc::new(provider))
        }
        other => Err(BridgeError::new(
            "sync.unknown_provider",
            format!("{other} is not a supported sync provider"),
        )),
    }
}

fn label_of(base_url: &str) -> String {
    let without_scheme = base_url
        .split_once("://")
        .map_or(base_url, |(_, rest)| rest);
    without_scheme
        .split('/')
        .next()
        .unwrap_or(base_url)
        .to_owned()
}

fn core_host_rpc(core: &Core) -> Arc<onspot_app::HostRpc> {
    core.host_rpc().clone()
}

fn core_error(error: CoreError) -> BridgeError {
    BridgeError::new(&error.code, error.message)
}

async fn call<T: for<'de> Deserialize<'de>>(
    rpc: &onspot_app::HostRpc,
    method: &str,
    payload: Value,
) -> Result<T, CoreError> {
    let value = rpc.call(method, payload).await?;
    serde_json::from_value(value).map_err(|error| {
        CoreError::new(
            "core.host_invalid_reply",
            format!("the driver's {method} reply was invalid: {error}"),
        )
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthAccount {
    label: Option<String>,
}

impl OAuthAccount {
    fn unwrap_label(self) -> String {
        self.label.unwrap_or_else(|| String::from("Google Drive"))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncNowRequest {
    #[serde(flatten)]
    target: SyncTarget,
    revision: u64,
    #[serde(default)]
    synced_revision: Option<u64>,
    #[serde(default)]
    choice: Option<SyncChoice>,
}

/// Sync metadata over the record store the core already holds.
struct RecordsSyncStore(Arc<dyn RecordsStore>);

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl SyncStore for RecordsSyncStore {
    async fn get_metadata(
        &self,
        provider: &str,
    ) -> Result<Option<onspot_domain::SyncMetadata>, onspot_ports::StoreError> {
        self.0.get_sync_metadata(provider).await
    }

    async fn set_metadata(
        &self,
        metadata: &onspot_domain::SyncMetadata,
    ) -> Result<(), onspot_ports::StoreError> {
        self.0.set_sync_metadata(metadata).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl SyncStore for RecordsSyncStore {
    async fn get_metadata(
        &self,
        provider: &str,
    ) -> Result<Option<onspot_domain::SyncMetadata>, onspot_ports::StoreError> {
        self.0.get_sync_metadata(provider).await
    }

    async fn set_metadata(
        &self,
        metadata: &onspot_domain::SyncMetadata,
    ) -> Result<(), onspot_ports::StoreError> {
        self.0.set_sync_metadata(metadata).await
    }
}

/// The driver's HTTP transport, including the binary body sync needs.
struct RpcHttp {
    rpc: Arc<onspot_app::HostRpc>,
}

impl RpcHttp {
    fn new(rpc: Arc<onspot_app::HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl HttpClient for RpcHttp {
    async fn send(
        &self,
        request: &HttpRequest,
        _token: &CancelToken,
    ) -> Result<HttpResponse, CoreError> {
        call(&self.rpc, "http.request", json!(request)).await
    }

    async fn send_bytes(
        &self,
        request: &HttpBytesRequest,
        _token: &CancelToken,
    ) -> Result<HttpBytesResponse, CoreError> {
        let reply: SyncHttpReply = call(
            &self.rpc,
            "http.sync",
            json!({
                "method": request.method,
                "url": request.url,
                "headers": request.headers,
                "bodyBase64": BASE64.encode(&request.body),
            }),
        )
        .await?;

        Ok(HttpBytesResponse {
            status: reply.status,
            headers: reply.headers,
            body: decode(&reply.body_base64)?,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncHttpReply {
    status: u16,
    headers: BTreeMap<String, String>,
    body_base64: String,
}

/// The driver's Google token cache and authorization flow.
struct RpcOAuth {
    rpc: Arc<onspot_app::HostRpc>,
}

impl RpcOAuth {
    fn new(rpc: Arc<onspot_app::HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl OAuthBroker for RpcOAuth {
    async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError> {
        access_token_via_host(&self.rpc, force_refresh).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl OAuthBroker for RpcOAuth {
    async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError> {
        access_token_via_host(&self.rpc, force_refresh).await
    }
}

async fn access_token_via_host(
    rpc: &onspot_app::HostRpc,
    force_refresh: bool,
) -> Result<String, CoreError> {
    let reply: AccessTokenReply = call(
        rpc,
        "oauth.access_token",
        json!({ "forceRefresh": force_refresh }),
    )
    .await?;
    Ok(reply.access_token)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessTokenReply {
    access_token: String,
}

/// The database image over a host call, for the browser driver.
struct HostDatabaseFile {
    rpc: Arc<onspot_app::HostRpc>,
}

impl HostDatabaseFile {
    fn new(rpc: Arc<onspot_app::HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl DatabaseFile for HostDatabaseFile {
    async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
        export_via_host(&self.rpc).await
    }

    async fn import_bytes(&self, bytes: &[u8]) -> Result<onspot_ports::RestoreCounts, CoreError> {
        import_via_host(&self.rpc, bytes).await
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
impl DatabaseFile for HostDatabaseFile {
    async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
        export_via_host(&self.rpc).await
    }

    async fn import_bytes(&self, bytes: &[u8]) -> Result<onspot_ports::RestoreCounts, CoreError> {
        import_via_host(&self.rpc, bytes).await
    }
}

async fn export_via_host(rpc: &onspot_app::HostRpc) -> Result<Vec<u8>, CoreError> {
    let reply: ExportBytesReply = call(rpc, "db.export_bytes", json!({})).await?;
    decode(&reply.bytes_base64)
}

async fn import_via_host(
    rpc: &onspot_app::HostRpc,
    bytes: &[u8],
) -> Result<onspot_ports::RestoreCounts, CoreError> {
    let reply: ImportReply = call(
        rpc,
        "db.import_bytes",
        json!({ "bytesBase64": BASE64.encode(bytes) }),
    )
    .await?;
    Ok(onspot_ports::RestoreCounts {
        sessions: reply.sessions as usize,
        attempts: reply.attempts as usize,
    })
}

fn decode(value: &str) -> Result<Vec<u8>, CoreError> {
    BASE64.decode(value).map_err(|error| {
        CoreError::new(
            "core.host_invalid_reply",
            format!("the driver's sync bytes were not base64: {error}"),
        )
    })
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

/// The host clock in the RFC 3339 form the sync metadata stores.
struct SystemClock;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map_or(0, |duration| {
                duration.as_millis().min(u128::from(u64::MAX)) as u64
            })
    }

    async fn sleep(&self, milliseconds: u64, _token: &CancelToken) -> bool {
        futures_timer::Delay::new(std::time::Duration::from_millis(milliseconds)).await;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_webdav_label_is_the_host() {
        assert_eq!(
            label_of("https://cloud.example.com/remote.php/dav/files/me"),
            "cloud.example.com"
        );
    }

    #[test]
    fn sync_bytes_round_trip_through_base64() {
        let bytes = b"SQLite format 3\0";
        assert_eq!(decode(&BASE64.encode(bytes)).expect("decode"), bytes);
    }

    #[test]
    fn a_sync_now_request_reads_the_flattened_target() {
        let request: SyncNowRequest = serde_json::from_value(json!({
            "provider": "webdav",
            "webdav": {
                "baseUrl": "https://cloud.example.com/dav",
                "path": "/onspot.sqlite",
                "username": "me",
                "password": "secret"
            },
            "revision": 4,
            "syncedRevision": 3,
            "choice": "download"
        }))
        .expect("request");

        assert_eq!(request.target.provider, "webdav");
        assert_eq!(request.revision, 4);
        assert_eq!(request.choice, Some(SyncChoice::Download));
    }

    #[test]
    fn an_unknown_provider_is_refused() {
        let target = SyncTarget {
            provider: String::from("dropbox"),
            webdav: None,
        };
        let error = match build_provider_without_core(&target) {
            Ok(_) => panic!("unknown provider must fail"),
            Err(error) => error,
        };
        assert_eq!(error.code, "sync.unknown_provider");
    }

    fn build_provider_without_core(target: &SyncTarget) -> Result<(), BridgeError> {
        if target.provider == DRIVE_PROVIDER || target.provider == "webdav" {
            return Ok(());
        }
        Err(BridgeError::new(
            "sync.unknown_provider",
            format!("{} is not a supported sync provider", target.provider),
        ))
    }
}
