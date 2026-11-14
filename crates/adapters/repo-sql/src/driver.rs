// SPDX-License-Identifier: AGPL-3.0-or-later

//! The native SQL driver: `rusqlite` with the bundled SQLite build.
//!
//! A single connection behind a mutex, matching the legacy adapter's one
//! engine per process. Queries are short and local; the blocking call happens
//! on whichever runtime thread invokes the command, as the Tauri SQL plugin
//! did before it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use onspot_ports::{
    CoreError, DatabaseFile, RestoreCounts, SqlDriver, SqlError, SqlRow, SqlStatement, SqlValue,
};
use rusqlite::types::Value as RusqliteValue;
use rusqlite::{Connection, OpenFlags};

/// A `rusqlite` connection implementing the repository driver port.
pub struct RusqliteDriver {
    connection: Mutex<Connection>,
}

impl RusqliteDriver {
    /// Opens (or creates) the database file.
    ///
    /// `SQLITE_OPEN_READ_WRITE | SQLITE_OPEN_CREATE` matches the plugin's
    /// behaviour; the busy timeout lets a second connection (the legacy plugin,
    /// still registered in this phase) finish its write instead of failing.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SqlError> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(engine_error)?;
        Self::configure(connection)
    }

    /// Opens a transient in-memory database, for tests and fixtures.
    pub fn open_in_memory() -> Result<Self, SqlError> {
        let connection = Connection::open_in_memory().map_err(engine_error)?;
        Self::configure(connection)
    }

    fn configure(connection: Connection) -> Result<Self, SqlError> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(engine_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .map_err(engine_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, SqlError> {
        self.connection
            .lock()
            .map_err(|_| SqlError::new("the database connection is poisoned"))
    }
}

fn engine_error(error: rusqlite::Error) -> SqlError {
    SqlError::new(error.to_string())
}

fn bind_values(values: &[SqlValue]) -> Vec<RusqliteValue> {
    values
        .iter()
        .map(|value| match value {
            SqlValue::Null => RusqliteValue::Null,
            SqlValue::Integer(value) => RusqliteValue::Integer(*value),
            SqlValue::Real(value) => RusqliteValue::Real(*value),
            SqlValue::Text(value) => RusqliteValue::Text(value.clone()),
        })
        .collect()
}

fn text_value(value: rusqlite::types::ValueRef<'_>) -> SqlValue {
    match value {
        rusqlite::types::ValueRef::Null => SqlValue::Null,
        rusqlite::types::ValueRef::Integer(value) => SqlValue::Integer(value),
        rusqlite::types::ValueRef::Real(value) => SqlValue::Real(value),
        rusqlite::types::ValueRef::Text(bytes) => {
            // A TEXT column written by SQLite is UTF-8; a corrupt file should
            // not panic the app, so lossy decoding matches the web driver's
            // string boundary.
            SqlValue::Text(String::from_utf8_lossy(bytes).into_owned())
        }
        rusqlite::types::ValueRef::Blob(bytes) => {
            SqlValue::Text(String::from_utf8_lossy(bytes).into_owned())
        }
    }
}

/// A unique temporary path for a snapshot that never outlives the call.
fn snapshot_temp_path(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("onspot-{label}-{nanos}.sqlite"))
}

fn snapshot_error(context: &str, error: impl std::fmt::Display) -> CoreError {
    CoreError::new("storage.snapshot_failed", format!("{context}: {error}"))
}

#[async_trait]
impl DatabaseFile for RusqliteDriver {
    async fn export_bytes(&self) -> Result<Vec<u8>, CoreError> {
        let path = snapshot_temp_path("export");
        let path_text = path.to_string_lossy().into_owned();
        let export = (|| -> Result<(), CoreError> {
            let connection = self
                .lock()
                .map_err(|error| snapshot_error("the database connection is unavailable", error))?;
            // `VACUUM INTO` writes one consistent, compact image without
            // touching the live file, so an open connection is safe.
            connection
                .execute("VACUUM INTO ?1", rusqlite::params![path_text])
                .map_err(|error| snapshot_error("the database could not be exported", error))?;
            Ok(())
        })();
        if let Err(error) = export {
            let _ = std::fs::remove_file(&path);
            return Err(error);
        }
        let bytes = std::fs::read(&path)
            .map_err(|error| snapshot_error("the export could not be read back", error));
        let _ = std::fs::remove_file(&path);
        bytes
    }

    async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError> {
        let path = snapshot_temp_path("restore");
        std::fs::write(&path, bytes)
            .map_err(|error| snapshot_error("the backup could not be staged", error))?;

        let restore = (|| -> Result<(), CoreError> {
            let source = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| snapshot_error("the backup is not readable SQLite", error))?;
            let mut destination = self
                .lock()
                .map_err(|error| snapshot_error("the database connection is unavailable", error))?;
            // SQLite's own backup API copies page-by-page into the open
            // connection, so no other connection (the legacy plugin, a second
            // window) is left pointing at a replaced file.
            let backup = rusqlite::backup::Backup::new(&source, &mut destination)
                .map_err(|error| snapshot_error("the backup could not be opened", error))?;
            backup
                .run_to_completion(5, Duration::from_millis(10), None)
                .map_err(|error| snapshot_error("the backup could not be restored", error))
        })();
        let _ = std::fs::remove_file(&path);
        restore?;

        // A snapshot from an older release still has to open on this build.
        crate::migrate(self).await.map_err(|error| {
            snapshot_error("the restored database could not be migrated", error)
        })?;

        Ok(RestoreCounts {
            sessions: self.count_rows("sessions").await?,
            attempts: self.count_rows("attempts").await?,
        })
    }
}

impl RusqliteDriver {
    async fn count_rows(&self, table: &str) -> Result<usize, CoreError> {
        let rows = self
            .select(&format!("SELECT COUNT(*) AS total FROM {table}"), &[])
            .await
            .map_err(|error| snapshot_error("the restored rows could not be counted", error))?;
        let total = rows
            .first()
            .and_then(|row| row.get("total"))
            .and_then(SqlValue::as_i64)
            .unwrap_or_default();
        Ok(total.max(0) as usize)
    }
}

#[async_trait]
impl SqlDriver for RusqliteDriver {
    fn supports_batch(&self) -> bool {
        true
    }

    async fn execute(&self, sql: &str, params: &[SqlValue]) -> Result<(), SqlError> {
        let connection = self.lock()?;
        let values = bind_values(params);
        connection
            .execute(sql, rusqlite::params_from_iter(values.iter()))
            .map_err(engine_error)?;
        Ok(())
    }

    async fn select(&self, sql: &str, params: &[SqlValue]) -> Result<Vec<SqlRow>, SqlError> {
        let connection = self.lock()?;
        let values = bind_values(params);
        let mut statement = connection.prepare(sql).map_err(engine_error)?;
        let columns: Vec<String> = statement
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect();
        let mut rows = statement
            .query(rusqlite::params_from_iter(values.iter()))
            .map_err(engine_error)?;

        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(engine_error)? {
            let mut map = SqlRow::new();
            for (index, name) in columns.iter().enumerate() {
                let value = row.get_ref(index).map_err(engine_error)?;
                map.insert(name.clone(), text_value(value));
            }
            out.push(map);
        }
        Ok(out)
    }

    async fn batch(&self, statements: &[SqlStatement]) -> Result<(), SqlError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction().map_err(engine_error)?;
        for statement in statements {
            let values = bind_values(&statement.params);
            transaction
                .execute(&statement.sql, rusqlite::params_from_iter(values.iter()))
                .map_err(engine_error)?;
        }
        transaction.commit().map_err(engine_error)
    }

    async fn close(&self) -> Result<(), SqlError> {
        let mut connection = self.lock()?;
        let replacement = Connection::open_in_memory().map_err(engine_error)?;
        let old = std::mem::replace(&mut *connection, replacement);
        old.close().map_err(|(_, error)| engine_error(error))
    }
}
