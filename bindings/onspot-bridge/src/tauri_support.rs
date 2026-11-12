// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri IPC glue: the event channel and the boot helper.
//!
//! `src-tauri` keeps only pass-through `#[tauri::command]` functions; the
//! channel sink and the handshake live here so the desktop, Android and web
//! drivers run the same code.

use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::Channel;

use onspot_app::{Core, EventSink, UiEvent};

use crate::commands::{initialize, InitResponse};

/// Sends events to a driver over a Tauri channel.
///
/// A failed send means the webview is gone; dropping the event is correct then.
pub struct ChannelSink(pub Channel<Value>);

impl EventSink for ChannelSink {
    fn emit(&self, event: &UiEvent) {
        if let Ok(value) = serde_json::to_value(event) {
            let _ = self.0.send(value);
        }
    }
}

/// Boots the desktop/Android core and returns the handshake.
pub fn initialize_tauri(core: &Core, events: Channel<Value>) -> InitResponse {
    initialize(core, Arc::new(ChannelSink(events)))
}
