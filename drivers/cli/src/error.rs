// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_ports::{CoreError, SqlError, StoreError};

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sql(#[from] SqlError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Core(#[from] CoreError),
}

impl CliError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}
