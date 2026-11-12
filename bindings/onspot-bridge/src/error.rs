// SPDX-License-Identifier: AGPL-3.0-or-later

//! The error shape every command returns, and the codes P1 defines.

use serde::Serialize;
use ts_rs::TS;

/// A failed command, serialized inside the bridge's `error` field.
///
/// `code` is stable and language-neutral; drivers map it to learner-facing
/// copy. `message` is a diagnostic for logs and tests, never a replacement for
/// the driver's copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
pub struct BridgeError {
    /// Stable machine code, e.g. `bridge.unknown_command`.
    pub code: String,
    /// Human-readable diagnostic, not shown to a learner.
    pub message: String,
}

impl BridgeError {
    /// Creates an error from a stable code and a diagnostic message.
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    /// The command name is not in the catalog.
    pub fn unknown_command(command: &str) -> Self {
        Self::new(
            "bridge.unknown_command",
            format!("No command named `{command}` is registered."),
        )
    }

    /// The payload does not match the command's request type.
    pub fn invalid_payload(command: &str, reason: impl std::fmt::Display) -> Self {
        Self::new(
            "bridge.invalid_payload",
            format!("`{command}` payload is invalid: {reason}"),
        )
    }

    /// The driver booted without the host adapter this command needs.
    pub fn unavailable(capability: &str) -> Self {
        Self::new(
            "bridge.unavailable",
            format!("this driver did not provide the `{capability}` host adapter."),
        )
    }
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for BridgeError {}
