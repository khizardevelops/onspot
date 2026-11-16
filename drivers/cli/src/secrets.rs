// SPDX-License-Identifier: AGPL-3.0-or-later

//! CLI key lookup: environment first, then a JSON keyfile. Keys never enter
//! the database, a prompt, an export or the event log.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::CliError;

pub struct CliSecrets {
    keys: BTreeMap<String, String>,
}

impl CliSecrets {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, CliError> {
        let path = path.as_ref();
        let keys = if path.exists() {
            let raw = std::fs::read_to_string(path)?;
            serde_json::from_str::<BTreeMap<String, String>>(&raw).map_err(|error| {
                CliError::message(format!(
                    "{} is not a JSON object of provider keys: {error}",
                    path.display()
                ))
            })?
        } else {
            BTreeMap::new()
        };
        Ok(Self { keys })
    }

    /// An environment key wins over the keyfile, so one-off runs need no file.
    pub fn key(&self, provider: &str) -> Option<String> {
        for name in env_names(provider) {
            if let Ok(value) = std::env::var(name) {
                let value = value.trim().to_owned();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
        self.keys.get(provider).cloned()
    }

    pub fn keys_file_path(path: Option<PathBuf>) -> PathBuf {
        path.or_else(|| std::env::var_os("ONSPOT_KEYS_FILE").map(PathBuf::from))
            .unwrap_or_else(crate::db::default_keys_path)
    }
}

fn env_names(provider: &str) -> Vec<String> {
    let upper = provider.to_ascii_uppercase().replace('-', "_");
    let known = match provider {
        "groq" => Some("GROQ_API_KEY"),
        "deepseek" => Some("DEEPSEEK_API_KEY"),
        "custom" => Some("ONSPOT_API_KEY"),
        _ => None,
    };
    let mut names = vec![format!("ONSPOT_{upper}_API_KEY")];
    if let Some(known) = known {
        names.push(known.to_owned());
    }
    names
}
