// SPDX-License-Identifier: AGPL-3.0-or-later

//! P4 golden parity for the prompt, explanation, JSON extraction and
//! evaluation parser.

use onspot_adapter_llm_openai::explanation::{
    compose_explanation, normalize_explanation, separate_follow_up,
};
use onspot_adapter_llm_openai::json_repair::repair_json;
use onspot_adapter_llm_openai::parse::{extract_json, normalize_evaluation, strip_thinking};
use onspot_adapter_llm_openai::prompt::{build_evaluation_messages, EvaluationPart};
use serde_json::Value;

#[derive(serde::Deserialize)]
struct RepairFixture {
    cases: Vec<RepairCase>,
}

#[derive(serde::Deserialize)]
struct RepairCase {
    name: String,
    input: String,
    expected: Option<String>,
}

#[test]
fn json_repair_matches_every_case() {
    let fixture: RepairFixture = serde_json::from_str(include_str!("golden/jsonRepair.json"))
        .expect("jsonRepair fixture parses");
    for case in fixture.cases {
        assert_eq!(
            repair_json(&case.input),
            case.expected,
            "jsonRepair case: {}",
            case.name
        );
    }
}

#[derive(serde::Deserialize)]
struct PromptFixture {
    cases: Vec<PromptCase>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptCase {
    name: String,
    input: PromptInput,
    expected: Value,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptInput {
    transcript: String,
    prompt: String,
    mode: String,
    level: String,
    language: String,
    translation_target: String,
    #[serde(default)]
    part: Option<Part>,
}

#[derive(serde::Deserialize)]
struct Part {
    number: usize,
    count: usize,
}

#[test]
fn evaluation_prompt_matches_every_case() {
    let fixture: PromptFixture = serde_json::from_str(include_str!("golden/evaluationPrompt.json"))
        .expect("evaluationPrompt fixture parses");
    for case in fixture.cases {
        let messages = build_evaluation_messages(
            &case.input.transcript,
            &case.input.prompt,
            &case.input.mode,
            &case.input.level,
            &case.input.language,
            &case.input.translation_target,
            case.input.part.map(|part| EvaluationPart {
                number: part.number,
                count: part.count,
            }),
        );
        let actual = serde_json::to_value(messages).expect("messages serialize");
        assert_eq!(actual, case.expected, "prompt case: {}", case.name);
    }
}

#[derive(serde::Deserialize)]
struct ExplanationFixture {
    cases: Vec<ExplanationCase>,
}

#[derive(serde::Deserialize)]
struct ExplanationCase {
    name: String,
    input: Value,
    expected: String,
}

#[test]
fn explanation_composition_matches_every_case() {
    let fixture: ExplanationFixture =
        serde_json::from_str(include_str!("golden/explanation.json")).expect("explanation fixture");
    for case in fixture.cases {
        assert_eq!(
            compose_explanation(&case.input),
            case.expected,
            "explanation case: {}",
            case.name
        );
    }
}

#[derive(serde::Deserialize)]
struct ParseFixture {
    cases: Vec<ParseCase>,
}

#[derive(serde::Deserialize)]
struct ParseCase {
    name: String,
    input: ParseInput,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct ParseInput {
    transcript: String,
    language: Option<String>,
    raw: Value,
}

#[test]
fn evaluation_parse_matches_every_case() {
    let fixture: ParseFixture =
        serde_json::from_str(include_str!("golden/evaluationParse.json")).expect("parse fixture");
    for case in fixture.cases {
        let result = normalize_evaluation(
            &case.input.raw,
            &case.input.transcript,
            case.input.language.as_deref(),
        );
        let actual = serde_json::to_value(result).expect("result serializes");
        assert_eq!(actual, case.expected, "parse case: {}", case.name);
    }
}

#[derive(serde::Deserialize)]
struct ExtractFixture {
    cases: Vec<ExtractCase>,
}

#[derive(serde::Deserialize)]
struct ExtractCase {
    name: String,
    input: ExtractInput,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct ExtractInput {
    text: String,
}

#[test]
fn json_extraction_matches_every_case() {
    let fixture: ExtractFixture =
        serde_json::from_str(include_str!("golden/jsonExtract.json")).expect("extract fixture");
    for case in fixture.cases {
        let thinking = strip_thinking(&case.input.text);
        let actual = match extract_json(&case.input.text) {
            Ok(value) => serde_json::json!({ "thinking": thinking, "parsed": value }),
            Err(error) => serde_json::json!({ "thinking": thinking, "error": error }),
        };
        assert_eq!(actual, case.expected, "extract case: {}", case.name);
    }
}

#[derive(serde::Deserialize)]
struct MarkupFixture {
    cases: Vec<MarkupCase>,
}

#[derive(serde::Deserialize)]
struct MarkupCase {
    name: String,
    input: MarkupInput,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct MarkupInput {
    markup: String,
}

#[test]
fn explanation_markup_matches_every_case() {
    let fixture: MarkupFixture =
        serde_json::from_str(include_str!("golden/explanationMarkup.json"))
            .expect("markup fixture");
    for case in fixture.cases {
        let normalized = normalize_explanation(&case.input.markup);
        let (parts, asked) = separate_follow_up(&normalized);
        let actual = serde_json::json!({
            "markup": normalized,
            "parts": parts,
            "askedQuestion": asked,
        });
        assert_eq!(actual, case.expected, "markup case: {}", case.name);
    }
}
