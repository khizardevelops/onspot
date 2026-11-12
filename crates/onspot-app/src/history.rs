// SPDX-License-Identifier: AGPL-3.0-or-later

//! The core's history read path: list, search, rename and delete.
//!
//! The screen's grouping by day and snippet highlighting stay in the driver
//! (they are presentation); the matching rule itself is here, pinned by the
//! goldens captured from the page's `matcher` derived.

use std::collections::HashMap;

use onspot_domain::{AttemptPreview, Session};
use onspot_ports::{HistoryStore, StoreError};

use onspot_dsp::search::{self, SearchError};

/// One session with its takes, as the history screen consumes them.
#[derive(Debug, Clone, PartialEq)]
pub struct HistorySession {
    pub session: Session,
    pub attempts: Vec<AttemptPreview>,
}

/// A failed history command.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HistoryError {
    /// The search expression could not be compiled.
    #[error("{0}")]
    Search(SearchError),
    /// The store failed.
    #[error("{0}")]
    Store(StoreError),
}

impl From<StoreError> for HistoryError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// The history use cases over a [`HistoryStore`].
pub struct HistoryService<'a> {
    store: &'a dyn HistoryStore,
}

impl<'a> HistoryService<'a> {
    /// Creates the service over a store.
    pub fn new(store: &'a dyn HistoryStore) -> Self {
        Self { store }
    }

    /// Every session with its takes, newest session first.
    pub async fn list(&self) -> Result<Vec<HistorySession>, StoreError> {
        self.group(
            self.store.list_sessions().await?,
            self.store.list_attempt_previews().await?,
        )
    }

    /// Sessions whose title or any take's transcript matches the query.
    ///
    /// An empty query matches every session, like the legacy screen (which
    /// skips filtering when there is no matcher).
    pub async fn search(
        &self,
        query: &str,
        regex: bool,
        case_sensitive: bool,
    ) -> Result<Vec<HistorySession>, HistoryError> {
        let matcher =
            search::compile(query, regex, case_sensitive).map_err(HistoryError::Search)?;
        let sessions = self
            .group(
                self.store.list_sessions().await?,
                self.store.list_attempt_previews().await?,
            )
            .map_err(HistoryError::Store)?;
        let Some(matcher) = matcher else {
            return Ok(sessions);
        };
        Ok(sessions
            .into_iter()
            .filter(|entry| {
                matcher.is_match(&entry.session.title)
                    || entry
                        .attempts
                        .iter()
                        .any(|attempt| matcher.is_match(&attempt.transcript))
            })
            .collect())
    }

    /// Renames a session. `false` when it no longer exists.
    pub async fn rename(&self, id: &str, title: &str) -> Result<bool, StoreError> {
        self.store.rename_session(id, title).await
    }

    /// Deletes a session and its takes. `false` when it no longer exists.
    pub async fn delete(&self, id: &str) -> Result<bool, StoreError> {
        self.store.delete_session(id).await
    }

    /// Joins sessions and previews in one pass, preserving the store's order.
    fn group(
        &self,
        sessions: Vec<Session>,
        previews: Vec<AttemptPreview>,
    ) -> Result<Vec<HistorySession>, StoreError> {
        let mut by_session: HashMap<String, Vec<AttemptPreview>> = HashMap::new();
        for preview in previews {
            by_session
                .entry(preview.session_id.clone())
                .or_default()
                .push(preview);
        }
        Ok(sessions
            .into_iter()
            .map(|session| {
                let attempts = by_session.remove(&session.id).unwrap_or_default();
                HistorySession { session, attempts }
            })
            .collect())
    }
}
