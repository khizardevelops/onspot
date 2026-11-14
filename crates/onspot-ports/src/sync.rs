// SPDX-License-Identifier: AGPL-3.0-or-later

//! Snapshot sync ports: one provider moves the whole database, the OAuth
//! broker supplies Drive's bearer token.
//!
//! The core owns the conflict policy (`onspot_app::sync`); a provider only
//! reports what the remote holds and moves bytes. Authorization stays in the
//! driver on both runtimes, so the browser keeps Google Identity Services and
//! the desktop app keeps its loopback listener.

use async_trait::async_trait;
use onspot_domain::SyncMetadata;

use crate::{CoreError, StoreError};

/// The one remote file a provider keeps for this app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSnapshot {
    /// Provider identity: a Drive file id, or the WebDAV path.
    pub id: String,
    pub name: String,
    /// Provider-reported modification time, ISO 8601.
    pub modified_at: String,
    /// Drive `md5Checksum`, or a WebDAV `getetag`. Detects remote edits.
    pub etag: String,
    pub size: Option<u64>,
}

/// Human-readable connection state shown in Settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncAccount {
    pub label: String,
}

/// Transport for one cloud destination.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
pub trait SyncProvider: Send + Sync {
    /// The provider id stored in settings and sync metadata.
    fn id(&self) -> &'static str;

    /// Checks the destination is reachable and authorized.
    async fn connect(&self) -> Result<SyncAccount, CoreError>;

    /// Returns the current remote snapshot, or `None` when none exists yet.
    async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError>;

    /// Downloads the remote snapshot bytes.
    async fn download(&self, remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError>;

    /// Creates or replaces the remote snapshot and returns its new metadata.
    async fn upload(
        &self,
        bytes: &[u8],
        remote: Option<&RemoteSnapshot>,
    ) -> Result<RemoteSnapshot, CoreError>;
}

/// Transport for one cloud destination (wasm: single thread).
#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
pub trait SyncProvider {
    fn id(&self) -> &'static str;

    async fn connect(&self) -> Result<SyncAccount, CoreError>;

    async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError>;

    async fn download(&self, remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError>;

    async fn upload(
        &self,
        bytes: &[u8],
        remote: Option<&RemoteSnapshot>,
    ) -> Result<RemoteSnapshot, CoreError>;
}

/// Sync bookkeeping for one provider, without the rest of the record store.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
pub trait SyncStore: Send + Sync {
    /// The stored metadata for a provider, or `None` when it never synced.
    async fn get_metadata(&self, provider: &str) -> Result<Option<SyncMetadata>, StoreError>;

    /// Inserts or replaces a provider's metadata.
    async fn set_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError>;
}

/// Sync bookkeeping for one provider (wasm).
#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
pub trait SyncStore {
    async fn get_metadata(&self, provider: &str) -> Result<Option<SyncMetadata>, StoreError>;

    async fn set_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError>;
}

/// Supplies a Drive bearer token, refreshing it when asked.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
pub trait OAuthBroker: Send + Sync {
    /// A usable access token.
    ///
    /// @param force_refresh Ignore a still-valid cached token (after a 401).
    async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError>;
}

/// Supplies a Drive bearer token, refreshing it when asked (wasm).
#[cfg(target_arch = "wasm32")]
#[async_trait(?Send)]
pub trait OAuthBroker {
    async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError>;
}
