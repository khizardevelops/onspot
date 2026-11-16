// SPDX-License-Identifier: AGPL-3.0-or-later

//! The core handle a driver boots once.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use ts_rs::TS;

use crate::events::{EventSink, UiEvent};
use crate::host_rpc::{HostDeviceStore, HostRpc};
use crate::hosts::HostAdapters;
use crate::usage_ledger::UsageLedger;
use crate::usage_pacing::RequestPacer;
use onspot_ports::{ModelProgress, PickedFile};

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
    staged_restore: Mutex<Option<PickedFile>>,
    language_download: Mutex<Option<Arc<crate::language_download::RunLanguageDownload>>>,
    /// The one rate-limit pacing (and through it the usage ledger) every LLM
    /// request of this run shares, so requests see each other.
    pacer: Arc<RequestPacer>,
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
        let events = bus.clone() as Arc<dyn EventSink>;
        let host_rpc = Arc::new(HostRpc::new(events.clone()));

        let device = hosts
            .device
            .clone()
            .unwrap_or_else(|| Arc::new(HostDeviceStore::new(host_rpc.clone())));
        let ledger = Arc::new(UsageLedger::new(device, events.clone()));
        let pacer = Arc::new(RequestPacer::new(ledger, events));

        Self {
            config,
            hosts,
            bus,
            host_rpc,
            practice: Mutex::new(None),
            staged_restore: Mutex::new(None),
            language_download: Mutex::new(None),
            pacer,
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

    /// The rate-limit pacing every LLM request of this run goes through.
    pub fn pacer(&self) -> &Arc<RequestPacer> {
        &self.pacer
    }

    /// The device's usage ledger.
    pub fn usage_ledger(&self) -> &Arc<UsageLedger> {
        self.pacer.ledger()
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

    /// Keeps a picked backup until the learner confirms or cancels it.
    pub fn stage_restore(&self, file: PickedFile) {
        if let Ok(mut slot) = self.staged_restore.lock() {
            *slot = Some(file);
        }
    }

    /// The staged backup, if one is waiting for confirmation.
    pub fn staged_restore(&self) -> Option<PickedFile> {
        self.staged_restore
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
    }

    /// Removes and returns the staged backup, so a restore cannot run twice.
    pub fn take_staged_restore(&self) -> Option<PickedFile> {
        self.staged_restore
            .lock()
            .ok()
            .and_then(|mut slot| slot.take())
    }

    /// Discards a staged backup after the learner cancels.
    pub fn clear_staged_restore(&self) {
        if let Ok(mut slot) = self.staged_restore.lock() {
            *slot = None;
        }
    }

    /// Installs the running language-data download. A second call replaces it.
    pub fn install_language_download(
        &self,
        session: Arc<crate::language_download::RunLanguageDownload>,
    ) -> Arc<crate::language_download::RunLanguageDownload> {
        if let Ok(mut slot) = self.language_download.lock() {
            *slot = Some(session.clone());
        }
        session
    }

    /// The running language-data download, if one is in flight.
    pub fn language_download(&self) -> Option<Arc<crate::language_download::RunLanguageDownload>> {
        self.language_download
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
    }

    /// Drops the language-data download once it has finished or failed.
    pub fn remove_language_download(&self) {
        if let Ok(mut slot) = self.language_download.lock() {
            *slot = None;
        }
    }

    /// Marks the running download cancelled. The bridge also stops the host
    /// worker, because the core cannot reach a Web Worker directly.
    pub fn cancel_language_download(&self) {
        if let Some(session) = self.language_download() {
            session.cancel();
        }
    }

    /// Forwards one host progress reading into the running download.
    pub fn report_language_download_progress(&self, progress: &ModelProgress) {
        if let Some(session) = self.language_download() {
            session.report_from_host(progress);
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
