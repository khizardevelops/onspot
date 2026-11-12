// SPDX-License-Identifier: AGPL-3.0-or-later

//! The command catalog and dispatcher.
//!
//! P1 has one command, `core.ping`, which proves the round trip on both
//! transports. Later phases add their commands here; each one forwards to a use
//! case and returns a serializable response.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use onspot_app::{Core, EventSink, UiEvent};

use crate::error::BridgeError;
use crate::BRIDGE_VERSION;

/// The one command this phase registers.
pub const PING_COMMAND: &str = "core.ping";

/// `core.ping` arguments. `note` is echoed back, so a driver can prove that its
/// own payload crossed the boundary unchanged.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    /// Free text echoed in the response; no behaviour depends on it.
    #[serde(default)]
    pub note: Option<String>,
}

/// What `core.ping` returns.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    /// The app version the driver reported at boot.
    pub app_version: String,
    /// The bridge contract version, e.g. `bridge.v1`.
    pub bridge_version: String,
    /// The event number this ping emitted.
    pub sequence: u32,
    /// The request's `note`, unchanged.
    pub note: Option<String>,
}

/// What a driver gets back from `init_core` (and from `system.init` later).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct InitResponse {
    /// The app version the driver reported at boot.
    pub app_version: String,
    /// The bridge contract version, e.g. `bridge.v1`.
    pub bridge_version: String,
    /// The number of the `Pong` event emitted by the boot itself.
    pub sequence: u32,
}

/// Boots the core for a driver: registers its sink, emits the boot `Pong` and
/// returns the handshake a driver displays or logs.
pub fn initialize(core: &Core, sink: Arc<dyn EventSink>) -> InitResponse {
    core.add_sink(sink);
    let sequence = core.next_sequence();
    core.emit(UiEvent::Pong { seq: sequence });
    init_response(core, sequence)
}

/// The handshake for a core whose boot event has already been emitted.
pub fn init_response(core: &Core, sequence: u32) -> InitResponse {
    InitResponse {
        app_version: core.app_version().to_owned(),
        bridge_version: BRIDGE_VERSION.to_owned(),
        sequence,
    }
}

/// Runs one command.
///
/// `payload` is the raw JSON value from the driver (`null` means "no
/// arguments"). The response is the command's own serialized type.
pub async fn dispatch(core: &Core, command: &str, payload: Value) -> Result<Value, BridgeError> {
    match command {
        PING_COMMAND => serialize(ping(core, payload)?),
        other => {
            if let Some(result) = crate::practice::dispatch(core, other, payload.clone()).await {
                return result;
            }
            match crate::storage::dispatch(core, other, payload).await {
                Some(result) => result,
                None => Err(BridgeError::unknown_command(other)),
            }
        }
    }
}

fn ping(core: &Core, payload: Value) -> Result<PingResponse, BridgeError> {
    let request: PingRequest = if payload.is_null() {
        PingRequest::default()
    } else {
        serde_json::from_value(payload)
            .map_err(|error| BridgeError::invalid_payload(PING_COMMAND, error))?
    };

    let sequence = core.next_sequence();
    core.emit(UiEvent::Pong { seq: sequence });

    Ok(PingResponse {
        app_version: core.app_version().to_owned(),
        bridge_version: BRIDGE_VERSION.to_owned(),
        sequence,
        note: request.note,
    })
}

pub(crate) fn serialize<T: Serialize>(response: T) -> Result<Value, BridgeError> {
    serde_json::to_value(response).map_err(|error| {
        BridgeError::new(
            "bridge.response_not_serializable",
            format!("the core could not serialize its response: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use onspot_app::CoreConfig;

    struct RecordingSink(Mutex<Vec<UiEvent>>);

    impl EventSink for RecordingSink {
        fn emit(&self, event: &UiEvent) {
            self.0.lock().expect("recording sink").push(event.clone());
        }
    }

    fn core_with_sink() -> (Core, Arc<RecordingSink>) {
        let core = Core::new(CoreConfig {
            app_version: String::from("0.2.4"),
        });
        let sink = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let _ = initialize(&core, sink.clone() as Arc<dyn EventSink>);
        (core, sink)
    }

    #[test]
    fn ping_echoes_its_note_and_reports_versions() {
        let (core, _) = core_with_sink();
        let response = futures::executor::block_on(dispatch(
            &core,
            PING_COMMAND,
            serde_json::json!({ "note": "from the test" }),
        ))
        .expect("ping succeeds");

        assert_eq!(response["appVersion"], "0.2.4");
        assert_eq!(response["bridgeVersion"], "bridge.v1");
        assert_eq!(response["note"], "from the test");
        assert_eq!(response["sequence"], 2);
    }

    #[test]
    fn ping_without_a_payload_is_valid() {
        let (core, _) = core_with_sink();
        let response = futures::executor::block_on(dispatch(&core, PING_COMMAND, Value::Null))
            .expect("ping succeeds");
        assert_eq!(response["note"], Value::Null);
    }

    #[test]
    fn every_ping_emits_one_pong_event() {
        let (core, sink) = core_with_sink();
        let _ = futures::executor::block_on(dispatch(&core, PING_COMMAND, Value::Null))
            .expect("ping succeeds");

        let events = sink.0.lock().expect("recording sink");
        assert_eq!(
            *events,
            vec![UiEvent::Pong { seq: 1 }, UiEvent::Pong { seq: 2 }]
        );
    }

    #[test]
    fn an_unknown_command_reports_its_code() {
        let (core, _) = core_with_sink();
        let error =
            futures::executor::block_on(dispatch(&core, "practice.make_it_so", Value::Null))
                .expect_err("unknown");
        assert_eq!(error.code, "bridge.unknown_command");
    }

    #[test]
    fn a_wrong_payload_reports_its_code() {
        let (core, _) = core_with_sink();
        let error = futures::executor::block_on(dispatch(
            &core,
            PING_COMMAND,
            serde_json::json!({ "note": 42 }),
        ))
        .expect_err("invalid payload");
        assert_eq!(error.code, "bridge.invalid_payload");
    }
}
