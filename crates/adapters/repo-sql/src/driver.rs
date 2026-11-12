// SPDX-License-Identifier: AGPL-3.0-or-later

//! The native SQL driver: `rusqlite` with the bundled SQLite build.
//!
//! A single connection behind a mutex, matching the legacy adapter's one
//! engine per process. Queries are short and local; the blocking call happens
//! on whichever runtime thread invokes the command, as the Tauri SQL plugin
//! did before it.

use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use onspot_ports::{SqlDriver, SqlError, SqlRow, SqlStatement, SqlValue};
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
