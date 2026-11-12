// SPDX-License-Identifier: AGPL-3.0-or-later

//! Parity check for the history matcher: every case captured from
//! `src/lib/utils/historySearch.ts` must select the same sessions in Rust.

use onspot_dsp::search;

#[derive(serde::Deserialize)]
struct Capture {
    context: Context,
    cases: Vec<Case>,
}

#[derive(serde::Deserialize)]
struct Context {
    sessions: Vec<Session>,
}

#[derive(serde::Deserialize)]
struct Session {
    title: String,
    transcripts: Vec<String>,
}

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    input: Input,
    expected: Expected,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    query: String,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    case_sensitive: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    error: bool,
    matched_titles: Vec<String>,
}

#[test]
fn the_rust_matcher_reproduces_the_legacy_capture() {
    let capture: Capture =
        serde_json::from_str(include_str!("golden/history_search.json")).expect("capture parses");

    for case in &capture.cases {
        let matcher = search::compile(
            &case.input.query,
            case.input.regex,
            case.input.case_sensitive,
        );
        assert_eq!(
            matcher.is_err(),
            case.expected.error,
            "{}: error mismatch",
            case.name
        );
        // An invalid expression has no matcher to run; the capture only records
        // that it failed, exactly as the page shows its inline error.
        if case.expected.error {
            continue;
        }

        let matched: Vec<String> = match matcher.expect("compiled: the capture says no error") {
            Some(matcher) => capture
                .context
                .sessions
                .iter()
                .filter(|session| {
                    matcher.is_match(&session.title)
                        || session
                            .transcripts
                            .iter()
                            .any(|transcript| matcher.is_match(transcript))
                })
                .map(|session| session.title.clone())
                .collect(),
            None => Vec::new(),
        };
        assert_eq!(matched, case.expected.matched_titles, "{}", case.name);
    }
}
