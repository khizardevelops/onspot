// SPDX-License-Identifier: AGPL-3.0-or-later

//! Request/response calls from the core to its driver.
//!
//! Media capture, speech engines and the legacy evaluation shim live in a
//! driver on both runtimes. A port implementation in the bridge sends one
//! `HostRequest` event and waits for the driver's `core.host_reply` command.
//! The core stays oblivious to transports: it only sees serialized values.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use futures_channel::oneshot;
use serde_json::Value;

use crate::events::{EventSink, UiEvent};
use onspot_ports::{CoreError, DeviceStore};

type Pending = Mutex<HashMap<u32, oneshot::Sender<Result<Value, CoreError>>>>;

/// The core side of host request/response calls.
pub struct HostRpc {
    events: Arc<dyn EventSink>,
    next_id: AtomicU32,
    pending: Pending,
}

impl HostRpc {
    /// Creates a caller that emits through `events`.
    pub fn new(events: Arc<dyn EventSink>) -> Self {
        Self {
            events,
            next_id: AtomicU32::new(0),
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Sends one host request and waits for its reply.
    pub async fn call(&self, method: &str, payload: Value) -> Result<Value, CoreError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, sender);
        } else {
            return Err(CoreError::new(
                "core.host_unavailable",
                "the host call registry is unavailable",
            ));
        }

        self.events.emit(&UiEvent::HostRequest {
            id,
            method: String::from(method),
            payload: payload.to_string(),
        });

        match receiver.await {
            Ok(reply) => reply,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(CoreError::new(
                    "core.host_unavailable",
                    "the driver dropped the host call",
                ))
            }
        }
    }

    /// Resolves a pending request. Returns false when the id is unknown or the
    /// caller has already given up.
    pub fn reply(&self, id: u32, reply: Result<Value, CoreError>) -> bool {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&id));
        sender.is_some_and(|sender| sender.send(reply).is_ok())
    }
}

/// The device store of a driver that keeps its own values (browser
/// `localStorage` in the webview), reached through host calls: `device.read`
/// answers `{ value: string | null }`, `device.write` stores `value`.
pub struct HostDeviceStore {
    rpc: Arc<HostRpc>,
}

impl HostDeviceStore {
    /// Creates the store over the core's host-call registry.
    pub fn new(rpc: Arc<HostRpc>) -> Self {
        Self { rpc }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl DeviceStore for HostDeviceStore {
    async fn read(&self, key: &str) -> Result<Option<String>, CoreError> {
        let reply = self
            .rpc
            .call("device.read", serde_json::json!({ "key": key }))
            .await?;
        Ok(reply
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_owned))
    }

    async fn write(&self, key: &str, value: &str) -> Result<(), CoreError> {
        self.rpc
            .call(
                "device.write",
                serde_json::json!({ "key": key, "value": value }),
            )
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct Sink(Mutex<Vec<UiEvent>>);

    impl EventSink for Sink {
        fn emit(&self, event: &UiEvent) {
            self.0.lock().expect("sink").push(event.clone());
        }
    }

    #[test]
    fn a_reply_resolves_the_waiting_call() {
        let sink = Arc::new(Sink::default());
        let rpc = Arc::new(HostRpc::new(sink.clone() as Arc<dyn EventSink>));
        let inner = Arc::clone(&rpc);
        let result = futures::executor::block_on(async move {
            let caller = async move { inner.call("capture.stop", serde_json::json!({})).await };
            let replier = async {
                loop {
                    let request = sink.0.lock().expect("sink").first().cloned();
                    if let Some(UiEvent::HostRequest { id, .. }) = request {
                        inner_reply(&rpc, id);
                        break;
                    }
                    futures::pending!();
                }
            };
            futures::join!(caller, replier).0
        });
        assert_eq!(result.expect("reply"), serde_json::json!({ "ok": true }));
    }

    fn inner_reply(rpc: &Arc<HostRpc>, id: u32) {
        rpc.reply(id, Ok(serde_json::json!({ "ok": true })));
    }
}
