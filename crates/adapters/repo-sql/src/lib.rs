// SPDX-License-Identifier: AGPL-3.0-or-later

//! The SQL side of the storage foundation: the verbatim schema and migration
//! chain, the native `rusqlite` driver, and the settings/history repositories.
//!
//! Ported from `src/lib/adapters/db/` in P2. A database written by v0.2.4 must
//! open and migrate unmodified (invariant I3); the checked-in v9 fixture in
//! `tests/fixtures/` proves it.

#[cfg(feature = "native")]
pub mod driver;
pub mod migrate;
pub mod records;
pub mod schema;
pub mod stores;

#[cfg(feature = "native")]
pub use driver::RusqliteDriver;
pub use migrate::migrate;
pub use records::SqlRecordsStore;
pub use schema::{migration, MIGRATIONS, SCHEMA_VERSION};
pub use stores::{SqlHistoryStore, SqlSettingsStore};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-adapter-repo-sql");
    }
}
