// SPDX-License-Identifier: AGPL-3.0-or-later

//! `onspot-cli`: a second driver over the same `onspot-app` use cases.
//!
//! The CLI owns the things every driver owns — the SQLite connection, the HTTP
//! transport, the API keys and the clock. It contains no evaluation, settings
//! or export rules of its own, so a difference from the GUI is a driver bug.

pub mod db;
pub mod error;
pub mod evaluation;
pub mod exports;
pub mod http;
pub mod insights;
pub mod secrets;
pub mod sessions;
pub mod settings;

pub use db::{default_db_path, default_keys_path, Context};
pub use error::CliError;
pub use evaluation::{EvaluateOptions, DEFAULT_PROMPT};
pub use secrets::CliSecrets;
