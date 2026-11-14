// SPDX-License-Identifier: AGPL-3.0-or-later

//! Local speech-data downloads: the models and voices a language needs.
//!
//! The core decides what is missing and in which order; the driver owns the
//! model caches and the workers that fetch the bytes. The port reports
//! progress so the core can emit one combined figure for the UI bar.

use async_trait::async_trait;

use crate::{CancelToken, CoreError, ModelProgress};

/// Receives download/load progress for one part of the language data.
#[cfg(not(target_arch = "wasm32"))]
pub trait DownloadProgressSink: Send + Sync {
    /// Reports 0–100 progress and the worker's status line.
    fn progress(&self, progress: &ModelProgress);
}

/// Receives download/load progress for one part of the language data.
#[cfg(target_arch = "wasm32")]
pub trait DownloadProgressSink {
    /// Reports 0–100 progress and the worker's status line.
    fn progress(&self, progress: &ModelProgress);
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;

    /// Fetches and initializes the local parts a language needs.
    #[async_trait]
    pub trait LanguageDataInstaller: Send + Sync {
        /// Downloads and loads the recognizer's model for `language_id`.
        async fn download_stt(
            &self,
            language_id: &str,
            progress: &dyn DownloadProgressSink,
            token: &CancelToken,
        ) -> Result<(), CoreError>;

        /// Downloads and initializes one voice.
        async fn download_voice(
            &self,
            voice_id: &str,
            progress: &dyn DownloadProgressSink,
            token: &CancelToken,
        ) -> Result<(), CoreError>;

        /// Stops whichever worker is fetching. Idempotent.
        async fn cancel(&self) -> Result<(), CoreError>;
    }
}

#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;

    /// Fetches and initializes the local parts a language needs.
    #[async_trait(?Send)]
    pub trait LanguageDataInstaller {
        /// Downloads and loads the recognizer's model for `language_id`.
        async fn download_stt(
            &self,
            language_id: &str,
            progress: &dyn DownloadProgressSink,
            token: &CancelToken,
        ) -> Result<(), CoreError>;

        /// Downloads and initializes one voice.
        async fn download_voice(
            &self,
            voice_id: &str,
            progress: &dyn DownloadProgressSink,
            token: &CancelToken,
        ) -> Result<(), CoreError>;

        /// Stops whichever worker is fetching. Idempotent.
        async fn cancel(&self) -> Result<(), CoreError>;
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::LanguageDataInstaller;

#[cfg(target_arch = "wasm32")]
pub use web::LanguageDataInstaller;
