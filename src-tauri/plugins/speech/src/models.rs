//! Model files on disk: `<app data>/models/<file>`.
//!
//! A download goes to `<file>.part`, is checked against its SHA-256, and only
//! then renamed into place, so a half-written or corrupt file is never loaded.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::AsyncWriteExt;

use crate::error::{Error, Result};

/// Models only ever come from whisper.cpp's official Hugging Face repository.
const ALLOWED_SOURCE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/";

/// Set by `cancel_download`; checked between chunks.
#[derive(Default)]
pub struct DownloadCancel(AtomicBool);

impl DownloadCancel {
    pub fn request(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// The on-disk path for a model file name, rejecting anything that is not a
/// plain `*.bin` name (no directories, no traversal).
pub fn model_path<R: Runtime>(app: &AppHandle<R>, file: &str) -> Result<PathBuf> {
    let plain = !file.is_empty()
        && file.ends_with(".bin")
        && file.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if !plain {
        return Err(Error::Invalid(format!("not a model file name: {file}")));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| Error::Invalid(error.to_string()))?
        .join("models");
    Ok(dir.join(file))
}

pub async fn download(
    url: &str,
    path: &Path,
    sha256: &str,
    cancel: &DownloadCancel,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<()> {
    if !url.starts_with(ALLOWED_SOURCE) {
        return Err(Error::Invalid(format!("models are only downloaded from {ALLOWED_SOURCE}")));
    }
    cancel.0.store(false, Ordering::Relaxed);

    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let partial = path.with_extension("bin.part");

    let response = reqwest::get(url).await?.error_for_status()?;
    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&partial).await?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut body = response.bytes_stream();

    while let Some(chunk) = body.next().await {
        if cancel.0.load(Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(Error::Cancelled);
        }
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        on_progress(received, total);
    }
    file.flush().await?;
    drop(file);

    let digest: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    if !digest.eq_ignore_ascii_case(sha256) {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err(Error::Checksum);
    }
    tokio::fs::rename(&partial, path).await?;
    Ok(())
}
