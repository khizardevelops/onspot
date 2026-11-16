// SPDX-License-Identifier: AGPL-3.0-or-later

//! The prompt-submission outbox: which waiting prompts to send, in what order,
//! and how a failed batch backs off.
//!
//! Ported from `src/lib/practice/promptSubmissions.ts`. The rows live in the
//! SQLite `prompt_submissions` table behind the `RecordsStore` port; this module
//! owns the batch policy, the JSON wire shape, the retry backoff and the outcome
//! of one send. The driver still decides whether to share (consent, connection,
//! endpoint) and supplies the HTTP transport.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use onspot_domain::PromptSubmission;
use onspot_ports::{CancelToken, Clock, CoreError, HttpClient, HttpRequest, RecordsStore};

/// Prompts per request: small enough for a phone waking up, large enough to
/// drain quickly.
pub const BATCH_SIZE: usize = 20;
/// Backoff after a failed send, doubling from 30 s to at most an hour.
pub const RETRY_BASE_MS: u64 = 30_000;
pub const RETRY_MAX_MS: u64 = 60 * 60_000;
const RETRY_MAX_DOUBLINGS: u32 = 10;
const MAX_ERROR_CHARS: usize = 500;
const MAX_RESPONSE_DETAIL_CHARS: usize = 300;

/// What one flush did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SubmissionFlushResult {
    /// Prompts accepted and removed from the outbox.
    pub sent: usize,
    /// Prompts still waiting after the attempt.
    pub pending: usize,
    /// The failure that kept this batch waiting, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Whether a submission may be attempted now.
///
/// New rows are always due. After a failure the wait doubles from 30 s with
/// each attempt, capped at an hour; a missing or unreadable timestamp counts as
/// due rather than blocking the queue forever.
pub fn is_due(submission: &PromptSubmission, now_ms: u64) -> bool {
    if submission.attempts <= 0 {
        return true;
    }
    let Some(last) = submission.last_attempt_at.as_deref() else {
        return true;
    };
    let Some(last_ms) = parse_rfc3339_ms(last) else {
        return true;
    };
    let doublings = (submission.attempts as u32 - 1).min(RETRY_MAX_DOUBLINGS);
    let wait = RETRY_BASE_MS
        .saturating_mul(1u64 << doublings)
        .min(RETRY_MAX_MS);
    now_ms.saturating_sub(last_ms) >= wait
}

/// The oldest waiting prompts that may be sent now, at most [`BATCH_SIZE`].
pub fn due_batch(pending: &[PromptSubmission], now_ms: u64, force: bool) -> Vec<PromptSubmission> {
    let mut rows: Vec<&PromptSubmission> = pending
        .iter()
        .filter(|submission| force || is_due(submission, now_ms))
        .collect();
    rows.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    rows.into_iter().take(BATCH_SIZE).cloned().collect()
}

/// One prompt in the shared database's wire shape.
pub fn wire_format(submission: &PromptSubmission) -> Value {
    json!({
        "id": submission.id,
        "title": submission.title,
        "text": submission.text,
        "instructionLanguage": submission.instruction_language,
        "targetLanguage": submission.target_language,
        "level": submission.level,
        "mode": submission.mode,
        "createdAt": submission.created_at,
    })
}

/// The request body the shared database accepts.
pub fn wire_body(batch: &[PromptSubmission]) -> Value {
    json!({
        "consent": true,
        "prompts": batch.iter().map(wire_format).collect::<Vec<_>>(),
    })
}

fn parse_rfc3339_ms(value: &str) -> Option<u64> {
    let timestamp =
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()?;
    u64::try_from(timestamp.unix_timestamp_nanos() / 1_000_000).ok()
}

/// Where the outbox drains to, and when a send counts as failed.
#[derive(Debug, Clone)]
pub struct FlushRequest<'a> {
    pub endpoint: &'a str,
    /// Retry even a batch still inside its backoff (the device came online).
    pub force: bool,
    /// Whether the device currently has a connection. Offline attempts do not
    /// charge an attempt, so reconnecting retries immediately.
    pub online: bool,
}

/// Sends one batch to `request.endpoint` and applies the outcome to the outbox.
///
/// A 2xx deletes the batch: the server stores every valid prompt and treats
/// content it already had as accepted. Any other outcome is recorded only while
/// online, so an offline device keeps its attempts.
pub async fn flush(
    records: &dyn RecordsStore,
    http: &dyn HttpClient,
    clock: &dyn Clock,
    request: &FlushRequest<'_>,
) -> Result<SubmissionFlushResult, CoreError> {
    if request.endpoint.trim().is_empty() || !request.online {
        return pending_count(records).await;
    }

    let pending = records.list_prompt_submissions().await.map_err(store)?;
    let batch = due_batch(&pending, clock.now_ms(), request.force);
    if batch.is_empty() {
        return Ok(SubmissionFlushResult {
            sent: 0,
            pending: pending.len(),
            error: None,
        });
    }

    let mut headers = BTreeMap::new();
    headers.insert(
        String::from("Content-Type"),
        String::from("application/json"),
    );
    let http_request = HttpRequest {
        method: String::from("POST"),
        url: request.endpoint.to_owned(),
        headers,
        body: wire_body(&batch).to_string(),
        provider: None,
    };

    let message = match http.send(&http_request, &CancelToken::new()).await {
        Ok(response) if (200..300).contains(&response.status) => {
            for submission in &batch {
                records
                    .delete_prompt_submission(&submission.id)
                    .await
                    .map_err(store)?;
            }
            return Ok(SubmissionFlushResult {
                sent: batch.len(),
                pending: records
                    .list_prompt_submissions()
                    .await
                    .map_err(store)?
                    .len(),
                error: None,
            });
        }
        Ok(response) => {
            let detail = response.body.trim();
            if detail.is_empty() {
                format!("HTTP {}", response.status)
            } else {
                format!(
                    "HTTP {}: {}",
                    response.status,
                    truncate_chars(detail, MAX_RESPONSE_DETAIL_CHARS)
                )
            }
        }
        Err(error) => error.message,
    };

    let message = truncate_chars(&message, MAX_ERROR_CHARS);
    let now = now_rfc3339(clock.now_ms());
    for submission in &batch {
        records
            .mark_prompt_submission_failed(&submission.id, &message, &now)
            .await
            .map_err(store)?;
    }
    Ok(SubmissionFlushResult {
        sent: 0,
        pending: records
            .list_prompt_submissions()
            .await
            .map_err(store)?
            .len(),
        error: Some(message),
    })
}

async fn pending_count(records: &dyn RecordsStore) -> Result<SubmissionFlushResult, CoreError> {
    Ok(SubmissionFlushResult {
        sent: 0,
        pending: records
            .list_prompt_submissions()
            .await
            .map_err(store)?
            .len(),
        error: None,
    })
}

fn store(error: onspot_ports::StoreError) -> CoreError {
    CoreError::new("storage.failed", error.to_string())
}

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// `clock.now_ms()` as the RFC 3339 text the database stores.
fn now_rfc3339(now_ms: u64) -> String {
    let seconds = i64::try_from(now_ms / 1_000).unwrap_or(i64::MAX);
    let nanos = i32::try_from((now_ms % 1_000) * 1_000_000).unwrap_or(0);
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .and_then(|time| time.replace_nanosecond(nanos as u32))
        .map(|time| {
            time.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submission(id: &str, created_at: &str) -> PromptSubmission {
        PromptSubmission {
            id: id.to_owned(),
            title: String::from("Title"),
            text: String::from("Task"),
            instruction_language: String::from("en"),
            target_language: String::from("fr"),
            level: String::from("b1"),
            mode: String::from("exam"),
            created_at: created_at.to_owned(),
            attempts: 0,
            last_attempt_at: None,
            last_error: None,
        }
    }

    #[test]
    fn new_rows_are_due_and_batches_are_oldest_first_capped() {
        let rows = vec![
            submission("b", "2026-01-02T00:00:00.000Z"),
            submission("a", "2026-01-01T00:00:00.000Z"),
        ];
        assert!(is_due(&rows[0], 0));
        let batch = due_batch(&rows, 0, false);
        assert_eq!(batch[0].id, "a");
        assert_eq!(batch[1].id, "b");

        let many: Vec<PromptSubmission> = (0..30)
            .map(|index| submission(&format!("p{index:02}"), "2026-01-01T00:00:00.000Z"))
            .collect();
        assert_eq!(due_batch(&many, 0, false).len(), BATCH_SIZE);
        assert_eq!(due_batch(&many, 0, true).len(), BATCH_SIZE);
    }

    #[test]
    fn failures_back_off_from_thirty_seconds_to_an_hour() {
        let now = parse_rfc3339_ms("2026-01-02T00:00:00.000Z").expect("now");
        let mut row = submission("a", "2026-01-01T00:00:00.000Z");
        row.attempts = 1;
        row.last_attempt_at = Some(String::from("2026-01-01T23:59:00.000Z"));
        assert!(is_due(&row, now));
        assert!(!is_due(&row, now - 40_000));

        row.attempts = 2;
        row.last_attempt_at = Some(String::from("2026-01-01T23:59:30.000Z"));
        assert!(!is_due(&row, now));
        assert!(is_due(&row, now + 31_000));

        row.attempts = 30;
        row.last_attempt_at = Some(String::from("2026-01-01T23:30:00.000Z"));
        assert!(!is_due(&row, now), "the cap holds the wait at an hour");
        assert!(is_due(&row, now + RETRY_MAX_MS), "an hour later is due");

        row.attempts = 1;
        row.last_attempt_at = Some(String::from("not a time"));
        assert!(
            is_due(&row, now),
            "an unreadable timestamp does not block the queue"
        );
    }

    #[test]
    fn the_wire_body_has_consent_and_only_submission_fields() {
        let body = wire_body(&[submission("a", "2026-01-01T00:00:00.000Z")]);
        assert_eq!(body["consent"], true);
        assert_eq!(body["prompts"][0]["id"], "a");
        assert_eq!(body["prompts"][0]["targetLanguage"], "fr");
        assert!(body["prompts"][0].get("attempts").is_none());
        assert!(body["prompts"][0].get("lastError").is_none());
    }
}
