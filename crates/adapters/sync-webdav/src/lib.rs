// SPDX-License-Identifier: AGPL-3.0-or-later

//! WebDAV snapshot sync: PROPFIND, PUT, GET, MKCOL and DELETE over the
//! HttpClient port.
//!
//! Ported from `src/lib/adapters/sync/webdav.ts` in P7.

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-adapter-sync-webdav");
    }
}
