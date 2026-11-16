// SPDX-License-Identifier: AGPL-3.0-or-later

//! A device-local counter of learner-data writes, ported from
//! `src/lib/adapters/db/revision.ts`.
//!
//! Sync cannot compare database files byte for byte: SQLite's header change
//! counter and free-page contents differ on every export even when the data is
//! identical. A counter bumped by each content write answers "has this device
//! changed since its last sync?" exactly and in constant time.
//!
//! It lives in the [`DeviceStore`], not the database: it describes this
//! device's unsynced work, and writing it into the database would itself count
//! as a content change. The keys are the ones the web driver always used, so a
//! device that synced before keeps its place.
//!
//! The repositories are wrapped ([`RevisionTrackingRecords`],
//! [`RevisionTrackingHistory`]) so every write the learner would lose counts,
//! whichever use case makes it: prompts, sessions and takes, as before.
//! Glosses, translations, corrections, audio and sync metadata ride along with
//! a take or are caches, and never counted.

use std::sync::{Arc, Mutex, MutexGuard};

use onspot_domain::{
    Attempt, AttemptPreview, AudioAsset, Correction, Prompt, PromptSubmission, Session,
    SyncMetadata, TranslationSet, WordGlosses,
};
use onspot_ports::{DeviceStore, HistoryStore, RecordsStore, StoreError};

/// Where the device's current revision is kept.
pub const REVISION_KEY: &str = "onspot.db.revision";

/// Prefix of the revision last synced with each provider.
pub const SYNCED_PREFIX: &str = "onspot.sync.synced.";

/// What this run has seen, so a store that cannot write still counts.
#[derive(Default)]
struct Remembered {
    revision: u64,
    synced: std::collections::BTreeMap<String, u64>,
}

/// The device's content revision and the revision each provider last saw.
pub struct ContentRevision {
    store: Arc<dyn DeviceStore>,
    remembered: Mutex<Remembered>,
}

impl ContentRevision {
    /// Creates the counter over the device's store.
    pub fn new(store: Arc<dyn DeviceStore>) -> Self {
        Self {
            store,
            remembered: Mutex::new(Remembered::default()),
        }
    }

    /// The device's current content revision; zero on a fresh device.
    pub async fn current(&self) -> u64 {
        let stored = self.read_number(REVISION_KEY).await.unwrap_or(0);
        stored.max(self.lock().revision)
    }

    /// Records that learner data was written.
    pub async fn mark_changed(&self) {
        let next = self.current().await + 1;
        self.lock().revision = next;
        self.write_number(REVISION_KEY, next).await;
    }

    /// The revision this device last synced with `provider`, or `None` if never.
    pub async fn synced(&self, provider: &str) -> Option<u64> {
        let stored = self.read_number(&synced_key(provider)).await;
        let remembered = self.lock().synced.get(provider).copied();
        match (stored, remembered) {
            (Some(stored), Some(remembered)) => Some(stored.max(remembered)),
            (stored, remembered) => stored.or(remembered),
        }
    }

    /// Records that `provider` now holds `revision`.
    pub async fn set_synced(&self, provider: &str, revision: u64) {
        self.lock().synced.insert(provider.to_owned(), revision);
        self.write_number(&synced_key(provider), revision).await;
    }

    async fn read_number(&self, key: &str) -> Option<u64> {
        // An unreadable store behaves like a fresh one; the in-run memory still counts.
        let text = self.store.read(key).await.ok().flatten()?;
        text.trim().parse().ok()
    }

    async fn write_number(&self, key: &str, value: u64) {
        // A full or blocked store keeps the in-run memory, as the web driver did.
        let _ = self.store.write(key, &value.to_string()).await;
    }

    fn lock(&self) -> MutexGuard<'_, Remembered> {
        self.remembered
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn synced_key(provider: &str) -> String {
    format!("{SYNCED_PREFIX}{provider}")
}

/// The records repository, counting the writes sync must notice.
pub struct RevisionTrackingRecords {
    inner: Arc<dyn RecordsStore>,
    revision: Arc<ContentRevision>,
}

impl RevisionTrackingRecords {
    /// Wraps `inner`; every prompt, session and take write bumps `revision`.
    pub fn new(inner: Arc<dyn RecordsStore>, revision: Arc<ContentRevision>) -> Self {
        Self { inner, revision }
    }

    /// Bumps the revision after a write that happened.
    async fn counted<T>(&self, written: Result<T, StoreError>) -> Result<T, StoreError> {
        if written.is_ok() {
            self.revision.mark_changed().await;
        }
        written
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl RecordsStore for RevisionTrackingRecords {
    async fn list_prompts(
        &self,
        target_language: Option<&str>,
        instruction_language: Option<&str>,
    ) -> Result<Vec<Prompt>, StoreError> {
        self.inner
            .list_prompts(target_language, instruction_language)
            .await
    }

    async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, StoreError> {
        self.inner.get_prompt(id).await
    }

    async fn put_prompt(&self, prompt: &Prompt) -> Result<(), StoreError> {
        let written = self.inner.put_prompt(prompt).await;
        self.counted(written).await
    }

    async fn delete_prompt(&self, id: &str) -> Result<bool, StoreError> {
        let written = self.inner.delete_prompt(id).await;
        self.counted(written).await
    }

    async fn get_session(&self, id: &str) -> Result<Option<Session>, StoreError> {
        self.inner.get_session(id).await
    }

    async fn put_session(&self, session: &Session) -> Result<(), StoreError> {
        let written = self.inner.put_session(session).await;
        self.counted(written).await
    }

    async fn list_attempts(&self, session_id: &str) -> Result<Vec<Attempt>, StoreError> {
        self.inner.list_attempts(session_id).await
    }

    async fn list_all_attempts(&self) -> Result<Vec<Attempt>, StoreError> {
        self.inner.list_all_attempts().await
    }

    async fn get_attempt(&self, id: &str) -> Result<Option<Attempt>, StoreError> {
        self.inner.get_attempt(id).await
    }

    async fn put_attempt(&self, attempt: &Attempt) -> Result<(), StoreError> {
        let written = self.inner.put_attempt(attempt).await;
        self.counted(written).await
    }

    async fn delete_attempt(&self, id: &str) -> Result<bool, StoreError> {
        let written = self.inner.delete_attempt(id).await;
        self.counted(written).await
    }

    async fn get_word_glosses(&self, attempt_id: &str) -> Result<Option<WordGlosses>, StoreError> {
        self.inner.get_word_glosses(attempt_id).await
    }

    async fn set_word_glosses(
        &self,
        attempt_id: &str,
        glosses: &WordGlosses,
    ) -> Result<bool, StoreError> {
        self.inner.set_word_glosses(attempt_id, glosses).await
    }

    async fn get_translations(
        &self,
        attempt_id: &str,
    ) -> Result<Option<TranslationSet>, StoreError> {
        self.inner.get_translations(attempt_id).await
    }

    async fn set_translations(
        &self,
        attempt_id: &str,
        translations: &TranslationSet,
    ) -> Result<bool, StoreError> {
        self.inner.set_translations(attempt_id, translations).await
    }

    async fn list_corrections(&self, attempt_id: &str) -> Result<Vec<Correction>, StoreError> {
        self.inner.list_corrections(attempt_id).await
    }

    async fn list_all_corrections(&self) -> Result<Vec<Correction>, StoreError> {
        self.inner.list_all_corrections().await
    }

    async fn replace_corrections(
        &self,
        attempt_id: &str,
        corrections: &[Correction],
    ) -> Result<(), StoreError> {
        self.inner
            .replace_corrections(attempt_id, corrections)
            .await
    }

    async fn put_audio(&self, asset: &AudioAsset) -> Result<(), StoreError> {
        self.inner.put_audio(asset).await
    }

    async fn get_audio(&self, key: &str) -> Result<Option<AudioAsset>, StoreError> {
        self.inner.get_audio(key).await
    }

    async fn delete_audio(&self, key: &str) -> Result<bool, StoreError> {
        self.inner.delete_audio(key).await
    }

    async fn delete_attempt_audio(&self, attempt_id: &str) -> Result<u64, StoreError> {
        self.inner.delete_attempt_audio(attempt_id).await
    }

    async fn list_prompt_submissions(&self) -> Result<Vec<PromptSubmission>, StoreError> {
        self.inner.list_prompt_submissions().await
    }

    async fn put_prompt_submission(&self, submission: &PromptSubmission) -> Result<(), StoreError> {
        self.inner.put_prompt_submission(submission).await
    }

    async fn mark_prompt_submission_failed(
        &self,
        id: &str,
        error: &str,
        attempted_at: &str,
    ) -> Result<bool, StoreError> {
        self.inner
            .mark_prompt_submission_failed(id, error, attempted_at)
            .await
    }

    async fn delete_prompt_submission(&self, id: &str) -> Result<bool, StoreError> {
        self.inner.delete_prompt_submission(id).await
    }

    async fn get_sync_metadata(&self, provider: &str) -> Result<Option<SyncMetadata>, StoreError> {
        self.inner.get_sync_metadata(provider).await
    }

    async fn set_sync_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError> {
        self.inner.set_sync_metadata(metadata).await
    }
}

/// The history repository, counting renames and deletes.
pub struct RevisionTrackingHistory {
    inner: Arc<dyn HistoryStore>,
    revision: Arc<ContentRevision>,
}

impl RevisionTrackingHistory {
    /// Wraps `inner`; a rename or delete that matched a session bumps `revision`.
    pub fn new(inner: Arc<dyn HistoryStore>, revision: Arc<ContentRevision>) -> Self {
        Self { inner, revision }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl HistoryStore for RevisionTrackingHistory {
    async fn list_sessions(&self) -> Result<Vec<Session>, StoreError> {
        self.inner.list_sessions().await
    }

    async fn list_attempt_previews(&self) -> Result<Vec<AttemptPreview>, StoreError> {
        self.inner.list_attempt_previews().await
    }

    async fn rename_session(&self, id: &str, title: &str) -> Result<bool, StoreError> {
        let renamed = self.inner.rename_session(id, title).await?;
        if renamed {
            self.revision.mark_changed().await;
        }
        Ok(renamed)
    }

    async fn delete_session(&self, id: &str) -> Result<bool, StoreError> {
        let deleted = self.inner.delete_session(id).await?;
        if deleted {
            self.revision.mark_changed().await;
        }
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use futures::executor::block_on;
    use onspot_adapter_repo_sql::{migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore};
    use onspot_ports::CoreError;

    use super::*;

    #[derive(Default)]
    struct MemoryStore(Mutex<BTreeMap<String, String>>);

    #[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
    #[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
    impl DeviceStore for MemoryStore {
        async fn read(&self, key: &str) -> Result<Option<String>, CoreError> {
            Ok(self.0.lock().expect("store").get(key).cloned())
        }

        async fn write(&self, key: &str, value: &str) -> Result<(), CoreError> {
            self.0
                .lock()
                .expect("store")
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }
    }

    struct Fixture {
        device: Arc<MemoryStore>,
        revision: Arc<ContentRevision>,
        records: RevisionTrackingRecords,
        history: RevisionTrackingHistory,
    }

    fn fixture() -> Fixture {
        let driver = Arc::new(RusqliteDriver::open_in_memory().expect("database"));
        block_on(migrate(driver.as_ref())).expect("migrate");
        let device = Arc::new(MemoryStore::default());
        let revision = Arc::new(ContentRevision::new(device.clone()));
        Fixture {
            records: RevisionTrackingRecords::new(
                Arc::new(SqlRecordsStore::new(driver.clone())),
                revision.clone(),
            ),
            history: RevisionTrackingHistory::new(
                Arc::new(SqlHistoryStore::new(driver)),
                revision.clone(),
            ),
            device,
            revision,
        }
    }

    fn session(id: &str) -> Session {
        Session {
            id: id.to_owned(),
            title: String::from("Le marché"),
            mode: String::from("casual"),
            started_at: String::from("2026-11-16T10:00:00.000Z"),
            ended_at: None,
            created_at: String::from("2026-11-16T10:00:00.000Z"),
            updated_at: String::from("2026-11-16T10:00:00.000Z"),
            setup: None,
        }
    }

    #[test]
    fn learner_writes_count_and_caches_do_not() {
        let fixture = fixture();
        assert_eq!(block_on(fixture.revision.current()), 0);

        block_on(fixture.records.put_session(&session("s-1"))).expect("session");
        assert_eq!(block_on(fixture.revision.current()), 1);

        // A missing take's translations write nothing, and translations are a cache anyway.
        let translations = TranslationSet {
            version: Some(3),
            instruction_language: None,
            idiomatic: String::from("At the market."),
            idiomatic_variants: Vec::new(),
            literal: String::from("At the market."),
            word_for_word: String::from("At-the market."),
            word_breakdown: Vec::new(),
        };
        block_on(fixture.records.set_translations("missing", &translations)).expect("translations");
        assert_eq!(block_on(fixture.revision.current()), 1);

        assert!(block_on(fixture.history.rename_session("s-1", "Au marché")).expect("rename"));
        assert!(!block_on(fixture.history.rename_session("missing", "x")).expect("rename"));
        assert_eq!(block_on(fixture.revision.current()), 2);

        assert!(block_on(fixture.history.delete_session("s-1")).expect("delete"));
        assert_eq!(block_on(fixture.revision.current()), 3);
    }

    #[test]
    fn the_web_drivers_stored_revisions_carry_over() {
        let fixture = fixture();
        fixture.device.0.lock().expect("store").extend([
            (String::from(REVISION_KEY), String::from("41")),
            (format!("{SYNCED_PREFIX}webdav"), String::from("40")),
        ]);

        assert_eq!(block_on(fixture.revision.current()), 41);
        assert_eq!(block_on(fixture.revision.synced("webdav")), Some(40));
        assert_eq!(block_on(fixture.revision.synced("google-drive")), None);

        block_on(fixture.revision.mark_changed());
        block_on(fixture.revision.set_synced("webdav", 42));
        let stored = fixture.device.0.lock().expect("store").clone();
        assert_eq!(stored[REVISION_KEY], "42");
        assert_eq!(stored[&format!("{SYNCED_PREFIX}webdav")], "42");
    }
}
