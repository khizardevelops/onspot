// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashMap;

use onspot_app::build_session_markdown;
use onspot_domain::{Attempt, Correction, Session};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    input: Input,
    expected: String,
}
#[derive(Deserialize)]
struct Input {
    session: Session,
    attempts: Vec<Attempt>,
    corrections: Vec<Correction>,
    #[serde(rename = "exportedAt")]
    exported_at: String,
}

#[test]
fn session_markdown_matches_the_legacy_document() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("golden/sessionMarkdown.json")).expect("fixture");
    for case in fixture.cases {
        let mut by_attempt: HashMap<String, Vec<Correction>> = HashMap::new();
        for correction in case.input.corrections {
            by_attempt
                .entry(correction.attempt_id.clone())
                .or_default()
                .push(correction);
        }
        let actual = build_session_markdown(
            &case.input.session,
            &case.input.attempts,
            &by_attempt,
            &case.input.exported_at,
        );
        assert_eq!(actual, case.expected, "markdown case: {}", case.name);
    }
}
