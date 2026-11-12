// SPDX-License-Identifier: AGPL-3.0-or-later

//! Google Drive snapshot sync: list, download, upload and revoke over the
//! HttpClient and OAuthBroker ports.
//!
//! Ported from `src/lib/adapters/sync/google/` in P7.

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-adapter-sync-drive");
    }
}
