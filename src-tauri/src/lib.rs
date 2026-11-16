// SPDX-License-Identifier: AGPL-3.0-or-later

mod core_bridge;
#[cfg(target_os = "linux")]
mod display_backend;
#[cfg(target_os = "linux")]
mod microphone;
mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    display_backend::prefer_x11_inside_appimage();

    tauri::Builder::default()
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
            oauth::oauth_loopback_wait,
            core_bridge::core_init,
            core_bridge::core_command
        ])
        .setup(|app| {
            use std::sync::Arc;

            use onspot_adapter_repo_sql::{
                migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore, SqlSettingsStore,
            };
            use onspot_ports::{DatabaseFile, SqlDriver};
            use tauri::Manager;

            #[cfg(target_os = "linux")]
            microphone::allow_in_main_window(app)?;

            // The app's one database connection: the core owns the schema,
            // the migrations and every query. On a fresh install the config
            // folder does not exist yet, and SQLite creates the file but never
            // its folder.
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let database_path = config_dir.join("onspot.db");
            let database = Arc::new(RusqliteDriver::open(&database_path)?);
            tauri::async_runtime::block_on(migrate(database.as_ref()))?;
            let driver: Arc<dyn SqlDriver> = database.clone();
            let database_file: Arc<dyn DatabaseFile> = database;
            app.manage(core_bridge::BridgeState::new(
                Arc::new(SqlHistoryStore::new(driver.clone())),
                Arc::new(SqlSettingsStore::new(driver.clone())),
                Arc::new(SqlRecordsStore::new(driver)),
                database_file,
            ));
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
