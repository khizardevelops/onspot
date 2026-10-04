//! onspot's on-device speech engines for the desktop and Android apps.
//!
//! Speech-to-text runs whisper.cpp natively: real CPU SIMD and threads, and
//! the model read straight from disk, instead of WebAssembly in the webview.
//! Measurements and the reasoning live in `docs/benchmarks/stt.md`.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod commands;
pub mod error;
mod models;
/// Public so `examples/bench.rs` measures exactly the engine the commands use.
pub mod whisper;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("speech")
        .invoke_handler(tauri::generate_handler![
            commands::model_status,
            commands::download_model,
            commands::cancel_download,
            commands::delete_model,
            commands::load_model,
            commands::transcribe,
            commands::release,
        ])
        .setup(|app, _api| {
            app.manage(models::DownloadCancel::default());
            app.manage(whisper::Engine::default());
            Ok(())
        })
        .build()
}
