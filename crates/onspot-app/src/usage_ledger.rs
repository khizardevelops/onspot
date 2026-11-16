// SPDX-License-Identifier: AGPL-3.0-or-later

//! The device's own record of cloud calls, ported from `src/lib/usage/ledger.ts`.
//!
//! Every cloud adapter reports here what one call used (tokens, audio seconds,
//! characters), the rate-limit headers it could read, and any limit a refusal
//! named. The usage monitor reads it, and the LLM pacing learns each model's
//! stated limits from it. The record stays on this device (a [`DeviceStore`],
//! next to the keys), never in the synced database, and calls are kept for a
//! day, the longest window a counted limit uses.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use onspot_ports::DeviceStore;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::events::{EventSink, UiEvent};
use crate::usage::{
    parse_rate_limit_headers, parse_refusal, HeaderLimits, LimitWindow, RateLimitHeaders,
};

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

/// Calls made without a key (a local server) share one bucket.
const NO_KEY: &str = "no-key";

/// FNV-1a plus length: a short, stable bookkeeping hash, identical to the
/// driver's `hashText` (UTF-16 code units, so both sides agree on any text).
/// Not a cryptographic hash.
///
/// @returns Eight hex digits, a dash, and the length in base 36.
pub fn hash_text(text: &str) -> String {
    const FNV_OFFSET: u32 = 0x811c_9dc5;
    const FNV_PRIME: u32 = 0x0100_0193;

    let units: Vec<u16> = text.encode_utf16().collect();
    let mut hash = FNV_OFFSET;
    for unit in &units {
        hash ^= u32::from(*unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    format!("{hash:08x}-{}", to_base36(units.len() as u64))
}

fn to_base36(mut value: u64) -> String {
    if value == 0 {
        return String::from("0");
    }
    let mut digits = Vec::new();
    while value > 0 {
        digits.push(char::from_digit((value % 36) as u32, 36).unwrap_or('0'));
        value /= 36;
    }
    digits.iter().rev().collect()
}

/// A short, non-reversible id for an API key; `no-key` for a local server.
pub fn key_id(api_key: &str) -> String {
    let key = api_key.trim();
    if key.is_empty() {
        return String::from(NO_KEY);
    }
    hash_text(key)
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

/// Where this device keeps its ledger. It is the key the web driver used
/// before the core owned the ledger, so an existing record reads back as is.
pub const LEDGER_STORAGE_KEY: &str = "onspot.usage.v1";

/// What one successful cloud call used, as the adapter that made it reports it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct CallReport {
    /// Provider host, e.g. `api.groq.com`.
    pub host: String,
    pub model: String,
    /// `keyIdOf` of the key that made the call, never the key.
    pub key_id: String,
    /// Tokens the call used (prompt + reply).
    pub tokens: u64,
    /// Tokens the provider set aside to admit the call: the prompt plus the
    /// requested `max_tokens`. Zero for calls without a reply budget.
    pub reserved_tokens: u64,
    pub audio_seconds: f64,
    pub characters: u64,
    /// The response headers, for the `x-ratelimit-*` budgets when readable.
    pub headers: BTreeMap<String, String>,
}

/// A refused call (HTTP 413/429), for the limit its body may name.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct RefusalReport {
    pub host: String,
    pub model: String,
    pub key_id: String,
    /// The response body, which carries the provider's own wording.
    pub body: String,
}

impl CallReport {
    fn scope(&self) -> UsageScope {
        UsageScope {
            host: self.host.clone(),
            model: self.model.clone(),
            key_id: self.key_id.clone(),
        }
    }
}

impl RefusalReport {
    fn scope(&self) -> UsageScope {
        UsageScope {
            host: self.host.clone(),
            model: self.model.clone(),
            key_id: self.key_id.clone(),
        }
    }
}

/// The device's ledger, loaded once from its [`DeviceStore`] and saved after
/// every change. Drivers hear about changes through `usage_changed`.
pub struct UsageLedger {
    store: Arc<dyn DeviceStore>,
    events: Arc<dyn EventSink>,
    /// `None` until the stored record has been read.
    state: Mutex<Option<LedgerState>>,
}

impl UsageLedger {
    /// Creates the ledger over the device's store; nothing is read yet.
    pub fn new(store: Arc<dyn DeviceStore>, events: Arc<dyn EventSink>) -> Self {
        Self {
            store,
            events,
            state: Mutex::new(None),
        }
    }

    /// The ledger as of `now`, without anything older than a day.
    pub async fn snapshot(&self, now: u64) -> LedgerState {
        self.ensure_loaded(now).await;
        self.loaded_snapshot(now)
    }

    /// The ledger as already loaded, for callers that just awaited
    /// [`snapshot`](Self::snapshot) and must not await again (the pacing's
    /// synchronous charge steps). Empty when nothing has been loaded.
    pub fn loaded_snapshot(&self, now: u64) -> LedgerState {
        let mut state = self.lock().clone().unwrap_or_default();
        prune(&mut state, now);
        state
    }

    /// Records one successful call and the rate-limit headers it carried.
    pub async fn record_call(&self, report: &CallReport, now: u64) {
        self.ensure_loaded(now).await;

        let scope = report.scope();
        let header_limits =
            parse_rate_limit_headers(&RateLimitHeaders::from_response(&report.headers), now);
        let call = UsageEntry {
            host: scope.host.clone(),
            model: scope.model.clone(),
            key_id: scope.key_id.clone(),
            at: now,
            tokens: report.tokens,
            reserved_tokens: report.reserved_tokens,
            audio_seconds: report.audio_seconds,
            characters: report.characters,
        };

        let updated = self.update(now, |state| {
            state.calls.push(call);
            if let Some(limits) = header_limits {
                let reading = LiveReading {
                    limits,
                    observed_at: now,
                    host: Some(scope.host.clone()),
                    model: Some(scope.model.clone()),
                    key_id: Some(scope.key_id.clone()),
                };
                state.live.insert(scope_key(&scope), reading);
            }
        });
        self.save(updated).await;
    }

    /// Records the limit a refusal names, if it names one. A stated limit
    /// replaces the published one, so a paid plan's higher limits show up.
    pub async fn record_refusal(&self, report: &RefusalReport, now: u64) {
        let Some(refusal) = parse_refusal(&report.body, now) else {
            return;
        };
        self.ensure_loaded(now).await;

        let reading = ReportedReading {
            limit: refusal.limit,
            used: refusal.used,
            retry_at: refusal.retry_at,
            observed_at: now,
        };
        let key = scope_key(&report.scope());
        let updated = self.update(now, |state| {
            state
                .reported
                .entry(key)
                .or_default()
                .insert(refusal.window, reading);
        });
        self.save(updated).await;
    }

    /// Reads the stored record once. An unreadable record starts the ledger
    /// empty, as the web driver always did: losing a day of counts is better
    /// than a broken usage screen.
    async fn ensure_loaded(&self, now: u64) {
        if self.lock().is_some() {
            return;
        }

        let stored = match self.store.read(LEDGER_STORAGE_KEY).await {
            Ok(text) => text,
            Err(error) => {
                self.events.emit(&UiEvent::Error {
                    code: String::from("usage.ledger_unreadable"),
                    message: error.message,
                });
                None
            }
        };
        let mut state = stored
            .and_then(|text| serde_json::from_str::<LedgerState>(&text).ok())
            .unwrap_or_default();
        prune(&mut state, now);

        let mut slot = self.lock();
        // Another caller may have loaded it while this one awaited the store.
        if slot.is_none() {
            *slot = Some(state);
        }
    }

    /// Applies one change to the pruned ledger and returns the new record.
    fn update(&self, now: u64, change: impl FnOnce(&mut LedgerState)) -> LedgerState {
        let mut slot = self.lock();
        let state = slot.get_or_insert_with(LedgerState::default);
        prune(state, now);
        change(state);
        state.clone()
    }

    /// Writes the record and tells drivers it changed. A full or blocked store
    /// keeps the in-memory ledger working for this run.
    async fn save(&self, state: LedgerState) {
        match serde_json::to_string(&state) {
            Ok(text) => {
                if let Err(error) = self.store.write(LEDGER_STORAGE_KEY, &text).await {
                    self.events.emit(&UiEvent::Error {
                        code: String::from("usage.ledger_unsaved"),
                        message: error.message,
                    });
                }
            }
            Err(error) => self.events.emit(&UiEvent::Error {
                code: String::from("usage.ledger_unsaved"),
                message: error.to_string(),
            }),
        }
        self.events.emit(&UiEvent::UsageChanged);
    }

    fn lock(&self) -> MutexGuard<'_, Option<LedgerState>> {
        // A panic while holding the lock leaves plain data behind; keep using it.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
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
