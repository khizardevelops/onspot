// SPDX-License-Identifier: AGPL-3.0-or-later

//! The host implementations a driver supplies at boot.
//!
//! P2 adds the history and settings repositories. A driver that cannot provide
//! one leaves it unset; commands that need it then fail with a stable
//! `bridge.unavailable` code instead of panicking. The SQL engine itself is an
//! adapter detail: `onspot-adapter-repo-sql` builds both stores over one
//! `SqlDriver`, and a test can supply an in-memory implementation.
use std::sync::Arc;

use onspot_ports::{HistoryStore, RecordsStore, SettingsStore};

/// The host implementations a driver supplies at boot.
#[derive(Clone, Default)]
pub struct HostAdapters {
    /// Sessions and take previews for the history screen.
    pub history: Option<Arc<dyn HistoryStore>>,
    /// Persisted settings rows.
    pub settings: Option<Arc<dyn SettingsStore>>,
    /// Prompts, full sessions/attempts, corrections, audio and sync metadata.
    pub records: Option<Arc<dyn RecordsStore>>,
}
