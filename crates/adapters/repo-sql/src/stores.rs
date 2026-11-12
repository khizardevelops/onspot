// SPDX-License-Identifier: AGPL-3.0-or-later

//! The typed repositories over [`SqlDriver`].
//!
//! SQL is the legacy adapter's, column for column: `settings` in
//! `SqlDatabaseAdapter.getSetting/setSetting/listSettings` and the session and
//! attempt reads in `listSessions`/`listAllAttempts` plus the store's rename
//! and delete. JSON columns are parsed with the same tolerance (a malformed
//! value becomes `None`).

use std::sync::Arc;

use async_trait::async_trait;
use onspot_domain::{AttemptPreview, Session, SessionSetup, Setting};
use onspot_ports::{
    HistoryStore, SettingsStore, SqlDriver, SqlRow, SqlStatement, SqlValue, StoreError,
};

const SETTING_COLUMNS: &str = "key, value, updated_at AS updatedAt";

pub(crate) const NOW_SQL: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// Settings rows, read and written through the shared driver.
pub struct SqlSettingsStore {
    driver: Arc<dyn SqlDriver>,
}

impl SqlSettingsStore {
    /// Creates the store over an open driver.
    pub fn new(driver: Arc<dyn SqlDriver>) -> Self {
        Self { driver }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SettingsStore for SqlSettingsStore {
    async fn list(&self) -> Result<Vec<Setting>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {SETTING_COLUMNS} FROM settings ORDER BY key ASC"),
                &[],
            )
            .await?;
        rows.iter().map(setting_from_row).collect()
    }

    async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        let rows = self
            .driver
            .select("SELECT value FROM settings WHERE key = ?", &[key.into()])
            .await?;
        Ok(rows
            .first()
            .and_then(|row| row.get("value"))
            .and_then(SqlValue::as_str)
            .map(str::to_owned))
    }

    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.driver
            .execute(
                &format!(
                    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, {NOW_SQL})
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
                ),
                &[key.into(), value.into()],
            )
            .await?;
        Ok(())
    }
}

/// Sessions and take previews for the history screen.
pub struct SqlHistoryStore {
    driver: Arc<dyn SqlDriver>,
}

impl SqlHistoryStore {
    /// Creates the store over an open driver.
    pub fn new(driver: Arc<dyn SqlDriver>) -> Self {
        Self { driver }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl HistoryStore for SqlHistoryStore {
    async fn list_sessions(&self) -> Result<Vec<Session>, StoreError> {
        let rows = self
            .driver
            .select(
                "SELECT id, title, mode, started_at, ended_at, created_at, updated_at, setup
                 FROM sessions ORDER BY created_at DESC",
                &[],
            )
            .await?;
        rows.iter().map(session_from_row).collect()
    }

    async fn list_attempt_previews(&self) -> Result<Vec<AttemptPreview>, StoreError> {
        let rows = self
            .driver
            .select(
                "SELECT id, session_id, transcript, duration_sec, audio_key, created_at
                 FROM attempts ORDER BY created_at ASC",
                &[],
            )
            .await?;
        rows.iter().map(preview_from_row).collect()
    }

    async fn rename_session(&self, id: &str, title: &str) -> Result<bool, StoreError> {
        let statements = vec![SqlStatement::with_params(
            format!("UPDATE sessions SET title = ?, updated_at = {NOW_SQL} WHERE id = ?"),
            vec![title.into(), id.into()],
        )];
        let changed = if self.driver.supports_batch() {
            self.driver.batch(&statements).await?;
            self.driver
                .select("SELECT changes() AS changed", &[])
                .await?
                .first()
                .and_then(|row| row.get("changed"))
                .and_then(SqlValue::as_i64)
                .unwrap_or(0)
        } else {
            self.driver
                .execute(&statements[0].sql, &statements[0].params)
                .await?;
            self.driver
                .select("SELECT changes() AS changed", &[])
                .await?
                .first()
                .and_then(|row| row.get("changed"))
                .and_then(SqlValue::as_i64)
                .unwrap_or(0)
        };
        Ok(changed > 0)
    }

    async fn delete_session(&self, id: &str) -> Result<bool, StoreError> {
        self.driver
            .execute("DELETE FROM sessions WHERE id = ?", &[id.into()])
            .await?;
        let changed = self
            .driver
            .select("SELECT changes() AS changed", &[])
            .await?
            .first()
            .and_then(|row| row.get("changed"))
            .and_then(SqlValue::as_i64)
            .unwrap_or(0);
        Ok(changed > 0)
    }
}

pub(crate) fn required_text(row: &SqlRow, column: &str) -> Result<String, StoreError> {
    row.get(column)
        .and_then(SqlValue::as_str)
        .map(str::to_owned)
        .ok_or_else(|| StoreError::new(format!("column `{column}` is missing or not text")))
}

pub(crate) fn optional_text(row: &SqlRow, column: &str) -> Option<String> {
    row.get(column)
        .and_then(SqlValue::as_str)
        .map(str::to_owned)
}

fn setting_from_row(row: &SqlRow) -> Result<Setting, StoreError> {
    Ok(Setting {
        key: required_text(row, "key")?,
        value: required_text(row, "value")?,
        updated_at: required_text(row, "updatedAt")?,
    })
}

/// Parses `sessions.setup` with the legacy completeness rule: every string
/// field present, and a numeric pace. Anything else is `None`.
fn parse_setup(json: Option<&str>) -> Option<SessionSetup> {
    let json = json?;
    serde_json::from_str::<SessionSetup>(json).ok()
}

pub(crate) fn session_from_row(row: &SqlRow) -> Result<Session, StoreError> {
    Ok(Session {
        id: required_text(row, "id")?,
        title: required_text(row, "title")?,
        mode: required_text(row, "mode")?,
        started_at: required_text(row, "started_at")?,
        ended_at: optional_text(row, "ended_at"),
        created_at: required_text(row, "created_at")?,
        updated_at: required_text(row, "updated_at")?,
        setup: parse_setup(optional_text(row, "setup").as_deref()),
    })
}

fn preview_from_row(row: &SqlRow) -> Result<AttemptPreview, StoreError> {
    let duration_sec = row
        .get("duration_sec")
        .and_then(SqlValue::as_f64)
        .ok_or_else(|| StoreError::new("column `duration_sec` is missing or not numeric"))?;
    Ok(AttemptPreview {
        id: required_text(row, "id")?,
        session_id: required_text(row, "session_id")?,
        transcript: required_text(row, "transcript")?,
        duration_sec,
        audio_key: optional_text(row, "audio_key"),
        created_at: required_text(row, "created_at")?,
    })
}

/// Binds an optional string, keeping SQL `NULL` for `None`.
pub(crate) fn text_opt(value: &Option<String>) -> SqlValue {
    value.clone().map_or(SqlValue::Null, SqlValue::Text)
}
