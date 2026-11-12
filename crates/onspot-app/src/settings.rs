// SPDX-License-Identifier: AGPL-3.0-or-later

//! The settings row service. The typed document (defaults, merge, sanitising)
//! stays in `stores/settings.ts` until P4, when the screen moves to the bridge.
//! This exposes exactly what that store reads and writes today: key/value rows.
//!
//! BYOK secrets live in browser storage, never in the database (invariant I3).
//! The service still refuses the legacy secret prefix, so a restored or
//! hand-edited file cannot leak a key through `settings.list`/`settings.get`.

use onspot_domain::Setting;
use onspot_ports::{SettingsStore, StoreError};

/// The prefix `stores/secrets.ts` uses in browser storage. It must never be a
/// settings row the bridge returns.
const SECRET_PREFIX: &str = "onspot.key.";

/// The settings use cases over a [`SettingsStore`].
pub struct SettingsService<'a> {
    store: &'a dyn SettingsStore,
}

impl<'a> SettingsService<'a> {
    /// Creates the service over a store.
    pub fn new(store: &'a dyn SettingsStore) -> Self {
        Self { store }
    }

    /// Every stored row, ordered by key, without anything under the secret
    /// prefix.
    pub async fn list(&self) -> Result<Vec<Setting>, StoreError> {
        Ok(self
            .store
            .list()
            .await?
            .into_iter()
            .filter(|setting| !setting.key.starts_with(SECRET_PREFIX))
            .collect())
    }

    /// One stored value; a key under the secret prefix is never returned.
    pub async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        if key.starts_with(SECRET_PREFIX) {
            return Ok(None);
        }
        self.store.get(key).await
    }

    /// Inserts or replaces one value.
    pub async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.store.set(key, value).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use futures::executor::block_on;
    use onspot_domain::Setting;

    use super::*;

    /// A store whose rows are whatever the test put there.
    struct FakeStore(Mutex<Vec<Setting>>);

    #[async_trait]
    impl SettingsStore for FakeStore {
        async fn list(&self) -> Result<Vec<Setting>, StoreError> {
            Ok(self.0.lock().expect("fake store").clone())
        }

        async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
            Ok(self
                .0
                .lock()
                .expect("fake store")
                .iter()
                .find(|setting| setting.key == key)
                .map(|setting| setting.value.clone()))
        }

        async fn set(&self, _key: &str, _value: &str) -> Result<(), StoreError> {
            Ok(())
        }
    }

    fn setting(key: &str, value: &str) -> Setting {
        Setting {
            key: key.to_owned(),
            value: value.to_owned(),
            updated_at: String::from("2026-11-12T00:00:00.000Z"),
        }
    }

    #[test]
    fn key_material_never_surfaces_through_settings() {
        let store = FakeStore(Mutex::new(vec![
            setting("onspot.setting.level", "\"B1\""),
            setting("onspot.key.llm.groq", "secret-value"),
        ]));
        let service = SettingsService::new(&store);

        block_on(async {
            let rows = service.list().await.expect("list");
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].key, "onspot.setting.level");
            assert_eq!(service.get("onspot.key.llm.groq").await.expect("get"), None);
        });
    }
}
