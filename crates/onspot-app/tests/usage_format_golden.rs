// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::{
    format_count, format_duration, format_portion, format_quantity, format_reset, UsageUnit,
};
use serde::Deserialize;
use serde_json::Value;

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
struct Input {
    kind: String,
    value: f64,
    #[serde(default)]
    whole: f64,
    #[serde(default)]
    now: u64,
    #[serde(default)]
    unit: Option<UsageUnit>,
}

#[test]
fn usage_format_goldens_match() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("golden/usageFormat.json")).expect("format fixture");
    for case in fixture.cases {
        let unit = case.input.unit.unwrap_or(UsageUnit::Tokens);
        let actual = match case.input.kind.as_str() {
            "count" => Value::String(format_count(case.input.value)),
            "duration" => Value::String(format_duration(case.input.value)),
            "quantity" => Value::String(format_quantity(case.input.value, unit)),
            "portion" => {
                let (part, of_whole) = format_portion(case.input.value, case.input.whole, unit);
                serde_json::json!({ "part": part, "ofWhole": of_whole })
            }
            "reset" => Value::String(format_reset(case.input.value as u64, case.input.now)),
            other => panic!("unknown format kind {other}"),
        };
        assert_eq!(actual, case.expected, "format case: {}", case.name);
    }
}
