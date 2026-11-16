// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cross-session insights, ported from `src/lib/insights.ts`.
//!
//! Style suggestions stay out of the pattern list; everything else groups by
//! `category|label` (case- and spacing-insensitive), and a group is as severe
//! as its worst occurrence.

use std::collections::HashMap;

use onspot_domain::{Attempt, Correction, Session};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One correction and the rows it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<Session>,
    pub attempt: Attempt,
    pub correction: Correction,
}

/// A repeated mistake.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub key: String,
    pub label: String,
    pub category: String,
    pub severity: String,
    pub count: u64,
    pub session_ids: Vec<String>,
    pub occurrences: Vec<Occurrence>,
}

/// Session totals shown above the pattern list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct InsightsTotals {
    pub sessions: u64,
    pub attempts: u64,
    pub words: i64,
    pub speaking_seconds: f64,
    pub errors: u64,
    pub warnings: u64,
    pub suggestions: u64,
}

/// The full Insights page payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct InsightsData {
    pub totals: InsightsTotals,
    pub patterns: Vec<Pattern>,
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    }
}

fn normalized_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Aggregates sessions, attempts and corrections into totals and patterns.
pub fn compute_insights(
    sessions: &[Session],
    attempts: &[Attempt],
    corrections: &[Correction],
) -> InsightsData {
    let session_by_id: HashMap<&str, &Session> = sessions
        .iter()
        .map(|session| (session.id.as_str(), session))
        .collect();
    let attempt_by_id: HashMap<&str, &Attempt> = attempts
        .iter()
        .map(|attempt| (attempt.id.as_str(), attempt))
        .collect();

    let mut totals = InsightsTotals {
        sessions: sessions.len() as u64,
        attempts: attempts.len() as u64,
        words: attempts.iter().map(|attempt| attempt.word_count).sum(),
        speaking_seconds: attempts.iter().map(|attempt| attempt.duration_sec).sum(),
        errors: 0,
        warnings: 0,
        suggestions: 0,
    };

    let mut patterns: HashMap<String, Pattern> = HashMap::new();
    for correction in corrections {
        let Some(attempt) = attempt_by_id.get(correction.attempt_id.as_str()) else {
            continue;
        };
        match correction.severity.as_str() {
            "error" => totals.errors += 1,
            "warning" => totals.warnings += 1,
            _ => totals.suggestions += 1,
        }
        if correction.category == "style" {
            continue;
        }

        let key = format!(
            "{}|{}",
            correction.category,
            normalized_label(&correction.label)
        );
        let pattern = patterns.entry(key.clone()).or_insert_with(|| Pattern {
            key,
            label: correction.label.clone(),
            category: correction.category.clone(),
            severity: correction.severity.clone(),
            count: 0,
            session_ids: Vec::new(),
            occurrences: Vec::new(),
        });
        pattern.count += 1;
        if severity_rank(&correction.severity) < severity_rank(&pattern.severity) {
            pattern.severity = correction.severity.clone();
        }

        let session = session_by_id
            .get(attempt.session_id.as_str())
            .map(|session| (*session).clone());
        if let Some(session) = &session {
            if !pattern.session_ids.contains(&session.id) {
                pattern.session_ids.push(session.id.clone());
            }
        }
        pattern.occurrences.push(Occurrence {
            session,
            attempt: (*attempt).clone(),
            correction: correction.clone(),
        });
    }

    let mut patterns: Vec<Pattern> = patterns.into_values().collect();
    for pattern in &mut patterns {
        pattern
            .occurrences
            .sort_by(|a, b| b.attempt.created_at.cmp(&a.attempt.created_at));
    }
    patterns.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));

    InsightsData { totals, patterns }
}

/// Each take's 1-based position inside its session, by take id: the "Take 3"
/// an insight occurrence links to.
pub fn take_numbers(attempts: &[Attempt]) -> std::collections::BTreeMap<String, u32> {
    let mut by_session: HashMap<&str, Vec<&Attempt>> = HashMap::new();
    for attempt in attempts {
        by_session
            .entry(attempt.session_id.as_str())
            .or_default()
            .push(attempt);
    }

    let mut numbers = std::collections::BTreeMap::new();
    for takes in by_session.values_mut() {
        // Stable: takes with the same time keep their stored order.
        takes.sort_by_key(|attempt| {
            chrono::DateTime::parse_from_rfc3339(&attempt.created_at)
                .map(|time| time.timestamp_millis())
                .unwrap_or(i64::MAX)
        });
        for (position, attempt) in takes.iter().enumerate() {
            numbers.insert(
                attempt.id.clone(),
                u32::try_from(position + 1).unwrap_or(u32::MAX),
            );
        }
    }
    numbers
}
