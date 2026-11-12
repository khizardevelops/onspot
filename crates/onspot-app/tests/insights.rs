// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::compute_insights;
use onspot_domain::{Attempt, Correction, Session};
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
    sessions: Vec<Session>,
    attempts: Vec<Attempt>,
    corrections: Vec<Correction>,
}

fn normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => Value::Number(
            serde_json::Number::from_f64(number.as_f64().unwrap_or_default()).expect("finite"),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(normalize).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key, normalize(value)))
                .collect(),
        ),
        other => other,
    }
}

#[test]
fn insights_match_every_golden_case() {
    let fixture: Fixture = serde_json::from_str(include_str!("golden/insights.json"))
        .expect("insights fixture parses");
    for case in fixture.cases {
        let actual = serde_json::to_value(compute_insights(
            &case.input.sessions,
            &case.input.attempts,
            &case.input.corrections,
        ))
        .expect("insights serialize");
        assert_eq!(
            normalize(actual),
            normalize(case.expected),
            "insights case: {}",
            case.name
        );
    }
}
