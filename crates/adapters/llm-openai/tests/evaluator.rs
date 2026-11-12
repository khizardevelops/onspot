// SPDX-License-Identifier: AGPL-3.0-or-later

//! The evaluator over a fake transport: parsing, retries and error copy.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use onspot_adapter_llm_openai::client::OpenAiEvaluator;
use onspot_domain::{EvaluationRequest, LlmEndpoint};
use onspot_ports::{
    CancelToken, Clock, CoreError, HttpClient, HttpRequest, HttpResponse, LlmProvider,
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

struct FakeClock;

#[async_trait]
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        0
    }

    async fn sleep(&self, _milliseconds: u64, _token: &CancelToken) -> bool {
        true
    }
}

fn endpoint() -> LlmEndpoint {
    LlmEndpoint {
        base_url: String::from("http://localhost:4330/v1"),
        provider: String::from("custom"),
        model: String::from("stub"),
        fallback_models: Vec::new(),
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
    let http = Arc::new(FakeHttp {
        responses: Mutex::new(vec![HttpResponse {
            status: 200,
            headers: Default::default(),
            body: chat_body(&raw),
        }]),
        requests: Mutex::new(Vec::new()),
    });
    let evaluator = OpenAiEvaluator::new(http, Arc::new(FakeClock));
    let result = futures::executor::block_on(evaluator.evaluate(&request(), &CancelToken::new()))
        .expect("evaluation");
    assert_eq!(result.corrected_text, "Bonjour.");
    assert_eq!(result.explanation, "Bien.");
    assert_eq!(result.follow_up.expect("follow-up").question, "Ça va ?");
}

#[test]
fn a_401_names_the_key_without_echoing_it() {
    let http = Arc::new(FakeHttp {
        responses: Mutex::new(vec![HttpResponse {
            status: 401,
            headers: Default::default(),
            body: String::from(r#"{"error":{"message":"invalid key"}}"#),
        }]),
        requests: Mutex::new(Vec::new()),
    });
    let evaluator = OpenAiEvaluator::new(http, Arc::new(FakeClock));
    let error = futures::executor::block_on(evaluator.evaluate(&request(), &CancelToken::new()))
        .expect_err("rejected");
    assert!(error.message.contains("rejected the API key"));
    assert!(!error.message.contains("secret-key"));
}

#[test]
fn test_connection_returns_the_model_reply() {
    let http = Arc::new(FakeHttp {
        responses: Mutex::new(vec![HttpResponse {
            status: 200,
            headers: Default::default(),
            body: chat_body("OK"),
        }]),
        requests: Mutex::new(Vec::new()),
    });
    let evaluator = OpenAiEvaluator::new(http, Arc::new(FakeClock));
    let reply =
        futures::executor::block_on(evaluator.test_connection(&endpoint(), &CancelToken::new()))
            .expect("connection");
    assert_eq!(reply, "OK");
}
