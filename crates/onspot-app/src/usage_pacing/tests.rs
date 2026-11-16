// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::executor::block_on;
use onspot_domain::LlmEndpoint;
use onspot_ports::{CoreError, DeviceStore};

use super::*;
use crate::usage_ledger::{RefusalReport, LEDGER_STORAGE_KEY};

const NOW: u64 = 1_000_000;
const PREFERRED: &str = "openai/gpt-oss-120b";
const FALLBACK: &str = "openai/gpt-oss-20b";

/// The device store a browser would give: one map, kept in memory.
#[derive(Default)]
struct MemoryStore(Mutex<BTreeMap<String, String>>);

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl DeviceStore for MemoryStore {
    async fn read(&self, key: &str) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().expect("store").get(key).cloned())
    }

    async fn write(&self, key: &str, value: &str) -> Result<(), CoreError> {
        self.0
            .lock()
            .expect("store")
            .insert(key.to_owned(), value.to_owned());
        Ok(())
    }
}

/// Collects every event, so a test can read what a driver would hear.
#[derive(Default)]
struct Events(Mutex<Vec<UiEvent>>);

impl EventSink for Events {
    fn emit(&self, event: &UiEvent) {
        self.0.lock().expect("events").push(event.clone());
    }
}

struct Fixture {
    store: Arc<MemoryStore>,
    events: Arc<Events>,
    pacer: RequestPacer,
}

fn fixture() -> Fixture {
    let store = Arc::new(MemoryStore::default());
    let events = Arc::new(Events::default());
    let ledger = Arc::new(UsageLedger::new(store.clone(), events.clone()));
    let pacer = RequestPacer::new(ledger, events.clone());
    Fixture {
        store,
        events,
        pacer,
    }
}

fn groq() -> LlmEndpoint {
    LlmEndpoint {
        base_url: String::from("https://api.groq.com/openai/v1"),
        provider: String::from("groq"),
        model: String::from(PREFERRED),
        fallback_models: vec![String::from(FALLBACK)],
        key_id: String::from("key-1"),
    }
}

fn request<'a>(
    endpoint: &'a LlmEndpoint,
    models: &'a [String],
    prompt_chars: usize,
) -> PacingRequest<'a> {
    PacingRequest {
        endpoint,
        models,
        system_message: None,
        prompt_chars,
        max_tokens: 1_000,
        patience_ms: DEFAULT_PATIENCE_MS,
    }
}

fn both_models() -> Vec<String> {
    vec![String::from(PREFERRED), String::from(FALLBACK)]
}

/// Records a Groq refusal for one model, as the client does before learning from it.
fn refuse(
    fixture: &Fixture,
    endpoint: &LlmEndpoint,
    model: &str,
    status: u16,
    body: &str,
) -> RefusalOutcome {
    let models = vec![model.to_owned()];
    let sized = request(endpoint, &models, 340);
    let plan = block_on(fixture.pacer.plan(&sized, NOW)).expect("plan");
    let admission = fixture.pacer.admit(&plan, &sized, NOW);
    block_on(fixture.pacer.ledger().record_refusal(
        &RefusalReport {
            host: String::from("api.groq.com"),
            model: model.to_owned(),
            key_id: endpoint.key_id.clone(),
            body: body.to_owned(),
        },
        NOW,
    ));
    fixture
        .pacer
        .learn_from_refusal(&admission, status, body, NOW)
}

#[test]
fn an_unknown_limit_is_not_paced() {
    let fixture = fixture();
    let endpoint = groq();
    let models = both_models();

    let plan =
        block_on(fixture.pacer.plan(&request(&endpoint, &models, 3_400), NOW)).expect("plan");

    assert_eq!(plan.model, PREFERRED);
    assert_eq!(plan.wait_ms, 0);
    // 3,400 characters at 3.4 per token, plus the 1,000-token reply budget.
    assert_eq!(plan.tokens, 2_000);
}

#[test]
fn a_refusal_teaches_the_minute_limit_and_the_next_request_waits_for_room() {
    let fixture = fixture();
    let endpoint = groq();
    let body = "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2410. Please try again in 7.5s.";

    let outcome = refuse(&fixture, &endpoint, PREFERRED, 429, body);
    assert_eq!(outcome, RefusalOutcome::TryAgain);

    let models = vec![String::from(PREFERRED)];
    let plan =
        block_on(fixture.pacer.plan(&request(&endpoint, &models, 3_400), NOW)).expect("plan");
    // 7,000 used + 2,000 asked − 8,000 allowed = 1,000 over; 1,000/8,000 of a
    // minute is 7.5 s, plus the landing margin.
    assert_eq!(plan.wait_ms, 7_620);
}

#[test]
fn a_fallback_takes_the_request_when_the_preferred_model_would_keep_it_waiting() {
    let fixture = fixture();
    let endpoint = groq();
    let body = "on tokens per minute (TPM): Limit 8000, Used 7900";
    refuse(&fixture, &endpoint, PREFERRED, 429, body);

    let models = both_models();
    let plan =
        block_on(fixture.pacer.plan(&request(&endpoint, &models, 3_400), NOW)).expect("plan");

    assert_eq!(plan.model, FALLBACK);
    assert_eq!(plan.wait_ms, 0);
}

#[test]
fn a_model_the_key_cannot_use_is_skipped_and_none_left_is_a_readable_error() {
    let fixture = fixture();
    let endpoint = groq();
    let outcome = refuse(&fixture, &endpoint, PREFERRED, 404, "model not found");
    assert_eq!(outcome, RefusalOutcome::TryAgain);

    let models = both_models();
    let plan = block_on(fixture.pacer.plan(&request(&endpoint, &models, 340), NOW)).expect("plan");
    assert_eq!(plan.model, FALLBACK);

    let only_preferred = vec![String::from(PREFERRED)];
    let error = block_on(
        fixture
            .pacer
            .plan(&request(&endpoint, &only_preferred, 340), NOW),
    )
    .expect_err("no model left");
    assert_eq!(error.code, "llm.rate_limited");
    assert_eq!(
        error.message,
        "GPT-OSS 120B is not available on this Groq key. Choose another model in Settings."
    );
}

#[test]
fn a_spent_daily_allowance_skips_the_model_until_it_resets() {
    let fixture = fixture();
    let endpoint = groq();
    let body = "on tokens per day (TPD): Limit 200000, Used 199052, Requested 2410. Please try again in 1h12m.";
    refuse(&fixture, &endpoint, PREFERRED, 429, body);

    let only_preferred = vec![String::from(PREFERRED)];
    let error = block_on(
        fixture
            .pacer
            .plan(&request(&endpoint, &only_preferred, 340), NOW),
    )
    .expect_err("used up");
    assert!(
        error.message.starts_with(
            "Groq's limits for GPT-OSS 120B are used up for now; they reset in 1 h 12 min."
        ),
        "{}",
        error.message
    );
}

#[test]
fn a_server_error_is_retried_and_a_bad_request_is_not() {
    let fixture = fixture();
    let endpoint = groq();
    assert_eq!(
        refuse(&fixture, &endpoint, PREFERRED, 503, ""),
        RefusalOutcome::TryAgain
    );
    assert_eq!(
        refuse(&fixture, &endpoint, FALLBACK, 400, "bad"),
        RefusalOutcome::GiveUp
    );
}

#[test]
fn headers_set_the_minute_allowance_after_a_completed_request() {
    let fixture = fixture();
    let endpoint = groq();
    let models = vec![String::from(PREFERRED)];
    let sized = request(&endpoint, &models, 3_400);

    let plan = block_on(fixture.pacer.plan(&sized, NOW)).expect("plan");
    let admission = fixture.pacer.admit(&plan, &sized, NOW);
    let headers = BTreeMap::from([
        (
            String::from("x-ratelimit-limit-tokens"),
            String::from("8000"),
        ),
        (
            String::from("x-ratelimit-remaining-tokens"),
            String::from("1000"),
        ),
    ]);
    let usage = CompletedUsage {
        prompt_tokens: 1_000,
        total_tokens: 1_500,
        cached_tokens: 0,
    };
    fixture.pacer.settle(&admission, &usage, &headers, NOW);

    let next = block_on(fixture.pacer.plan(&sized, NOW)).expect("plan");
    // The headers say 7,000 of 8,000 are spent. The learnt ratio (3,400
    // characters / 1,000 prompt tokens) sizes the next request at 2,000
    // tokens, 1,000 over: 7.5 s of refill plus the landing margin.
    assert_eq!(next.wait_ms, 7_620);
}

#[test]
fn only_waits_long_enough_to_notice_are_announced() {
    let fixture = fixture();
    let endpoint = groq();

    let short = fixture.pacer.begin_wait(&endpoint, PREFERRED, 500, NOW);
    fixture.pacer.end_wait(short);
    assert!(fixture.events.0.lock().expect("events").is_empty());

    let long = fixture.pacer.begin_wait(&endpoint, PREFERRED, 4_000, NOW);
    fixture.pacer.end_wait(long);
    let events = fixture.events.0.lock().expect("events").clone();
    assert_eq!(
        events,
        vec![
            UiEvent::PacingWaitChanged {
                wait: Some(PacingWait {
                    provider: String::from("Groq"),
                    model: String::from(PREFERRED),
                    until: NOW + 4_000,
                }),
            },
            UiEvent::PacingWaitChanged { wait: None },
        ]
    );
}

#[test]
fn the_ledger_keeps_what_it_learnt_on_the_device() {
    let fixture = fixture();
    let endpoint = groq();
    refuse(
        &fixture,
        &endpoint,
        PREFERRED,
        429,
        "on tokens per minute (TPM): Limit 8000, Used 10",
    );

    let stored = fixture
        .store
        .0
        .lock()
        .expect("store")
        .get(LEDGER_STORAGE_KEY)
        .cloned();
    let ledger: LedgerState = serde_json::from_str(&stored.expect("saved")).expect("ledger json");
    let scope = scope_of(&endpoint, PREFERRED);
    let reading = &ledger.reported[&scope_key(&scope)][&LimitWindow::TPM];
    assert_eq!(reading.limit, 8_000);
    assert_eq!(reading.used, Some(10));
}
