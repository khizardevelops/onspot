// SPDX-License-Identifier: AGPL-3.0-or-later

//! Golden parity for the speech helpers against the P0 TypeScript captures.

use serde::Deserialize;

use onspot_dsp::speech::{cap_words, is_silent};

#[derive(Deserialize)]
struct CapCase {
    name: String,
    input: CapInput,
    expected: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapInput {
    text: String,
    max_words: usize,
}

#[derive(Deserialize)]
struct SilenceCase {
    name: String,
    input: SilenceInput,
    expected: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SilenceInput {
    pcm: Vec<f32>,
    sample_rate: u32,
}

#[derive(Deserialize)]
struct CapFixture {
    cases: Vec<CapCase>,
}

#[derive(Deserialize)]
struct SilenceFixture {
    cases: Vec<SilenceCase>,
}

#[test]
fn cap_words_matches_every_golden_case() {
    let fixture: CapFixture = serde_json::from_str(include_str!("golden/capWords.json"))
        .expect("capWords fixture parses");
    for case in fixture.cases {
        assert_eq!(
            cap_words(&case.input.text, case.input.max_words),
            case.expected,
            "{}",
            case.name
        );
    }
}

#[test]
fn is_silent_matches_every_golden_case() {
    let fixture: SilenceFixture = serde_json::from_str(include_str!("golden/isSilent.json"))
        .expect("isSilent fixture parses");
    for case in fixture.cases {
        assert_eq!(
            is_silent(&case.input.pcm, case.input.sample_rate),
            case.expected,
            "{}",
            case.name
        );
    }
}
