// SPDX-License-Identifier: AGPL-3.0-or-later

//! The CLI's device store: one JSON object file beside the keyfile, for the
//! values a driver keeps per device and never in the database (the usage
//! ledger, which counts what this machine's keys spent).

use std::collections::BTreeMap;
use std::path::PathBuf;

use async_trait::async_trait;
use onspot_ports::{CoreError, DeviceStore};

/// Device values in one JSON file, read and replaced whole.
pub struct FileDeviceStore {
    path: PathBuf,
}

impl FileDeviceStore {
    /// Creates the store over `path`; the file is created on the first write.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    fn read_all(&self) -> Result<BTreeMap<String, String>, CoreError> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = std::fs::read_to_string(&self.path).map_err(device_error)?;
        // An unreadable file starts empty, like a cleared browser storage.
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }
}

#[async_trait]
impl DeviceStore for FileDeviceStore {
    async fn read(&self, key: &str) -> Result<Option<String>, CoreError> {
        Ok(self.read_all()?.remove(key))
    }

    async fn write(&self, key: &str, value: &str) -> Result<(), CoreError> {
        let mut values = self.read_all()?;
        values.insert(key.to_owned(), value.to_owned());
        let text = serde_json::to_string_pretty(&values)
            .map_err(|error| CoreError::new("cli.device_store", error.to_string()))?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(device_error)?;
        }
        // Written beside and renamed over, so a crash never leaves half a file.
        let staged = self.path.with_extension("json.tmp");
        std::fs::write(&staged, text).map_err(device_error)?;
        std::fs::rename(&staged, &self.path).map_err(device_error)
    }
}

fn device_error(error: std::io::Error) -> CoreError {
    CoreError::new("cli.device_store", error.to_string())
}

#[cfg(test)]
mod tests {
    use futures::executor::block_on;

    use super::*;

    #[test]
    fn a_written_value_reads_back_and_others_are_kept() {
        let directory = std::env::temp_dir().join(format!("onspot-device-{}", std::process::id()));
        let store = FileDeviceStore::new(directory.join("device.json"));

        block_on(store.write("first", "1")).expect("write");
        block_on(store.write("second", "2")).expect("write");

        assert_eq!(
            block_on(store.read("first")).expect("read").as_deref(),
            Some("1")
        );
        assert_eq!(
            block_on(store.read("second")).expect("read").as_deref(),
            Some("2")
        );
        assert_eq!(block_on(store.read("missing")).expect("read"), None);
        let _ = std::fs::remove_dir_all(directory);
    }
}
