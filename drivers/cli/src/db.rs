// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures::executor::block_on;
use onspot_adapter_repo_sql::{
    migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore, SqlSettingsStore,
};
use onspot_ports::SqlDriver;

use crate::error::CliError;

/// One open database and the repositories over it.
pub struct Context {
    pub path: PathBuf,
    pub driver: Arc<RusqliteDriver>,
    pub settings: Arc<SqlSettingsStore>,
    pub history: Arc<SqlHistoryStore>,
    pub records: Arc<SqlRecordsStore>,
}

impl Context {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CliError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let driver = Arc::new(RusqliteDriver::open(&path)?);
        block_on(migrate(driver.as_ref()))?;
        let sql: Arc<dyn SqlDriver> = driver.clone();
        Ok(Self {
            path,
            settings: Arc::new(SqlSettingsStore::new(sql.clone())),
            history: Arc::new(SqlHistoryStore::new(sql.clone())),
            records: Arc::new(SqlRecordsStore::new(sql)),
            driver,
        })
    }
}

/// The same database the desktop shell opens (`app_config_dir/onspot.db`).
pub fn default_db_path() -> PathBuf {
    config_dir().join("app.onspot.desktop").join("onspot.db")
}

/// The keyfile used when `--keys-file` and `ONSPOT_KEYS_FILE` are absent.
pub fn default_keys_path() -> PathBuf {
    config_dir().join("onspot").join("keys.json")
}

/// Per-device values that never enter the database (the usage ledger).
pub fn default_device_path() -> PathBuf {
    config_dir().join("onspot").join("device.json")
}

#[cfg(target_os = "windows")]
fn config_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_os = "macos")]
fn config_dir() -> PathBuf {
    home_dir().join("Library").join("Application Support")
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn config_dir() -> PathBuf {
    if let Some(config) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(config);
    }
    home_dir().join(".config")
}

#[cfg(not(target_os = "windows"))]
fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
