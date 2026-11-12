// SPDX-License-Identifier: AGPL-3.0-or-later

//! The core handle a driver boots once.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use ts_rs::TS;

use crate::events::{EventSink, UiEvent};
use crate::host_rpc::HostRpc;
use crate::hosts::HostAdapters;

/// What a driver tells the core at boot.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CoreConfig {
    /// The shipping app's version, shown in diagnostics. The web driver passes
    /// it from the build; the Tauri driver passes its own package version.
    pub app_version: String,
}

impl Default for CoreConfig {
    fn default() -> Self {
        Self {
            app_version: String::from("unknown"),
        }
    }
}

/// The event bus every sink subscribes to.
struct EventBus {
    sinks: Mutex<Vec<Arc<dyn EventSink>>>,
    // u32, not u64: a u64 becomes a JS `bigint` through serde-wasm-bindgen but a
    // plain number through Tauri's JSON, and the two transports must return the
    // same shape. Four billion events per page load is not a real ceiling.
    sequence: AtomicU32,
}

impl EventBus {
    fn new() -> Self {
        Self {
            sinks: Mutex::new(Vec::new()),
            sequence: AtomicU32::new(0),
        }
    }

    fn add_sink(&self, sink: Arc<dyn EventSink>) {
        if let Ok(mut sinks) = self.sinks.lock() {
            sinks.push(sink);
        }
    }

    fn next_sequence(&self) -> u32 {
        self.sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn sequence(&self) -> u32 {
        self.sequence.load(Ordering::SeqCst)
    }
}

impl EventSink for EventBus {
    fn emit(&self, event: &UiEvent) {
        if let Ok(sinks) = self.sinks.lock() {
            for sink in sinks.iter() {
                sink.emit(event);
            }
        }
    }
}

/// The single core a driver talks to.
///
/// Holds the configuration, the event bus, the host-call registry and the one
/// practice session a driver can open.
pub struct Core {
    config: CoreConfig,
    hosts: HostAdapters,
    bus: Arc<EventBus>,
    host_rpc: Arc<HostRpc>,
    practice: Mutex<Option<Arc<crate::practice::RunPracticeSession>>>,
}

impl Core {
    /// Creates a core with no host adapters. Drivers call this once per process
    /// (wasm: once per page).
    pub fn new(config: CoreConfig) -> Self {
        Self::with_hosts(config, HostAdapters::default())
    }

    /// Creates a core with the host adapters a driver can supply.
    pub fn with_hosts(config: CoreConfig, hosts: HostAdapters) -> Self {
        let bus = Arc::new(EventBus::new());
        let host_rpc = Arc::new(HostRpc::new(bus.clone() as Arc<dyn EventSink>));
        Self {
            config,
            hosts,
            bus,
            host_rpc,
            practice: Mutex::new(None),
        }
    }

    /// The host implementations this core was booted with.
    pub fn hosts(&self) -> &HostAdapters {
        &self.hosts
    }

    /// The configuration this core was booted with.
    pub fn config(&self) -> &CoreConfig {
        &self.config
    }

    /// The app version a driver reported.
    pub fn app_version(&self) -> &str {
        &self.config.app_version
    }

    /// Registers a sink. Sinks stay registered for the life of the core; a
    /// driver that reconnects adds another one.
    pub fn add_sink(&self, sink: Arc<dyn EventSink>) {
        self.bus.add_sink(sink);
    }

    /// The next event number. Starts at 1, so `0` always means "no event yet".
    pub fn next_sequence(&self) -> u32 {
        self.bus.next_sequence()
    }

    /// The highest event number handed out so far.
    pub fn sequence(&self) -> u32 {
        self.bus.sequence()
    }

    /// Sends one event to every registered sink.
    pub fn emit(&self, event: UiEvent) {
        self.bus.emit(&event);
    }

    /// A sink that forwards to every registered driver sink.
    pub fn event_sink(&self) -> Arc<dyn EventSink> {
        self.bus.clone() as Arc<dyn EventSink>
    }

    /// The host request/response registry.
    pub fn host_rpc(&self) -> &Arc<HostRpc> {
        &self.host_rpc
    }

    /// The open practice session, if the driver has configured one.
    pub fn practice(&self) -> Option<Arc<crate::practice::RunPracticeSession>> {
        self.practice.lock().ok().and_then(|slot| slot.clone())
    }

    /// Installs the practice session. A second call replaces it.
    pub fn install_practice(
        &self,
        session: Arc<crate::practice::RunPracticeSession>,
    ) -> Arc<crate::practice::RunPracticeSession> {
        if let Ok(mut slot) = self.practice.lock() {
            *slot = Some(session.clone());
        }
        session
    }

    /// Drops the open practice session, if any.
    pub fn remove_practice(&self) {
        if let Ok(mut slot) = self.practice.lock() {
            *slot = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_starts_at_one_and_increases() {
        let core = Core::new(CoreConfig::default());
        assert_eq!(core.sequence(), 0);
        assert_eq!(core.next_sequence(), 1);
        assert_eq!(core.next_sequence(), 2);
        assert_eq!(core.sequence(), 2);
    }
}
