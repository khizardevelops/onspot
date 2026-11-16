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

#[derive(Deserialize)]
struct ChunkFixture {
    cases: Vec<ChunkCase>,
}

#[derive(Deserialize)]
struct ChunkCase {
    name: String,
    input: ChunkInput,
    expected: Vec<Utf16Span>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkInput {
    text: String,
    max_words: usize,
}

/// A span as the TypeScript capture wrote it: UTF-16 offsets.
#[derive(Debug, Deserialize, PartialEq)]
struct Utf16Span {
    start: usize,
    end: usize,
}

#[test]
fn sentence_chunks_match_every_golden_case() {
    let fixture: ChunkFixture = serde_json::from_str(include_str!("golden/sentenceChunks.json"))
        .expect("sentenceChunks golden");
    for case in fixture.cases {
        let text = &case.input.text;
        let utf16_offset = |byte: usize| text[..byte].encode_utf16().count();
        let actual: Vec<Utf16Span> =
            onspot_dsp::segments::sentence_chunks(text, case.input.max_words)
                .into_iter()
                .map(|span| Utf16Span {
                    start: utf16_offset(span.start),
                    end: utf16_offset(span.end),
                })
                .collect();
        assert_eq!(actual, case.expected, "{}", case.name);
    }
}
