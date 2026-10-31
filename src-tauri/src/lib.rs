// SPDX-License-Identifier: AGPL-3.0-or-later

#[cfg(target_os = "linux")]
mod microphone;
mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    // Settings → Storage → Export: a native Save dialog and the file write.
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // Cloud sync: open the system browser for Google sign-in, and make
    // cross-origin Drive/WebDAV requests without the webview's CORS policy.
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_speech::init())
    .manage(oauth::OAuthState::default())
    .invoke_handler(tauri::generate_handler![
      oauth::oauth_loopback_start,
      oauth::oauth_loopback_wait
    ])
    .setup(|app| {
      #[cfg(target_os = "linux")]
      microphone::allow_in_main_window(app)?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
