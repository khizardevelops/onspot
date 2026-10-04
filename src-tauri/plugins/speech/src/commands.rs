//! The commands the webview calls as `plugin:speech|<name>`.
//! The TypeScript side is `src/lib/speech/stt/native/nativeEngine.ts`.

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::{Error, Result};
use crate::models::{self, DownloadCancel};
use crate::whisper::{Engine, IDLE_RELEASE};

#[derive(Serialize)]
pub struct ModelStatus {
    installed: bool,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    received: u64,
    total: u64,
}

#[tauri::command]
pub async fn model_status<R: Runtime>(app: AppHandle<R>, file: String) -> Result<ModelStatus> {
    let path = models::model_path(&app, &file)?;
    Ok(ModelStatus { installed: tokio::fs::try_exists(&path).await? })
}

#[tauri::command]
pub async fn download_model<R: Runtime>(
    app: AppHandle<R>,
    cancel: State<'_, DownloadCancel>,
    file: String,
    url: String,
    sha256: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<()> {
    let path = models::model_path(&app, &file)?;
    let mut last_percent = u64::MAX;
    models::download(&url, &path, &sha256, &cancel, |received, total| {
        // One message per percent keeps the IPC quiet during a 190 MB download.
        let percent = if total > 0 { received * 100 / total } else { 0 };
        if percent != last_percent {
            last_percent = percent;
            let _ = on_progress.send(DownloadProgress { received, total });
        }
    })
    .await
}

#[tauri::command]
pub fn cancel_download(cancel: State<'_, DownloadCancel>) {
    cancel.request();
}

#[tauri::command]
pub async fn delete_model<R: Runtime>(app: AppHandle<R>, file: String) -> Result<()> {
    let path = models::model_path(&app, &file)?;
    app.state::<Engine>().release();
    if tokio::fs::try_exists(&path).await? {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_model<R: Runtime>(app: AppHandle<R>, file: String) -> Result<()> {
    let path = models::model_path(&app, &file)?;
    let engine_app = app.clone();
    blocking(move || engine_app.state::<Engine>().load(&path)).await?;
    schedule_idle_release(&app);
    Ok(())
}

/// The body is the 16 kHz mono PCM as little-endian f32 bytes. The model file
/// and language travel as headers.
#[tauri::command]
pub async fn transcribe<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<String> {
    let bytes = body_bytes(request.body())?;
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| Error::Invalid(format!("missing header {name}")))
    };
    let path = models::model_path(&app, &header("x-model")?)?;
    let language = header("x-language")?;
    let pcm: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|sample| f32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]))
        .collect();

    let engine_app = app.clone();
    let text =
        blocking(move || engine_app.state::<Engine>().transcribe(&path, &pcm, &language)).await?;
    schedule_idle_release(&app);
    Ok(text)
}

#[tauri::command]
pub fn release<R: Runtime>(app: AppHandle<R>) {
    app.state::<Engine>().release();
}

/// Desktop delivers a binary body as raw bytes. Android's IPC bridge has no
/// binary channel and delivers the same bytes as a JSON array of numbers.
fn body_bytes(body: &InvokeBody) -> Result<Vec<u8>> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(serde_json::Value::Array(values)) => values
            .iter()
            .map(|value| value.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect::<Option<Vec<u8>>>()
            .ok_or_else(|| Error::Invalid("transcribe expects PCM bytes".into())),
        InvokeBody::Json(_) => Err(Error::Invalid("transcribe expects PCM bytes".into())),
    }
}

/// whisper.cpp blocks for seconds; keep it off the async runtime's threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| Error::Invalid(error.to_string()))?
}

fn schedule_idle_release<R: Runtime>(app: &AppHandle<R>) {
    let use_number = app.state::<Engine>().touch();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_RELEASE).await;
        app.state::<Engine>().release_if_unused_since(use_number);
    });
}
