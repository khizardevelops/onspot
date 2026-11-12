// SPDX-License-Identifier: AGPL-3.0-or-later

//! onspot's core: the use cases and the state they own.
//!
//! Core crates know nothing about a driver. A driver boots one [`Core`], hands
//! it an [`EventSink`], and reaches it only through `onspot-bridge`.

pub mod core;
pub mod evaluation;
pub mod events;
pub mod history;
pub mod host_rpc;
pub mod hosts;
pub mod practice;
pub mod settings;

pub use core::{Core, CoreConfig};
pub use evaluation::{EvaluateAttempt, EvaluatorPort, TestLlmConnection};
pub use events::{EventSink, UiEvent};
pub use history::{HistoryError, HistoryService, HistorySession};
pub use host_rpc::HostRpc;
pub use hosts::HostAdapters;
pub use practice::{
    AttemptView, PracticeConfig, PracticePhase, PracticePorts, PracticeSnapshot, PromptView,
    RunPracticeSession,
};
pub use settings::SettingsService;

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-app");
    }
}
