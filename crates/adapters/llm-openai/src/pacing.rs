// SPDX-License-Identifier: AGPL-3.0-or-later

//! Token-bucket pacing for provider per-minute limits.
//!
//! The full TypeScript pacing also reads usage-ledger headers and provider
//! model catalogs; this core keeps the rule the phase pins: allowances refill
//! continuously, a request is charged before it is sent, and a wait has the
//! same 120 ms landing margin as today.

use std::collections::HashMap;
use std::sync::Mutex;

/// Tokens a minute before a provider has stated a limit.
pub const DEFAULT_TOKENS_PER_MINUTE: u32 = 8_000;
/// Added so a request lands just after the allowance refilled.
pub const WAIT_MARGIN_MS: u64 = 120;
const MINUTE_MS: u64 = 60_000;

struct Bucket {
    capacity: u64,
    level: u64,
    measured_at: u64,
}

/// One in-memory bucket per endpoint/model, refilled by elapsed time.
#[derive(Default)]
pub struct Pacing {
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl Pacing {
    /// How long until `tokens` fit, or zero when they fit now.
    pub fn wait_ms(&self, key: &str, tokens: u64, capacity: u64, now: u64) -> u64 {
        let mut buckets = self.buckets.lock().expect("pacing buckets");
        let bucket = buckets.entry(key.to_owned()).or_insert(Bucket {
            capacity,
            level: 0,
            measured_at: now,
        });
        bucket.capacity = capacity;
        let level = refilled(bucket, now);
        let overflow = level.saturating_add(tokens).saturating_sub(bucket.capacity);
        if overflow == 0 {
            0
        } else {
            overflow.saturating_mul(MINUTE_MS) / bucket.capacity.max(1) + WAIT_MARGIN_MS
        }
    }

    /// Charges a request to the bucket after its wait has elapsed.
    pub fn charge(&self, key: &str, tokens: u64, capacity: u64, now: u64) {
        let mut buckets = self.buckets.lock().expect("pacing buckets");
        let bucket = buckets.entry(key.to_owned()).or_insert(Bucket {
            capacity,
            level: 0,
            measured_at: now,
        });
        bucket.capacity = capacity;
        let level = refilled(bucket, now);
        bucket.level = level.saturating_add(tokens);
        bucket.measured_at = now;
    }
}

fn refilled(bucket: &Bucket, now: u64) -> u64 {
    let elapsed = now.saturating_sub(bucket.measured_at);
    let refill = elapsed.saturating_mul(bucket.capacity) / MINUTE_MS;
    bucket.level.saturating_sub(refill)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_tokens_over_an_8000_allowance_waits_15ms_plus_the_margin() {
        let pacing = Pacing::default();
        pacing.charge("groq|m", 8_002, 8_000, 0);
        assert_eq!(pacing.wait_ms("groq|m", 0, 8_000, 0), 15 + WAIT_MARGIN_MS);
    }

    #[test]
    fn a_full_minute_refills_the_allowance() {
        let pacing = Pacing::default();
        pacing.charge("groq|m", 8_000, 8_000, 0);
        assert_eq!(pacing.wait_ms("groq|m", 8_000, 8_000, 60_000), 0);
    }
}
