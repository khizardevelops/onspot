// SPDX-License-Identifier: AGPL-3.0-or-later

//! Provider rate-limit parsing, ported from `src/lib/usage/rateLimits.ts`.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

static DURATION_PART: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(\d+(?:\.\d+)?)(ms|h|m|s)").expect("duration regex"));
static BARE_NUMBER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\d+(\.\d+)?$").expect("bare number regex"));
static REFUSAL_LIMIT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\((RPM|RPD|TPM|OTPM|TPD|ASH|ASD)\):\s*Limit\s+(\d+)(?:,\s*Used\s+(\d+))?")
        .expect("refusal limit regex")
});
static RETRY_IN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)try again in\s+([\dhms.]+)").expect("retry regex"));
static REQUESTED: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)Requested\s+(\d+)").expect("requested regex"));

/// The limit windows providers name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum LimitWindow {
    RPM,
    RPD,
    TPM,
    OTPM,
    TPD,
    ASH,
    ASD,
}

impl LimitWindow {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "RPM" => Self::RPM,
            "RPD" => Self::RPD,
            "TPM" => Self::TPM,
            "OTPM" => Self::OTPM,
            "TPD" => Self::TPD,
            "ASH" => Self::ASH,
            "ASD" => Self::ASD,
            _ => return None,
        })
    }
}

/// One budget pair from `x-ratelimit-*` headers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderBudget {
    pub limit: u64,
    pub remaining: u64,
    pub resets_at: Option<u64>,
}

/// The request and token budgets a response advertised.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderLimits {
    pub requests: Option<HeaderBudget>,
    pub tokens: Option<HeaderBudget>,
}

/// Header values as strings; absent headers are `None`.
#[derive(Debug, Default, Clone)]
pub struct RateLimitHeaders {
    pub limit_requests: Option<String>,
    pub remaining_requests: Option<String>,
    pub reset_requests: Option<String>,
    pub limit_tokens: Option<String>,
    pub remaining_tokens: Option<String>,
    pub reset_tokens: Option<String>,
}

impl RateLimitHeaders {
    /// Picks the `x-ratelimit-*` values out of a response's headers.
    ///
    /// Header names are case-insensitive on the wire, so they are matched
    /// that way; a host that lower-cases them (`fetch`) and one that does not
    /// read the same.
    pub fn from_response(headers: &BTreeMap<String, String>) -> Self {
        let value = |name: &str| {
            headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.clone())
        };

        Self {
            limit_requests: value("x-ratelimit-limit-requests"),
            remaining_requests: value("x-ratelimit-remaining-requests"),
            reset_requests: value("x-ratelimit-reset-requests"),
            limit_tokens: value("x-ratelimit-limit-tokens"),
            remaining_tokens: value("x-ratelimit-remaining-tokens"),
            reset_tokens: value("x-ratelimit-reset-tokens"),
        }
    }
}

fn read_budget(
    limit: Option<&str>,
    remaining: Option<&str>,
    reset: Option<&str>,
    now: u64,
) -> Option<HeaderBudget> {
    let limit: f64 = limit?.parse().ok()?;
    let remaining: f64 = remaining?.parse().ok()?;
    if !limit.is_finite() || limit <= 0.0 || !remaining.is_finite() {
        return None;
    }
    Some(HeaderBudget {
        limit: limit as u64,
        remaining: (remaining.max(0.0).min(limit)) as u64,
        resets_at: reset.and_then(parse_duration).map(|in_ms| now + in_ms),
    })
}

/// Reads the `x-ratelimit-*` headers of a response.
pub fn parse_rate_limit_headers(headers: &RateLimitHeaders, now: u64) -> Option<HeaderLimits> {
    let requests = read_budget(
        headers.limit_requests.as_deref(),
        headers.remaining_requests.as_deref(),
        headers.reset_requests.as_deref(),
        now,
    );
    let tokens = read_budget(
        headers.limit_tokens.as_deref(),
        headers.remaining_tokens.as_deref(),
        headers.reset_tokens.as_deref(),
        now,
    );
    (requests.is_some() || tokens.is_some()).then_some(HeaderLimits { requests, tokens })
}

/// A limit a provider named in a refusal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusalLimit {
    pub window: LimitWindow,
    pub limit: u64,
    pub used: Option<u64>,
    pub requested: Option<u64>,
    pub retry_at: Option<u64>,
}

/// Parses a duration such as `1m26.4s`, `547ms` or a bare number of seconds.
pub fn parse_duration(value: &str) -> Option<u64> {
    let text = value.trim();
    if text.is_empty() {
        return None;
    }
    if BARE_NUMBER.is_match(text) {
        return text
            .parse::<f64>()
            .ok()
            .map(|seconds| (seconds * 1000.0) as u64);
    }

    let mut total = 0.0_f64;
    let mut matched = String::new();
    for captures in DURATION_PART.captures_iter(text) {
        let whole = captures.get(0).expect("whole match").as_str();
        let amount: f64 = captures[1].parse().ok()?;
        total += amount
            * match &captures[2] {
                "ms" => 1.0,
                "s" => 1000.0,
                "m" => 60_000.0,
                "h" => 3_600_000.0,
                _ => return None,
            };
        matched.push_str(whole);
    }
    (matched == text).then_some(total as u64)
}

/// Reads the limit a refusal body names.
pub fn parse_refusal(body: &str, now: u64) -> Option<RefusalLimit> {
    let captures = REFUSAL_LIMIT.captures(body)?;
    // Matched case-insensitively, like the provider text it came from.
    let window = LimitWindow::from_name(&captures[1].to_ascii_uppercase())?;
    let limit = captures[2].parse().ok()?;
    let used = captures
        .get(3)
        .and_then(|value| value.as_str().parse().ok());
    let retry_in = RETRY_IN
        .captures(body)
        .and_then(|captures| captures.get(1))
        .and_then(|value| parse_duration(value.as_str().trim_end_matches('.')));
    let requested = REQUESTED
        .captures(body)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse().ok());

    Some(RefusalLimit {
        window,
        limit,
        used,
        requested,
        retry_at: retry_in.map(|milliseconds| now + milliseconds),
    })
}
