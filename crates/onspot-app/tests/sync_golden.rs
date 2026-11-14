// SPDX-License-Identifier: AGPL-3.0-or-later

//! Golden check for the whole-database sync decision table.
//!
//! The cases are synthetic snapshot pairs from `docs/architecture/sync.md`, so
//! the promise that a cloud copy never replaces a device without a choice stays
//! guarded even when the providers change.

use onspot_app::{compare_sync, decide_with_choice, RemoteFile, SyncChoice, SyncMetadata};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    input: Input,
    expected: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    revision: u64,
    #[serde(default)]
    synced_revision: Option<u64>,
    #[serde(default)]
    metadata: Option<SyncMetadata>,
    #[serde(default)]
    remote: Option<RemoteFile>,
    #[serde(default)]
    choice: Option<SyncChoice>,
}

#[test]
fn sync_decision_goldens_match() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("golden/syncDecisions.json")).expect("fixture");

    for case in fixture.cases {
        let comparison = compare_sync(
            case.input.metadata.as_ref(),
            case.input.remote.as_ref(),
            case.input.revision,
            case.input.synced_revision,
        );
        let decision = decide_with_choice(&comparison, case.input.choice);
        let actual = json!({
            "decision": decision.as_str(),
            "hasLocalChanges": comparison.has_local_changes,
            "hasRemoteChanges": comparison.has_remote_changes,
        });

        assert_eq!(actual, case.expected, "case: {}", case.name);
    }
}
