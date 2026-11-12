// SPDX-License-Identifier: AGPL-3.0-or-later

//! The stable failure shape every port returns.
//!
//! `code` is language-neutral and stable; drivers map it to the learner-facing
//! copy (invariant I6). `message` is diagnostic only and must never be shown as
//! product copy.

/// A failure inside a port or use case.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct CoreError {
    /// Stable, language-neutral code, e.g. `practice.take_silent`.
    pub code: String,
    /// Diagnostic detail for logs and tests.
    pub message: String,
}

impl CoreError {
    /// Creates an error with a stable code and a diagnostic message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// A capability the driver did not supply.
    pub fn unavailable(capability: &str) -> Self {
        Self::new(
            "bridge.unavailable",
            format!("the driver did not supply {capability}"),
        )
    }
}
