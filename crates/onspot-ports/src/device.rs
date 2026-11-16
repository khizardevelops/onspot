// SPDX-License-Identifier: AGPL-3.0-or-later

//! Values that belong to this device and must never enter the database.
//!
//! The database is what gets exported and synced. Some state is per device on
//! purpose: the usage ledger, for example, counts what this device's keys
//! spent, and two devices merging their ledgers would double-count. The driver
//! keeps these values next to the keys (browser `localStorage` in the webview,
//! a file for the CLI), never in SQLite.

use async_trait::async_trait;

use crate::CoreError;

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;

    /// A small key/value store local to this device.
    #[async_trait]
    pub trait DeviceStore: Send + Sync {
        /// Reads one value.
        ///
        /// @returns The stored text, or `None` when nothing is stored under `key`.
        async fn read(&self, key: &str) -> Result<Option<String>, CoreError>;

        /// Replaces one value.
        async fn write(&self, key: &str, value: &str) -> Result<(), CoreError>;
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;

    /// A small key/value store local to this device (wasm: same thread).
    #[async_trait(?Send)]
    pub trait DeviceStore {
        /// Reads one value.
        ///
        /// @returns The stored text, or `None` when nothing is stored under `key`.
        async fn read(&self, key: &str) -> Result<Option<String>, CoreError>;

        /// Replaces one value.
        async fn write(&self, key: &str, value: &str) -> Result<(), CoreError>;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::DeviceStore;
#[cfg(target_arch = "wasm32")]
pub use wasm::DeviceStore;
