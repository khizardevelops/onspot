// SPDX-License-Identifier: AGPL-3.0-or-later

//! The sync use case: compare, decide, then move the whole database.
//!
//! Ported from `src/lib/adapters/sync/service.ts`. The provider moves bytes and
//! the driver writes the database; this module owns the promise that a cloud
//! copy never replaces a device without an explicit choice.

use onspot_domain::SyncMetadata as StoredSyncMetadata;
use onspot_ports::{
    Clock, CoreError, DatabaseFile, RemoteSnapshot, StoreError, SyncProvider, SyncStore,
};

use crate::sync_policy::{
    compare_sync, decide_with_choice, RemoteFile, SyncChoice, SyncComparison, SyncDecision,
    SyncMetadata,
};

/// The device-local state a sync starts from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncRequest {
    /// The device's content revision at comparison time.
    pub revision: u64,
    /// The revision last synced with this provider, or `None` if never.
    pub synced_revision: Option<u64>,
    /// The learner's explicit choice after a conflict.
    pub choice: Option<SyncChoice>,
}

/// What one sync attempt did, or needs the learner to decide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncOutcome {
    pub decision: SyncDecision,
    pub comparison: SyncComparison,
    /// True only when the local or remote database was actually written.
    pub completed: bool,
    /// True when the local database was replaced, so the driver must reload.
    pub replaced_local: bool,
}

/// Runs one whole-database sync.
///
/// An upload is non-destructive and may run without a choice. A download
/// replaces the local database, so it only runs when `request.choice` is
/// `Download`.
pub async fn run_sync(
    provider: &dyn SyncProvider,
    metadata_store: &dyn SyncStore,
    database: &dyn DatabaseFile,
    clock: &dyn Clock,
    request: &SyncRequest,
) -> Result<SyncOutcome, CoreError> {
    let stored = metadata_store
        .get_metadata(provider.id())
        .await
        .map_err(store_error)?;
    let metadata = stored.as_ref().and_then(policy_metadata);
    let remote = provider.probe().await?;
    let comparison = compare_sync(
        metadata.as_ref(),
        remote.as_ref().map(policy_remote).as_ref(),
        request.revision,
        request.synced_revision,
    );
    let decision = decide_with_choice(&comparison, request.choice);

    let mut outcome = SyncOutcome {
        decision,
        comparison: comparison.clone(),
        completed: false,
        replaced_local: false,
    };

    match decision {
        SyncDecision::UpToDate | SyncDecision::NeedsChoice => return Ok(outcome),
        SyncDecision::Upload => {
            let bytes = database.export_bytes().await?;
            let uploaded = provider.upload(&bytes, remote.as_ref()).await?;
            let now = now_rfc3339(clock.now_ms());
            metadata_store
                .set_metadata(&stored_metadata(
                    provider.id(),
                    &uploaded,
                    &now,
                    Some(request.revision),
                ))
                .await
                .map_err(store_error)?;
            outcome.comparison = SyncComparison {
                local_revision: request.revision,
                synced_revision: Some(request.revision),
                local_size: Some(bytes.len() as u64),
                remote: Some(policy_file(&uploaded)),
                last_synced_at: Some(now),
                has_local_changes: false,
                has_remote_changes: false,
            };
            outcome.completed = true;
        }
        SyncDecision::Download => {
            let remote = remote.ok_or_else(|| {
                CoreError::new(
                    "sync.no_remote",
                    "there is no cloud backup to download yet; upload this device first",
                )
            })?;
            let bytes = provider.download(&remote).await?;
            // The driver's restore has a rollback path, but a foreign file must
            // never reach it on any runtime: refuse before touching the device.
            if !crate::export_validate::is_sqlite_database(&bytes) {
                return Err(CoreError::new(
                    "sync.invalid_backup",
                    "The cloud backup is not a SQLite database. Nothing was changed.",
                ));
            }
            if !crate::export_validate::is_onspot_database(&bytes) {
                return Err(CoreError::new(
                    "sync.invalid_backup",
                    "The cloud backup is not an onspot backup. Nothing was changed.",
                ));
            }
            database.import_bytes(&bytes).await?;
            let now = now_rfc3339(clock.now_ms());
            // The import is a content write, so the driver records the new
            // revision after this call returns; the cursor stays unset here.
            metadata_store
                .set_metadata(&stored_metadata(provider.id(), &remote, &now, None))
                .await
                .map_err(store_error)?;
            outcome.comparison = SyncComparison {
                local_revision: request.revision,
                synced_revision: request.synced_revision,
                local_size: Some(bytes.len() as u64),
                remote: Some(policy_file(&remote)),
                last_synced_at: Some(now),
                has_local_changes: false,
                has_remote_changes: false,
            };
            outcome.completed = true;
            outcome.replaced_local = true;
        }
    }

    Ok(outcome)
}

fn policy_metadata(stored: &StoredSyncMetadata) -> Option<SyncMetadata> {
    Some(SyncMetadata {
        etag: stored.etag.clone()?,
        remote_file_id: stored.remote_file_id.clone()?,
        last_synced_at: stored.last_synced_at.clone()?,
    })
}

fn policy_remote(remote: &RemoteSnapshot) -> RemoteFile {
    RemoteFile {
        id: remote.id.clone(),
        name: remote.name.clone(),
        modified_at: remote.modified_at.clone(),
        etag: remote.etag.clone(),
        size: remote.size,
    }
}

fn policy_file(remote: &RemoteSnapshot) -> RemoteFile {
    policy_remote(remote)
}

fn stored_metadata(
    provider: &str,
    remote: &RemoteSnapshot,
    now: &str,
    revision: Option<u64>,
) -> StoredSyncMetadata {
    StoredSyncMetadata {
        provider: provider.to_owned(),
        remote_file_id: Some(remote.id.clone()),
        etag: Some(remote.etag.clone()),
        last_synced_at: Some(now.to_owned()),
        cursor: revision.map(|revision| revision.to_string()),
        updated_at: now.to_owned(),
    }
}

fn now_rfc3339(now_ms: u64) -> String {
    let seconds = (now_ms / 1000).min(i64::MAX as u64) as i64;
    let millis = (now_ms % 1000) as u32;
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .map(|datetime| {
            datetime
                .replace_nanosecond(millis * 1_000_000)
                .unwrap_or(datetime)
        })
        .and_then(|datetime| {
            datetime
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_else(|| String::from("1970-01-01T00:00:00Z"))
}

fn store_error(error: StoreError) -> CoreError {
    CoreError::new("sync.metadata_failed", error.message)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use onspot_ports::{CancelToken, CoreError, OAuthBroker};

    #[derive(Default)]
    struct FakeProvider {
        remote: Mutex<Option<RemoteSnapshot>>,
        uploaded: Mutex<Option<Vec<u8>>>,
        downloaded: Vec<u8>,
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl SyncProvider for FakeProvider {
        fn id(&self) -> &'static str {
            "fake"
        }

        async fn connect(&self) -> Result<onspot_ports::SyncAccount, CoreError> {
            Ok(onspot_ports::SyncAccount {
                label: String::from("fake"),
            })
        }

        async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError> {
            Ok(self.remote.lock().expect("remote").clone())
        }

        async fn download(&self, _remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError> {
            Ok(self.downloaded.clone())
        }

        async fn upload(
            &self,
            bytes: &[u8],
            _remote: Option<&RemoteSnapshot>,
        ) -> Result<RemoteSnapshot, CoreError> {
            *self.uploaded.lock().expect("uploaded") = Some(bytes.to_vec());
            let remote = RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e2"),
                size: Some(bytes.len() as u64),
            };
            *self.remote.lock().expect("remote") = Some(remote.clone());
            Ok(remote)
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait::async_trait(?Send)]
    impl SyncProvider for FakeProvider {
        fn id(&self) -> &'static str {
            "fake"
        }

        async fn connect(&self) -> Result<onspot_ports::SyncAccount, CoreError> {
            Ok(onspot_ports::SyncAccount {
                label: String::from("fake"),
            })
        }

        async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError> {
            Ok(self.remote.lock().expect("remote").clone())
        }

        async fn download(&self, _remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError> {
            Ok(self.downloaded.clone())
        }

        async fn upload(
            &self,
            bytes: &[u8],
            _remote: Option<&RemoteSnapshot>,
        ) -> Result<RemoteSnapshot, CoreError> {
            *self.uploaded.lock().expect("uploaded") = Some(bytes.to_vec());
            let remote = RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e2"),
                size: Some(bytes.len() as u64),
            };
            *self.remote.lock().expect("remote") = Some(remote.clone());
            Ok(remote)
        }
    }

    struct FakeStore(Mutex<Option<StoredSyncMetadata>>);

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl SyncStore for FakeStore {
        async fn get_metadata(
            &self,
            _provider: &str,
        ) -> Result<Option<StoredSyncMetadata>, StoreError> {
            Ok(self.0.lock().expect("metadata").clone())
        }

        async fn set_metadata(&self, metadata: &StoredSyncMetadata) -> Result<(), StoreError> {
            *self.0.lock().expect("metadata") = Some(metadata.clone());
            Ok(())
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait::async_trait(?Send)]
    impl SyncStore for FakeStore {
        async fn get_metadata(
            &self,
            _provider: &str,
        ) -> Result<Option<StoredSyncMetadata>, StoreError> {
            Ok(self.0.lock().expect("metadata").clone())
        }

        async fn set_metadata(&self, metadata: &StoredSyncMetadata) -> Result<(), StoreError> {
            *self.0.lock().expect("metadata") = Some(metadata.clone());
            Ok(())
        }
    }

    struct FakeDatabase {
        bytes: Vec<u8>,
        imported: Mutex<Option<Vec<u8>>>,
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl DatabaseFile for FakeDatabase {
        async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
            Ok(self.bytes.clone())
        }

        async fn import_bytes(
            &self,
            bytes: &[u8],
        ) -> Result<onspot_ports::RestoreCounts, CoreError> {
            *self.imported.lock().expect("imported") = Some(bytes.to_vec());
            Ok(onspot_ports::RestoreCounts {
                sessions: 1,
                attempts: 2,
            })
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait::async_trait(?Send)]
    impl DatabaseFile for FakeDatabase {
        async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
            Ok(self.bytes.clone())
        }

        async fn import_bytes(
            &self,
            bytes: &[u8],
        ) -> Result<onspot_ports::RestoreCounts, CoreError> {
            *self.imported.lock().expect("imported") = Some(bytes.to_vec());
            Ok(onspot_ports::RestoreCounts {
                sessions: 1,
                attempts: 2,
            })
        }
    }

    struct FixedClock;

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl Clock for FixedClock {
        fn now_ms(&self) -> u64 {
            1_763_033_600_000
        }

        async fn sleep(&self, _milliseconds: u64, _token: &CancelToken) -> bool {
            true
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait::async_trait(?Send)]
    impl Clock for FixedClock {
        fn now_ms(&self) -> u64 {
            1_763_033_600_000
        }

        async fn sleep(&self, _milliseconds: u64, _token: &CancelToken) -> bool {
            true
        }
    }

    fn run(
        provider: &FakeProvider,
        store: &FakeStore,
        database: &FakeDatabase,
        request: SyncRequest,
    ) -> SyncOutcome {
        futures::executor::block_on(run_sync(provider, store, database, &FixedClock, &request))
            .expect("sync succeeds")
    }

    /// A minimal image that passes the same checks a real export does.
    fn onspot_image() -> Vec<u8> {
        let mut image = b"SQLite format 3\0".to_vec();
        for table in [
            "schema_migrations",
            "sessions",
            "attempts",
            "corrections",
            "audio_assets",
            "settings",
        ] {
            image.extend_from_slice(format!("CREATE TABLE {table} (id TEXT);\n").as_bytes());
        }
        image
    }

    #[test]
    fn a_first_sync_uploads_without_asking() {
        let provider = FakeProvider::default();
        let store = FakeStore(Mutex::new(None));
        let database = FakeDatabase {
            bytes: b"SQLite format 3\0".to_vec(),
            imported: Mutex::new(None),
        };

        let outcome = run(
            &provider,
            &store,
            &database,
            SyncRequest {
                revision: 1,
                synced_revision: None,
                choice: None,
            },
        );

        assert_eq!(outcome.decision, SyncDecision::Upload);
        assert!(outcome.completed);
        assert_eq!(
            provider.uploaded.lock().expect("uploaded").as_deref(),
            Some(b"SQLite format 3\0".as_slice())
        );
        let metadata = store.0.lock().expect("metadata").clone().expect("metadata");
        assert_eq!(metadata.etag.as_deref(), Some("e2"));
        assert_eq!(metadata.cursor.as_deref(), Some("1"));
    }

    #[test]
    fn a_matching_device_is_up_to_date_without_io() {
        let provider = FakeProvider {
            remote: Mutex::new(Some(RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e1"),
                size: Some(4),
            })),
            uploaded: Mutex::new(None),
            downloaded: Vec::new(),
        };
        let store = FakeStore(Mutex::new(Some(StoredSyncMetadata {
            provider: String::from("fake"),
            remote_file_id: Some(String::from("file")),
            etag: Some(String::from("e1")),
            last_synced_at: Some(String::from("2026-11-13T09:00:00Z")),
            cursor: Some(String::from("7")),
            updated_at: String::from("2026-11-13T09:00:00Z"),
        })));
        let database = FakeDatabase {
            bytes: Vec::new(),
            imported: Mutex::new(None),
        };

        let outcome = run(
            &provider,
            &store,
            &database,
            SyncRequest {
                revision: 7,
                synced_revision: Some(7),
                choice: None,
            },
        );

        assert_eq!(outcome.decision, SyncDecision::UpToDate);
        assert!(!outcome.completed);
    }

    #[test]
    fn a_diverged_pair_never_downloads_without_a_choice() {
        let provider = FakeProvider {
            remote: Mutex::new(Some(RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e2"),
                size: Some(4),
            })),
            uploaded: Mutex::new(None),
            downloaded: b"cloud".to_vec(),
        };
        let store = FakeStore(Mutex::new(Some(StoredSyncMetadata {
            provider: String::from("fake"),
            remote_file_id: Some(String::from("file")),
            etag: Some(String::from("e1")),
            last_synced_at: Some(String::from("2026-11-13T09:00:00Z")),
            cursor: Some(String::from("1")),
            updated_at: String::from("2026-11-13T09:00:00Z"),
        })));
        let database = FakeDatabase {
            bytes: b"local".to_vec(),
            imported: Mutex::new(None),
        };

        let outcome = run(
            &provider,
            &store,
            &database,
            SyncRequest {
                revision: 2,
                synced_revision: Some(1),
                choice: None,
            },
        );

        assert_eq!(outcome.decision, SyncDecision::NeedsChoice);
        assert!(!outcome.completed);
        assert!(database.imported.lock().expect("imported").is_none());
        assert!(provider.uploaded.lock().expect("uploaded").is_none());
    }

    #[test]
    fn an_explicit_download_replaces_the_local_database() {
        let image = onspot_image();
        let provider = FakeProvider {
            remote: Mutex::new(Some(RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e2"),
                size: Some(4),
            })),
            uploaded: Mutex::new(None),
            downloaded: image.clone(),
        };
        let store = FakeStore(Mutex::new(None));
        let database = FakeDatabase {
            bytes: b"local".to_vec(),
            imported: Mutex::new(None),
        };

        let outcome = run(
            &provider,
            &store,
            &database,
            SyncRequest {
                revision: 2,
                synced_revision: Some(1),
                choice: Some(SyncChoice::Download),
            },
        );

        assert_eq!(outcome.decision, SyncDecision::Download);
        assert!(outcome.completed);
        assert!(outcome.replaced_local);
        assert_eq!(
            database.imported.lock().expect("imported").as_deref(),
            Some(image.as_slice())
        );
    }

    #[test]
    fn a_foreign_cloud_copy_never_reaches_the_device_database() {
        let provider = FakeProvider {
            remote: Mutex::new(Some(RemoteSnapshot {
                id: String::from("file"),
                name: String::from("onspot.sqlite"),
                modified_at: String::from("2026-11-13T10:00:00Z"),
                etag: String::from("e2"),
                size: Some(4),
            })),
            uploaded: Mutex::new(None),
            downloaded: b"definitely not a database".to_vec(),
        };
        let store = FakeStore(Mutex::new(None));
        let database = FakeDatabase {
            bytes: b"local".to_vec(),
            imported: Mutex::new(None),
        };

        let error = futures::executor::block_on(run_sync(
            &provider,
            &store,
            &database,
            &FixedClock,
            &SyncRequest {
                revision: 2,
                synced_revision: Some(1),
                choice: Some(SyncChoice::Download),
            },
        ))
        .expect_err("a foreign image must not be imported");

        assert_eq!(error.code, "sync.invalid_backup");
        assert!(database.imported.lock().expect("imported").is_none());
    }

    #[test]
    fn a_download_without_a_remote_file_is_refused() {
        let provider = FakeProvider::default();
        let store = FakeStore(Mutex::new(None));
        let database = FakeDatabase {
            bytes: Vec::new(),
            imported: Mutex::new(None),
        };

        let error = futures::executor::block_on(run_sync(
            &provider,
            &store,
            &database,
            &FixedClock,
            &SyncRequest {
                revision: 1,
                synced_revision: None,
                choice: Some(SyncChoice::Download),
            },
        ))
        .expect_err("no remote");

        assert_eq!(error.code, "sync.no_remote");
    }

    struct FixedOAuth;

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl OAuthBroker for FixedOAuth {
        async fn access_token(&self, _force_refresh: bool) -> Result<String, CoreError> {
            Ok(String::from("token"))
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait::async_trait(?Send)]
    impl OAuthBroker for FixedOAuth {
        async fn access_token(&self, _force_refresh: bool) -> Result<String, CoreError> {
            Ok(String::from("token"))
        }
    }

    #[test]
    fn the_fake_oauth_broker_hands_out_a_token() {
        let broker = FixedOAuth;
        let token = futures::executor::block_on(broker.access_token(false)).expect("token");
        assert_eq!(token, "token");
    }
}
