// SPDX-License-Identifier: AGPL-3.0-or-later

//! The evaluator over a fake transport: parsing, pacing, the usage ledger,
//! per-caller request options and error copy.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::executor::block_on;
use onspot_adapter_llm_openai::client::OpenAiEvaluator;
use onspot_app::{EventSink, RequestPacer, UiEvent, UsageLedger};
use onspot_domain::{EvaluationRequest, LlmEndpoint};
use onspot_ports::{
    CancelToken, Clock, CoreError, DeviceStore, HttpClient, HttpRequest, HttpResponse, LlmProvider,
};

struct FakeHttp {
    responses: Mutex<Vec<HttpResponse>>,
    requests: Mutex<Vec<HttpRequest>>,
}

#[async_trait]
impl HttpClient for FakeHttp {
    async fn send(
        &self,
        request: &HttpRequest,
        _token: &CancelToken,
    ) -> Result<HttpResponse, CoreError> {
        self.requests
            .lock()
            .expect("requests")
            .push(request.clone());
        Ok(self.responses.lock().expect("responses").remove(0))
    }
}

/// A clock that moves only when the client waits: pacing waits are instant,
/// but time still passes for the token buckets to refill.
#[derive(Default)]
struct FakeClock(AtomicU64);

#[async_trait]
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }

    async fn sleep(&self, milliseconds: u64, _token: &CancelToken) -> bool {
        self.0.fetch_add(milliseconds, Ordering::SeqCst);
        true
    }
}

#[derive(Default)]
struct MemoryStore(Mutex<BTreeMap<String, String>>);

#[async_trait]
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

struct NoEvents;

impl EventSink for NoEvents {
    fn emit(&self, _event: &UiEvent) {}
}

/// An evaluator over canned responses, with the pacing and ledger a driver shares.
fn evaluator_with(
    responses: Vec<HttpResponse>,
) -> (OpenAiEvaluator, Arc<FakeHttp>, Arc<RequestPacer>) {
    let http = Arc::new(FakeHttp {
        responses: Mutex::new(responses),
        requests: Mutex::new(Vec::new()),
    });
    let events: Arc<dyn EventSink> = Arc::new(NoEvents);
    let ledger = Arc::new(UsageLedger::new(
        Arc::new(MemoryStore::default()),
        events.clone(),
    ));
    let pacer = Arc::new(RequestPacer::new(ledger, events));
    let evaluator =
        OpenAiEvaluator::new(http.clone(), Arc::new(FakeClock::default()), pacer.clone());
    (evaluator, http, pacer)
}

fn ok(body: String) -> HttpResponse {
    HttpResponse {
        status: 200,
        headers: Default::default(),
        body,
    }
}

fn sent_body(http: &FakeHttp, index: usize) -> serde_json::Value {
    let requests = http.requests.lock().expect("requests");
    serde_json::from_str(&requests[index].body).expect("request body")
}

fn endpoint() -> LlmEndpoint {
    LlmEndpoint {
        base_url: String::from("http://localhost:4330/v1"),
        provider: String::from("custom"),
        model: String::from("stub"),
        fallback_models: Vec::new(),
        key_id: String::from("key-1"),
    }
}

fn request() -> EvaluationRequest {
    EvaluationRequest {
        transcript: String::from("bonjour"),
        prompt: String::from("Parlez."),
        mode: String::from("exam"),
        level: String::from("B1"),
        language: String::from("French"),
        translation_target: String::from("English"),
        endpoint: endpoint(),
    }
}

fn chat_body(content: &str) -> String {
    serde_json::json!({
        "choices": [{ "message": { "content": content }, "finish_reason": "stop" }]
    })
    .to_string()
}

#[test]
fn a_valid_reply_is_parsed_and_normalized() {
    let raw = serde_json::json!({
        "correctedText": "Bonjour.",
        "spokenLanguage": "French",
        "explanation": { "note": "Bien.", "mistakes": [] },
        "followUp": { "question": "Ça va ?", "translation": "How are you?" },
        "corrections": [],
        "vocabulary": [],
        "connectors": []
    })
    .to_string();
    let (evaluator, _, _) = evaluator_with(vec![ok(chat_body(&raw))]);
    let result = block_on(evaluator.evaluate(&request(), &CancelToken::new())).expect("evaluation");
    assert_eq!(result.corrected_text, "Bonjour.");
    assert_eq!(result.explanation, "Bien.");
    assert_eq!(result.follow_up.expect("follow-up").question, "Ça va ?");
}

#[test]
fn a_401_names_the_key_without_echoing_it() {
    let (evaluator, _, _) = evaluator_with(vec![HttpResponse {
        status: 401,
        headers: Default::default(),
        body: String::from(r#"{"error":{"message":"invalid key"}}"#),
    }]);
    let error =
        block_on(evaluator.evaluate(&request(), &CancelToken::new())).expect_err("rejected");
    assert!(error.message.contains("rejected the API key"));
    assert!(!error.message.contains("secret-key"));
}

#[test]
fn test_connection_returns_the_model_reply() {
    let (evaluator, http, _) = evaluator_with(vec![ok(chat_body("OK"))]);
    let reply =
        block_on(evaluator.test_connection(&endpoint(), &CancelToken::new())).expect("connection");
    assert_eq!(reply, "OK");

    // The frozen connection-check prompt, at temperature 0, with a short deadline.
    let body = sent_body(&http, 0);
    assert_eq!(
        body["messages"][0]["content"],
        "You are a connection check. Reply with the single word OK and nothing else."
    );
    assert_eq!(body["messages"][1]["content"], "Connection test");
    assert_eq!(body["temperature"], 0.0);
    assert_eq!(body["max_tokens"], 16);
    assert_eq!(
        http.requests.lock().expect("requests")[0].timeout_ms,
        Some(20_000)
    );
}

#[test]
fn translations_ask_for_json_at_their_own_temperature_and_a_budget_sized_to_the_text() {
    let reply = serde_json::json!({
        "idiomatic": "Hello.",
        "literal": "Good day.",
        "wordForWord": "Good-day.",
        "wordBreakdown": []
    })
    .to_string();
    let (evaluator, http, _) = evaluator_with(vec![ok(chat_body(&reply))]);

    block_on(evaluator.translate(
        "Bonjour.",
        &endpoint(),
        "French",
        "English",
        &CancelToken::new(),
    ))
    .expect("translation");

    let body = sent_body(&http, 0);
    assert_eq!(body["response_format"]["type"], "json_object");
    let temperature = body["temperature"].as_f64().expect("temperature");
    assert!((temperature - 0.1).abs() < 1e-6, "{temperature}");
    // One word: the 1,024-token floor, not the 3,072 ceiling.
    assert_eq!(body["max_tokens"], 1_024);
}

#[test]
fn every_completed_call_is_counted_in_the_usage_ledger() {
    let reply = serde_json::json!({
        "choices": [{ "message": { "content": "OK" } }],
        "usage": { "prompt_tokens": 40, "total_tokens": 42 }
    })
    .to_string();
    let (evaluator, _, pacer) = evaluator_with(vec![ok(reply)]);

    block_on(evaluator.test_connection(&endpoint(), &CancelToken::new())).expect("connection");

    let ledger = block_on(pacer.ledger().snapshot(0));
    assert_eq!(ledger.calls.len(), 1);
    let call = &ledger.calls[0];
    assert_eq!(
        (
            call.host.as_str(),
            call.model.as_str(),
            call.key_id.as_str()
        ),
        ("localhost:4330", "stub", "key-1")
    );
    assert_eq!(call.tokens, 42);
    assert_eq!(call.reserved_tokens, 40 + 16);
}

#[test]
fn a_refusal_is_learnt_from_recorded_and_retried() {
    let refusal = HttpResponse {
        status: 429,
        headers: Default::default(),
        body: String::from(
            r#"{"error":{"message":"Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7990, Requested 300. Please try again in 1.2s."}}"#,
        ),
    };
    let (evaluator, http, pacer) = evaluator_with(vec![refusal, ok(chat_body("OK"))]);

    let reply =
        block_on(evaluator.test_connection(&endpoint(), &CancelToken::new())).expect("retried");

    assert_eq!(reply, "OK");
    assert_eq!(http.requests.lock().expect("requests").len(), 2);
    let ledger = block_on(pacer.ledger().snapshot(0));
    assert_eq!(ledger.reported.len(), 1, "the stated minute limit is kept");
    assert_eq!(ledger.calls.len(), 1);
}

#[test]
fn a_long_take_is_checked_in_parts_and_joined() {
    let sentence = "Je parle de ma journée avec des amis au parc. ";
    let transcript = sentence.repeat(40); // 400 words: two parts of 260 at most.
    let part = |corrected: &str| {
        chat_body(
            &serde_json::json!({
                "correctedText": corrected,
                "spokenLanguage": "French",
                "explanation": { "note": "", "mistakes": [] },
                "corrections": [],
                "vocabulary": [],
                "connectors": []
            })
            .to_string(),
        )
    };
    let (evaluator, http, _) = evaluator_with(vec![ok(part("Première.")), ok(part("Seconde."))]);
    let mut long_take = request();
    long_take.transcript = transcript;

    let result = block_on(evaluator.evaluate(&long_take, &CancelToken::new())).expect("evaluation");

    assert_eq!(http.requests.lock().expect("requests").len(), 2);
    assert_eq!(result.corrected_text, "Première. Seconde.");
}
