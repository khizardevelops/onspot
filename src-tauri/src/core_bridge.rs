// SPDX-License-Identifier: AGPL-3.0-or-later

//! The two Tauri commands the webview calls. They only marshal: all behaviour
//! is in `onspot-bridge` (invariant I8).

use std::sync::Arc;

use onspot_bridge::{
    dispatch, tauri_support::initialize_tauri, BridgeError, Core, CoreConfig, HostAdapters,
    InitResponse,
};
use onspot_ports::{DatabaseFile, HistoryStore, RecordsStore, SettingsStore};
use serde_json::Value;
use tauri::{ipc::Channel, State};

/// The process's one core, managed by Tauri.
pub struct BridgeState(Arc<Core>);

impl BridgeState {
    /// Creates the core with the shell's own version for diagnostics and the
    /// SQL-backed host adapters P2 introduced.
    pub fn new(
        history: Arc<dyn HistoryStore>,
        settings: Arc<dyn SettingsStore>,
        records: Arc<dyn RecordsStore>,
        database_file: Arc<dyn DatabaseFile>,
    ) -> Self {
        let hosts = HostAdapters {
            history: Some(history),
            settings: Some(settings),
            records: Some(records),
            database_file: Some(database_file),
            // The usage ledger stays in the webview's storage, next to the keys.
            device: None,
        };
        Self(Arc::new(Core::with_hosts(
            CoreConfig {
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            },
            hosts,
        )))
    }
}

/// Boots the core and subscribes the webview to its events.
#[tauri::command]
pub fn core_init(events: Channel<Value>, state: State<'_, BridgeState>) -> InitResponse {
    initialize_tauri(&state.0, events)
}

/// Runs one bridge command. Commands stay marshalling only; storage is async
/// because the web host's SQL calls are promises and the same dispatcher serves
/// both transports.
#[tauri::command]
pub async fn core_command(
    cmd: String,
    payload: Option<Value>,
    state: State<'_, BridgeState>,
) -> Result<Value, BridgeError> {
    let core = state.0.clone();
    dispatch(&core, &cmd, payload.unwrap_or(Value::Null)).await
}
