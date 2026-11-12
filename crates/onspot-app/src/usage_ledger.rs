// SPDX-License-Identifier: AGPL-3.0-or-later

//! Device-local ledger math, ported from `src/lib/usage/ledger.ts`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::usage::{HeaderLimits, LimitWindow};

/// The longest counted window: one rolling day.
pub const LEDGER_RETENTION_MS: u64 = 24 * 60 * 60 * 1_000;

/// One successful cloud call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    pub host: String,
    pub model: String,
    pub key_id: String,
    pub at: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub reserved_tokens: u64,
    #[serde(default)]
    pub audio_seconds: f64,
    #[serde(default)]
    pub characters: u64,
}

/// Latest rate-limit headers per scope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveReading {
    #[serde(flatten)]
    pub limits: HeaderLimits,
    pub observed_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_id: Option<String>,
}

/// A limit a provider named in a refusal, with when it was seen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedReading {
    pub limit: u64,
    pub used: Option<u64>,
    pub retry_at: Option<u64>,
    pub observed_at: u64,
}

/// The device's ledger: calls, live headers and refusal reports.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerState {
    #[serde(default)]
    pub calls: Vec<UsageEntry>,
    #[serde(default)]
    pub live: BTreeMap<String, LiveReading>,
    #[serde(default)]
    pub reported: BTreeMap<String, BTreeMap<LimitWindow, ReportedReading>>,
}

/// Which key, provider and model a request is charged to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageScope {
    pub host: String,
    pub model: String,
    pub key_id: String,
}

/// The calls of one scope inside a window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallTotals {
    pub requests: u64,
    pub tokens: u64,
    pub audio_seconds: f64,
    pub characters: u64,
}

/// A short, non-reversible key id.
pub fn key_id(api_key: &str) -> String {
    let key = api_key.trim();
    if key.is_empty() {
        return String::from("no-key");
    }
    let mut hash: u32 = 0x811c_9dc5;
    let units: Vec<u16> = key.encode_utf16().collect();
    for unit in &units {
        hash ^= u32::from(*unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let mut length = units.len() as u64;
    let mut base36 = String::new();
    if length == 0 {
        base36.push('0');
    }
    while length > 0 {
        base36.insert(0, char::from_digit((length % 36) as u32, 36).unwrap_or('0'));
        length /= 36;
    }
    format!("{hash:08x}-{base36}")
}

/// The ledger key of a scope.
pub fn scope_key(scope: &UsageScope) -> String {
    format!("{}|{}|{}", scope.key_id, scope.host, scope.model)
}

/// Drops everything older than the retention window.
pub fn prune(state: &mut LedgerState, now: u64) {
    let recent = |at: u64| now.saturating_sub(at) < LEDGER_RETENTION_MS;
    state.calls.retain(|call| recent(call.at));
    state.live.retain(|_, reading| recent(reading.observed_at));
    state.reported.retain(|_, windows| {
        windows.retain(|_, reading| recent(reading.observed_at));
        !windows.is_empty()
    });
}

/// Adds up one scope's calls in a rolling window; `model: "*"` covers all models.
pub fn totals_within(
    calls: &[UsageEntry],
    scope: &UsageScope,
    window_ms: u64,
    now: u64,
) -> CallTotals {
    let mut totals = CallTotals {
        requests: 0,
        tokens: 0,
        audio_seconds: 0.0,
        characters: 0,
    };
    for call in calls {
        let same_scope = call.key_id == scope.key_id
            && call.host == scope.host
            && (scope.model == "*" || call.model == scope.model);
        if !same_scope || now.saturating_sub(call.at) >= window_ms {
            continue;
        }
        totals.requests += 1;
        totals.tokens += call.tokens;
        totals.audio_seconds += call.audio_seconds;
        totals.characters += call.characters;
    }
    totals
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(at: u64, model: &str) -> UsageEntry {
        UsageEntry {
            host: String::from("api.groq.com"),
            model: String::from(model),
            key_id: key_id("secret"),
            at,
            tokens: 10,
            reserved_tokens: 20,
            audio_seconds: 1.5,
            characters: 3,
        }
    }

    #[test]
    fn totals_respect_scope_model_and_window() {
        let scope = UsageScope {
            host: String::from("api.groq.com"),
            model: String::from("m"),
            key_id: key_id("secret"),
        };
        let calls = vec![call(0, "m"), call(30_000, "m"), call(0, "other")];
        let totals = totals_within(&calls, &scope, 60_000, 59_999);
        assert_eq!(totals.requests, 2);
        assert_eq!(totals.tokens, 20);

        let all = UsageScope {
            model: String::from("*"),
            ..scope
        };
        assert_eq!(totals_within(&calls, &all, 60_000, 59_999).requests, 3);
    }

    #[test]
    fn pruning_keeps_exactly_the_retention_window() {
        let mut state = LedgerState {
            calls: vec![call(0, "m"), call(1, "m")],
            ..LedgerState::default()
        };
        prune(&mut state, LEDGER_RETENTION_MS);
        assert_eq!(state.calls.len(), 1);
        assert_eq!(state.calls[0].at, 1);
    }

    #[test]
    fn key_ids_are_stable_and_non_reversible() {
        assert_eq!(key_id(" secret "), key_id("secret"));
        assert_ne!(key_id("secret"), "secret");
        assert_eq!(key_id("  "), "no-key");
    }
}

#[cfg(test)]
mod interop {
    use super::*;

    #[test]
    fn legacy_local_storage_json_round_trips() {
        let json = r#"{
            "calls":[{"host":"api.groq.com","model":"openai/gpt-oss-120b","keyId":"abc-1","at":1000,"tokens":3000,"reservedTokens":4850,"audioSeconds":0,"characters":0}],
            "live":{"abc-1|api.groq.com|openai/gpt-oss-120b":{"requests":{"limit":1000,"remaining":990,"resetsAt":null},"tokens":null,"observedAt":1200,"host":"api.groq.com","model":"openai/gpt-oss-120b","keyId":"abc-1"}},
            "reported":{"abc-1|api.groq.com|openai/gpt-oss-120b":{"TPD":{"limit":200000,"used":199000,"retryAt":null,"observedAt":1300}}}
        }"#;
        let state: LedgerState = serde_json::from_str(json).expect("legacy ledger");
        assert_eq!(state.calls[0].reserved_tokens, 4_850);
        assert_eq!(
            state
                .live
                .values()
                .next()
                .and_then(|reading| reading.limits.requests.as_ref())
                .map(|budget| budget.remaining),
            Some(990)
        );
        assert_eq!(
            state
                .reported
                .values()
                .next()
                .and_then(|windows| windows.get(&LimitWindow::TPD))
                .map(|reading| reading.used),
            Some(Some(199_000))
        );
        let written = serde_json::to_value(&state).expect("serialize");
        assert_eq!(written["calls"][0]["reservedTokens"], 4_850);
        assert_eq!(written["live"].as_object().map(|live| live.len()), Some(1));
    }
}
