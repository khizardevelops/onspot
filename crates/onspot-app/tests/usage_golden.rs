// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::{parse_duration, parse_refusal};
use serde_json::Value;

#[derive(serde::Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    input: Input,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct Input {
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    now: Option<u64>,
}

#[test]
fn usage_rate_limit_goldens_match() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("golden/usageRateLimits.json")).expect("fixture");
    for case in fixture.cases {
        let actual = if let Some(duration) = case.input.duration {
            serde_json::json!({ "duration": parse_duration(&duration) })
        } else {
            let refusal = parse_refusal(
                case.input.body.as_deref().unwrap_or_default(),
                case.input.now.unwrap_or_default(),
            );
            serde_json::json!({ "refusal": refusal })
        };
        assert_eq!(actual, case.expected, "case: {}", case.name);
    }
}

#[derive(serde::Deserialize)]
struct LimitsFixture {
    cases: Vec<LimitsCase>,
}

#[derive(serde::Deserialize)]
struct LimitsCase {
    name: String,
    input: LimitsInput,
    expected: Value,
}

#[derive(serde::Deserialize)]
struct LimitsInput {
    model: String,
    plan: String,
}

#[test]
fn groq_limit_tables_match() {
    let fixture: LimitsFixture =
        serde_json::from_str(include_str!("golden/usageLimits.json")).expect("limits fixture");
    for case in fixture.cases {
        let actual = serde_json::json!({
            "published": onspot_app::groq_published_limits(&case.input.model, &case.input.plan),
            "known": onspot_app::groq_known_limits(&case.input.model, &case.input.plan),
        });
        assert_eq!(actual, case.expected, "limits case: {}", case.name);
    }
}
