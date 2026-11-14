// SPDX-License-Identifier: AGPL-3.0-or-later

//! Files the learner saves or picks, and the database snapshot they carry.
//!
//! Export and restore cross the driver boundary in both directions: the core
//! owns the format checks, the file name and the restore flow, while the
//! driver owns the dialog, the filesystem and (in the browser) the SQLite
//! worker. No raw path ever reaches the core.

use async_trait::async_trait;

use crate::CoreError;

/// A file the learner picked, read into memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickedFile {
    /// The name the file had on disk, for the confirmation copy.
    pub file_name: String,
    /// The whole file.
    pub bytes: Vec<u8>,
}

/// How much data a restored snapshot holds, for the confirmation notice.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RestoreCounts {
    /// Sessions in the restored database.
    pub sessions: usize,
    /// Takes across those sessions.
    pub attempts: usize,
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;

    /// Saves bytes to a place the learner chooses, and picks files back.
    #[async_trait]
    pub trait FileSystemSink: Send + Sync {
        /// Saves `bytes` under a suggested name.
        ///
        /// @returns `true` after a write, `false` when the learner cancelled.
        async fn save(&self, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError>;

        /// Asks the learner for a file.
        ///
        /// @returns The file's name and bytes, or `None` when they cancelled.
        async fn pick(&self) -> Result<Option<PickedFile>, CoreError>;
    }

    /// The database image itself: a whole-file export and a whole-file replace.
    #[async_trait]
    pub trait DatabaseFile: Send + Sync {
        /// A consistent copy of the database as a standard SQLite image.
        async fn export_bytes(&self) -> Result<Vec<u8>, CoreError>;

        /// Replaces the database with a standard SQLite image.
        ///
        /// Counts come from the restored database, not from the caller, so a
        /// driver that restores through a different engine still reports the
        /// truth.
        async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError>;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;

    /// Saves bytes to a place the learner chooses, and picks files back.
    #[async_trait(?Send)]
    pub trait FileSystemSink {
        /// Saves `bytes` under a suggested name.
        ///
        /// @returns `true` after a write, `false` when the learner cancelled.
        async fn save(&self, file_name: &str, bytes: &[u8]) -> Result<bool, CoreError>;

        /// Asks the learner for a file.
        ///
        /// @returns The file's name and bytes, or `None` when they cancelled.
        async fn pick(&self) -> Result<Option<PickedFile>, CoreError>;
    }

    /// The database image itself: a whole-file export and a whole-file replace.
    #[async_trait(?Send)]
    pub trait DatabaseFile {
        /// A consistent copy of the database as a standard SQLite image.
        async fn export_bytes(&self) -> Result<Vec<u8>, CoreError>;

        /// Replaces the database with a standard SQLite image.
        async fn import_bytes(&self, bytes: &[u8]) -> Result<RestoreCounts, CoreError>;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::{DatabaseFile, FileSystemSink};

#[cfg(target_arch = "wasm32")]
pub use web::{DatabaseFile, FileSystemSink};
