// SPDX-License-Identifier: AGPL-3.0-or-later

//! The SQL port and the repository ports built on it.
//!
//! `SqlDriver` mirrors `src/lib/adapters/db/types.ts`: `execute`, `select`,
//! optional `batch`, `close`. `batch` stays optional because the drivers have
//! different transaction semantics: a native connection can begin a
//! transaction, while Tauri's SQL plugin pools connections and a `BEGIN` sent
//! through it may not share a connection with the statements after it.
//!
//! Native targets require `Send + Sync` because a Tauri command can run on any
//! runtime thread. The browser driver awaits JavaScript promises, which are
//! neither, so wasm uses the same surface without those bounds (single thread,
//! same as `EventSink`).

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use onspot_domain::{
    Attempt, AttemptPreview, AudioAsset, Correction, Prompt, PromptSubmission, Session, Setting,
    SyncMetadata, TranslationSet, WordGlosses,
};

/// A value accepted as a bind parameter, and returned from a row.
///
/// SQLite's four storage classes, without blobs: the app stores audio as
/// base64 text, exactly as the TypeScript drivers do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SqlValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
}

impl SqlValue {
    /// The value as text, if it is text.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Text(value) => Some(value),
            _ => None,
        }
    }

    /// The value as an integer. A whole-valued real counts: JavaScript has a
    /// single number type, so a wasm host returns `12` as `12.0`.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Integer(value) => Some(*value),
            Self::Real(value) if value.fract() == 0.0 => Some(*value as i64),
            _ => None,
        }
    }

    /// The value as a float, whether it was stored as an integer or a real.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Integer(value) => Some(*value as f64),
            Self::Real(value) => Some(*value),
            _ => None,
        }
    }
}

impl From<&str> for SqlValue {
    fn from(value: &str) -> Self {
        Self::Text(value.to_owned())
    }
}

impl From<String> for SqlValue {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}

impl From<i64> for SqlValue {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}

impl From<f64> for SqlValue {
    fn from(value: f64) -> Self {
        Self::Real(value)
    }
}

impl<T: Into<SqlValue>> From<Option<T>> for SqlValue {
    fn from(value: Option<T>) -> Self {
        value.map_or(Self::Null, Into::into)
    }
}

/// One statement of a [`SqlDriver::batch`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SqlStatement {
    pub sql: String,
    pub params: Vec<SqlValue>,
}

impl SqlStatement {
    /// A statement with no parameters.
    pub fn new(sql: impl Into<String>) -> Self {
        Self {
            sql: sql.into(),
            params: Vec::new(),
        }
    }

    /// A statement with bind parameters.
    pub fn with_params(sql: impl Into<String>, params: Vec<SqlValue>) -> Self {
        Self {
            sql: sql.into(),
            params,
        }
    }
}

/// A returned row, keyed by column name. A `BTreeMap` so iteration and
/// comparisons are deterministic in tests and fixtures.
pub type SqlRow = BTreeMap<String, SqlValue>;

/// A storage failure. The message is diagnostic; drivers map it to their own
/// learner-facing copy.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct SqlError {
    pub message: String,
}

impl SqlError {
    /// Creates an error from a diagnostic message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// A repository failure.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct StoreError {
    pub message: String,
}

impl StoreError {
    /// Creates an error from a diagnostic message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl From<SqlError> for StoreError {
    fn from(error: SqlError) -> Self {
        Self::new(error.message)
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;

    /// The SQL engine the repositories talk to.
    #[async_trait]
    pub trait SqlDriver: Send + Sync {
        /// Whether [`SqlDriver::batch`] runs the statements atomically.
        fn supports_batch(&self) -> bool {
            false
        }

        /// Runs a statement that returns no rows (INSERT/UPDATE/DELETE/DDL).
        async fn execute(&self, sql: &str, params: &[SqlValue]) -> Result<(), SqlError>;

        /// Runs a query and returns rows as plain column maps.
        async fn select(&self, sql: &str, params: &[SqlValue]) -> Result<Vec<SqlRow>, SqlError>;

        /// Runs statements as one transaction: all of them or none.
        ///
        /// Drivers without a connection-scoped transaction leave this
        /// unsupported; the migration runner then executes the statements in
        /// order, matching today's TypeScript fallback.
        async fn batch(&self, _statements: &[SqlStatement]) -> Result<(), SqlError> {
            Err(SqlError::new("this SQL driver has no batch support"))
        }

        /// Closes the connection. Idempotent.
        async fn close(&self) -> Result<(), SqlError>;
    }

    /// The session and attempt reads and writes the history screen needs.
    #[async_trait]
    pub trait HistoryStore: Send + Sync {
        /// Every session, newest first (the order the legacy adapter returns).
        async fn list_sessions(&self) -> Result<Vec<Session>, StoreError>;

        /// Every take's preview fields, oldest first.
        async fn list_attempt_previews(&self) -> Result<Vec<AttemptPreview>, StoreError>;

        /// Renames one session. `false` when no row matched.
        async fn rename_session(&self, id: &str, title: &str) -> Result<bool, StoreError>;

        /// Deletes one session and, by foreign-key cascade, its takes. `false`
        /// when no row matched.
        async fn delete_session(&self, id: &str) -> Result<bool, StoreError>;
    }

    /// The persisted settings rows, without the typed document's defaults (P4).
    #[async_trait]
    pub trait SettingsStore: Send + Sync {
        /// Every stored row, ordered by key.
        async fn list(&self) -> Result<Vec<Setting>, StoreError>;

        /// One stored value, or `None`.
        async fn get(&self, key: &str) -> Result<Option<String>, StoreError>;

        /// Inserts or replaces one value and stamps `updated_at`.
        async fn set(&self, key: &str, value: &str) -> Result<(), StoreError>;
    }
    /// The remaining typed reads and writes in `SqlDatabaseAdapter`: prompts,
    /// the full session/attempt rows, the JSON gloss/translation columns,
    /// corrections, audio, prompt submissions and sync metadata.
    ///
    /// Settings stay on [`SettingsStore`] because their typed document has its
    /// own defaults and merge rules. Usage is device-local `localStorage`, not
    /// a SQL table, so its port arrives with the P6 ledger.
    #[async_trait]
    pub trait RecordsStore: Send + Sync {
        async fn list_prompts(
            &self,
            target_language: Option<&str>,
            instruction_language: Option<&str>,
        ) -> Result<Vec<Prompt>, StoreError>;
        async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, StoreError>;
        async fn put_prompt(&self, prompt: &Prompt) -> Result<(), StoreError>;
        async fn delete_prompt(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_session(&self, id: &str) -> Result<Option<Session>, StoreError>;
        async fn put_session(&self, session: &Session) -> Result<(), StoreError>;

        async fn list_attempts(&self, session_id: &str) -> Result<Vec<Attempt>, StoreError>;
        async fn list_all_attempts(&self) -> Result<Vec<Attempt>, StoreError>;
        async fn get_attempt(&self, id: &str) -> Result<Option<Attempt>, StoreError>;
        async fn put_attempt(&self, attempt: &Attempt) -> Result<(), StoreError>;
        async fn delete_attempt(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_word_glosses(
            &self,
            attempt_id: &str,
        ) -> Result<Option<WordGlosses>, StoreError>;
        async fn set_word_glosses(
            &self,
            attempt_id: &str,
            glosses: &WordGlosses,
        ) -> Result<bool, StoreError>;
        async fn get_translations(
            &self,
            attempt_id: &str,
        ) -> Result<Option<TranslationSet>, StoreError>;
        async fn set_translations(
            &self,
            attempt_id: &str,
            translations: &TranslationSet,
        ) -> Result<bool, StoreError>;

        async fn list_corrections(&self, attempt_id: &str) -> Result<Vec<Correction>, StoreError>;
        async fn list_all_corrections(&self) -> Result<Vec<Correction>, StoreError>;
        async fn replace_corrections(
            &self,
            attempt_id: &str,
            corrections: &[Correction],
        ) -> Result<(), StoreError>;

        async fn put_audio(&self, asset: &AudioAsset) -> Result<(), StoreError>;
        async fn get_audio(&self, key: &str) -> Result<Option<AudioAsset>, StoreError>;
        async fn delete_audio(&self, key: &str) -> Result<bool, StoreError>;
        async fn delete_attempt_audio(&self, attempt_id: &str) -> Result<u64, StoreError>;

        async fn list_prompt_submissions(&self) -> Result<Vec<PromptSubmission>, StoreError>;
        async fn put_prompt_submission(
            &self,
            submission: &PromptSubmission,
        ) -> Result<(), StoreError>;
        async fn mark_prompt_submission_failed(
            &self,
            id: &str,
            error: &str,
            attempted_at: &str,
        ) -> Result<bool, StoreError>;
        async fn delete_prompt_submission(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_sync_metadata(
            &self,
            provider: &str,
        ) -> Result<Option<SyncMetadata>, StoreError>;
        async fn set_sync_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError>;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;

    /// The SQL engine the repositories talk to (browser: JS promises).
    #[async_trait(?Send)]
    pub trait SqlDriver {
        /// Whether [`SqlDriver::batch`] runs the statements atomically.
        fn supports_batch(&self) -> bool {
            false
        }

        /// Runs a statement that returns no rows (INSERT/UPDATE/DELETE/DDL).
        async fn execute(&self, sql: &str, params: &[SqlValue]) -> Result<(), SqlError>;

        /// Runs a query and returns rows as plain column maps.
        async fn select(&self, sql: &str, params: &[SqlValue]) -> Result<Vec<SqlRow>, SqlError>;

        /// Runs statements as one transaction: all of them or none.
        async fn batch(&self, _statements: &[SqlStatement]) -> Result<(), SqlError> {
            Err(SqlError::new("this SQL driver has no batch support"))
        }

        /// Closes the connection. Idempotent.
        async fn close(&self) -> Result<(), SqlError>;
    }

    /// The session and attempt reads and writes the history screen needs.
    #[async_trait(?Send)]
    pub trait HistoryStore {
        async fn list_sessions(&self) -> Result<Vec<Session>, StoreError>;
        async fn list_attempt_previews(&self) -> Result<Vec<AttemptPreview>, StoreError>;
        async fn rename_session(&self, id: &str, title: &str) -> Result<bool, StoreError>;
        async fn delete_session(&self, id: &str) -> Result<bool, StoreError>;
    }

    /// The persisted settings rows.
    #[async_trait(?Send)]
    pub trait SettingsStore {
        async fn list(&self) -> Result<Vec<Setting>, StoreError>;
        async fn get(&self, key: &str) -> Result<Option<String>, StoreError>;
        async fn set(&self, key: &str, value: &str) -> Result<(), StoreError>;
    }
    /// The remaining typed reads and writes in `SqlDatabaseAdapter`: prompts,
    /// the full session/attempt rows, the JSON gloss/translation columns,
    /// corrections, audio, prompt submissions and sync metadata.
    ///
    /// Settings stay on [`SettingsStore`] because their typed document has its
    /// own defaults and merge rules. Usage is device-local `localStorage`, not
    /// a SQL table, so its port arrives with the P6 ledger.
    #[async_trait(?Send)]
    pub trait RecordsStore {
        async fn list_prompts(
            &self,
            target_language: Option<&str>,
            instruction_language: Option<&str>,
        ) -> Result<Vec<Prompt>, StoreError>;
        async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, StoreError>;
        async fn put_prompt(&self, prompt: &Prompt) -> Result<(), StoreError>;
        async fn delete_prompt(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_session(&self, id: &str) -> Result<Option<Session>, StoreError>;
        async fn put_session(&self, session: &Session) -> Result<(), StoreError>;

        async fn list_attempts(&self, session_id: &str) -> Result<Vec<Attempt>, StoreError>;
        async fn list_all_attempts(&self) -> Result<Vec<Attempt>, StoreError>;
        async fn get_attempt(&self, id: &str) -> Result<Option<Attempt>, StoreError>;
        async fn put_attempt(&self, attempt: &Attempt) -> Result<(), StoreError>;
        async fn delete_attempt(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_word_glosses(
            &self,
            attempt_id: &str,
        ) -> Result<Option<WordGlosses>, StoreError>;
        async fn set_word_glosses(
            &self,
            attempt_id: &str,
            glosses: &WordGlosses,
        ) -> Result<bool, StoreError>;
        async fn get_translations(
            &self,
            attempt_id: &str,
        ) -> Result<Option<TranslationSet>, StoreError>;
        async fn set_translations(
            &self,
            attempt_id: &str,
            translations: &TranslationSet,
        ) -> Result<bool, StoreError>;

        async fn list_corrections(&self, attempt_id: &str) -> Result<Vec<Correction>, StoreError>;
        async fn list_all_corrections(&self) -> Result<Vec<Correction>, StoreError>;
        async fn replace_corrections(
            &self,
            attempt_id: &str,
            corrections: &[Correction],
        ) -> Result<(), StoreError>;

        async fn put_audio(&self, asset: &AudioAsset) -> Result<(), StoreError>;
        async fn get_audio(&self, key: &str) -> Result<Option<AudioAsset>, StoreError>;
        async fn delete_audio(&self, key: &str) -> Result<bool, StoreError>;
        async fn delete_attempt_audio(&self, attempt_id: &str) -> Result<u64, StoreError>;

        async fn list_prompt_submissions(&self) -> Result<Vec<PromptSubmission>, StoreError>;
        async fn put_prompt_submission(
            &self,
            submission: &PromptSubmission,
        ) -> Result<(), StoreError>;
        async fn mark_prompt_submission_failed(
            &self,
            id: &str,
            error: &str,
            attempted_at: &str,
        ) -> Result<bool, StoreError>;
        async fn delete_prompt_submission(&self, id: &str) -> Result<bool, StoreError>;

        async fn get_sync_metadata(
            &self,
            provider: &str,
        ) -> Result<Option<SyncMetadata>, StoreError>;
        async fn set_sync_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError>;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::{HistoryStore, RecordsStore, SettingsStore, SqlDriver};
#[cfg(target_arch = "wasm32")]
pub use web::{HistoryStore, RecordsStore, SettingsStore, SqlDriver};
