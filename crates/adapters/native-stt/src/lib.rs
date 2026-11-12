// SPDX-License-Identifier: AGPL-3.0-or-later

//! whisper.cpp speech-to-text for the desktop and Android drivers.
//!
//! Wraps the engine that already lives in `src-tauri/plugins/speech` behind
//! the `SttEngine` port, so a native host can run the same core loop without a
//! browser worker. The Tauri shell currently reaches the same engine through
//! the plugin command path; this adapter is the in-process form of it.

use std::path::PathBuf;

use async_trait::async_trait;
use onspot_ports::{
    AudioFrame, CancelToken, CoreError, SttEngine, SttOptions, SttProgressSink, Transcript,
};
use tauri_plugin_speech::whisper::Engine;

/// A whisper.cpp model loaded lazily on the first take.
pub struct WhisperCppStt {
    engine: Engine,
    model: PathBuf,
}

impl WhisperCppStt {
    /// Creates the adapter for one downloaded model file.
    pub fn new(model: impl Into<PathBuf>) -> Self {
        Self {
            engine: Engine::default(),
            model: model.into(),
        }
    }

    /// The model file this adapter reads.
    pub fn model(&self) -> &std::path::Path {
        &self.model
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SttEngine for WhisperCppStt {
    async fn transcribe(
        &self,
        frame: &AudioFrame,
        options: &SttOptions,
        progress: &dyn SttProgressSink,
        token: &CancelToken,
    ) -> Result<Transcript, CoreError> {
        if token.is_cancelled() {
            return Err(token.error());
        }
        progress.progress(&onspot_ports::ModelProgress {
            progress: 100.0,
            status: String::from("Transcribing…"),
        });
        let text = self
            .engine
            .transcribe(&self.model, &frame.pcm, &options.language_id)
            .map_err(|error| CoreError::new("practice.transcription_failed", error.to_string()))?;
        if token.is_cancelled() {
            return Err(token.error());
        }
        Ok(Transcript { text })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_adapter_keeps_the_model_path() {
        let adapter = WhisperCppStt::new("/tmp/model.bin");
        assert_eq!(adapter.model(), std::path::Path::new("/tmp/model.bin"));
    }
}
