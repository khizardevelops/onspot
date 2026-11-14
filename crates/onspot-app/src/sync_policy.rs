// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whole-database sync policy, ported from `src/lib/adapters/sync/service.ts`.
//!
//! The policy is pure: providers move bytes, the driver writes the database,
//! and this module decides whether that is safe without asking.

use serde::{Deserialize, Serialize};

/// The one remote file a provider keeps for this app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    pub modified_at: String,
    pub etag: String,
    pub size: Option<u64>,
}

/// The sync metadata stored on this device for one provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadata {
    pub etag: String,
    pub remote_file_id: String,
    pub last_synced_at: String,
}

/// Both sides of the comparison shown in the conflict dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncComparison {
    pub local_revision: u64,
    pub synced_revision: Option<u64>,
    pub local_size: Option<u64>,
    pub remote: Option<RemoteFile>,
    pub last_synced_at: Option<String>,
    pub has_local_changes: bool,
    pub has_remote_changes: bool,
}

/// What the learner is asked to choose when both sides changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncChoice {
    Upload,
    Download,
}

/// What a sync should do, or needs the learner to decide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncDecision {
    UpToDate,
    Upload,
    NeedsChoice,
    Download,
}

impl SyncDecision {
    /// The serialized string the driver and UI expect.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UpToDate => "up-to-date",
            Self::Upload => "upload",
            Self::NeedsChoice => "needs-choice",
            Self::Download => "download",
        }
    }
}

/// Builds the comparison from local metadata and the remote file.
pub fn compare_sync(
    metadata: Option<&SyncMetadata>,
    remote: Option<&RemoteFile>,
    revision: u64,
    synced_revision: Option<u64>,
) -> SyncComparison {
    let has_local_changes = match synced_revision {
        Some(synced) => synced != revision,
        None => true,
    };
    let has_remote_changes = match remote {
        Some(remote) => match metadata {
            Some(metadata) => metadata.etag != remote.etag,
            None => true,
        },
        None => metadata.is_some(),
    };
    SyncComparison {
        local_revision: revision,
        synced_revision,
        local_size: None,
        remote: remote.cloned(),
        last_synced_at: metadata.map(|metadata| metadata.last_synced_at.clone()),
        has_local_changes,
        has_remote_changes,
    }
}

/// Decides what a sync should do without performing any I/O.
pub fn decide_sync(comparison: &SyncComparison) -> SyncDecision {
    if comparison.remote.is_none() {
        return SyncDecision::Upload;
    }
    if comparison.last_synced_at.is_none() {
        return SyncDecision::NeedsChoice;
    }
    if comparison.has_local_changes && comparison.has_remote_changes {
        return SyncDecision::NeedsChoice;
    }
    if comparison.has_local_changes {
        return SyncDecision::Upload;
    }
    if comparison.has_remote_changes {
        return SyncDecision::NeedsChoice;
    }
    SyncDecision::UpToDate
}

/// Applies an explicit learner choice to a comparison.
pub fn decide_with_choice(comparison: &SyncComparison, choice: Option<SyncChoice>) -> SyncDecision {
    match choice {
        Some(SyncChoice::Upload) => SyncDecision::Upload,
        Some(SyncChoice::Download) => SyncDecision::Download,
        None => decide_sync(comparison),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(etag: &str) -> RemoteFile {
        RemoteFile {
            id: String::from("file"),
            name: String::from("onspot.sqlite"),
            modified_at: String::from("2026-11-12T10:00:00Z"),
            etag: etag.to_owned(),
            size: Some(1024),
        }
    }

    fn metadata(etag: &str) -> SyncMetadata {
        SyncMetadata {
            etag: etag.to_owned(),
            remote_file_id: String::from("file"),
            last_synced_at: String::from("2026-11-12T10:00:00Z"),
        }
    }

    #[test]
    fn no_remote_file_uploads_without_asking() {
        let comparison = compare_sync(None, None, 1, None);
        assert_eq!(decide_sync(&comparison), SyncDecision::Upload);
    }

    #[test]
    fn an_unknown_remote_needs_a_choice_even_without_local_changes() {
        let remote = remote("e1");
        let comparison = compare_sync(None, Some(&remote), 1, Some(1));
        assert_eq!(decide_sync(&comparison), SyncDecision::NeedsChoice);
    }

    #[test]
    fn only_local_changes_upload_automatically() {
        let remote = remote("e1");
        let metadata = metadata("e1");
        let comparison = compare_sync(Some(&metadata), Some(&remote), 2, Some(1));
        assert_eq!(decide_sync(&comparison), SyncDecision::Upload);
    }

    #[test]
    fn remote_edits_always_ask_before_replacing_local_data() {
        let remote = remote("e2");
        let metadata = metadata("e1");
        let comparison = compare_sync(Some(&metadata), Some(&remote), 1, Some(1));
        assert_eq!(decide_sync(&comparison), SyncDecision::NeedsChoice);
    }

    #[test]
    fn both_sides_changed_asks_and_an_explicit_choice_wins() {
        let remote = remote("e2");
        let metadata = metadata("e1");
        let comparison = compare_sync(Some(&metadata), Some(&remote), 2, Some(1));
        assert!(comparison.has_local_changes && comparison.has_remote_changes);
        assert_eq!(decide_sync(&comparison), SyncDecision::NeedsChoice);
        assert_eq!(
            decide_with_choice(&comparison, Some(SyncChoice::Download)),
            SyncDecision::Download
        );
        assert_eq!(
            decide_with_choice(&comparison, Some(SyncChoice::Upload)),
            SyncDecision::Upload
        );
    }

    #[test]
    fn matching_revisions_and_etag_are_up_to_date() {
        let remote = remote("e1");
        let metadata = metadata("e1");
        let comparison = compare_sync(Some(&metadata), Some(&remote), 7, Some(7));
        assert_eq!(decide_sync(&comparison), SyncDecision::UpToDate);
    }
}
