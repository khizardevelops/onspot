// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::{key_id, scope_key, totals_within, UsageEntry, UsageScope};
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
    key: String,
    #[serde(default)]
    now: u64,
    #[serde(default, rename = "windowMs")]
    window_ms: u64,
    #[serde(default)]
    scope: Option<Scope>,
    #[serde(default)]
    calls: Option<Vec<UsageEntry>>,
}
#[derive(Deserialize)]
struct Scope {
    host: String,
    model: String,
}

#[test]
fn usage_ledger_goldens_match() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("golden/usageLedger.json")).expect("ledger fixture");
    for case in fixture.cases {
        let id = key_id(&case.input.key);
        let actual = if let (Some(scope), Some(calls)) = (case.input.scope, case.input.calls) {
            let scope = UsageScope {
                host: scope.host,
                model: scope.model,
                key_id: id.clone(),
            };
            serde_json::json!({
                "keyId": id,
                "scopeKey": scope_key(&scope),
                "totals": totals_within(&calls, &scope, case.input.window_ms, case.input.now),
            })
        } else {
            serde_json::json!({ "keyId": id })
        };
        assert!(
            same(&actual, &case.expected),
            "ledger case: {} ({actual} != {})",
            case.name,
            case.expected
        );
    }
}

fn same(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| same(value, other)))
        }
        _ => left == right,
    }
}
