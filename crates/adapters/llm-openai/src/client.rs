// SPDX-License-Identifier: AGPL-3.0-or-later

//! The OpenAI-compatible chat client over the `HttpClient` port.
//!
//! Groq, DeepSeek and most self-hosted gateways implement this shape, so one
//! client covers them all. Every request goes through the core's rate-limit
//! pacing: it waits for room under the model's per-minute allowance, or goes
//! to the next of the endpoint's fallback models, and a refusal is learnt from
//! and retried. Every call and refusal is recorded in the device's usage
//! ledger. Other provider errors are surfaced with the provider's message so a
//! 401 (bad key) is actionable. A JSON reply the provider rejected over a known
//! slip is repaired and used; otherwise it is asked for once more.

use std::collections::BTreeMap;
use std::sync::Arc;

use onspot_app::providers::{is_chat_model, model_label, url_host};
use onspot_app::{
    CallReport, CompletedUsage, PacingRequest, RefusalOutcome, RefusalReport, RequestPacer,
    DEFAULT_PATIENCE_MS,
};
use onspot_domain::{EvaluationRequest, EvaluationResult, LlmEndpoint};
use onspot_ports::{
    CancelToken, Clock, CoreError, GeneratedPrompt, HttpClient, HttpRequest, LlmProvider,
    PromptTopicRequest,
};
use serde_json::{json, Value};

use crate::json_repair::repair_json;
use crate::parse::strip_thinking;
use crate::prompt::ChatMessage;
use crate::prompt_topic::{
    build_prompt_messages, parse_prompt_topic, validate_prompt_topic, PROMPT_TOPIC_TOKENS,
};

/// Provider error bodies are shown to the learner, so give them room. A
/// 300-character cut once truncated the actionable part of Groq's messages.
const MAX_ERROR_CHARS: usize = 2_000;

/// Retries for a reply rejected as invalid JSON that cannot be repaired: the
/// model rarely repeats the slip.
const INVALID_JSON_RETRIES: usize = 1;

/// Refusals one request may meet before it fails: each sends it to another
/// model, or waits, and teaches the pacing a limit, so a few are enough.
/// Waiting for room is not a refusal and does not count.
const MAX_REFUSALS: usize = 6;

/// Long enough for a reasoning model's full evaluation, short enough to
/// surface a stall.
pub const DEFAULT_LLM_TIMEOUT_MS: u64 = 120_000;

/// The connection test and the model list answer fast or not at all.
const QUICK_REQUEST_TIMEOUT_MS: u64 = 20_000;

/// How one chat completion is asked for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompletionOptions {
    pub temperature: f32,
    pub max_tokens: u32,
    /// Ask providers that support it for a JSON object reply.
    pub json: bool,
    /// How long to wait for the endpoint's own model before a fallback model
    /// takes the request: longer where the best model's quality matters most.
    pub patience_ms: u64,
    /// Give up after this long, so a stalled provider cannot leave the
    /// learner waiting forever.
    pub timeout_ms: u64,
}

impl Default for CompletionOptions {
    fn default() -> Self {
        Self {
            temperature: 0.2,
            max_tokens: 2_048,
            json: false,
            patience_ms: DEFAULT_PATIENCE_MS,
            timeout_ms: DEFAULT_LLM_TIMEOUT_MS,
        }
    }
}

/// The production LLM adapter: prompts and parsing are local; transport and
/// the API key belong to the driver's `HttpClient`; pacing and the usage
/// ledger are the core's, shared by every request of the run.
pub struct OpenAiEvaluator {
    http: Arc<dyn HttpClient>,
    clock: Arc<dyn Clock>,
    pacer: Arc<RequestPacer>,
}

impl OpenAiEvaluator {
    /// Creates the adapter over a transport, a clock and the run's pacing.
    pub fn new(http: Arc<dyn HttpClient>, clock: Arc<dyn Clock>, pacer: Arc<RequestPacer>) -> Self {
        Self { http, clock, pacer }
    }

    /// Sends one chat completion through the pacing and returns the model's text.
    pub async fn chat_completion(
        &self,
        endpoint: &LlmEndpoint,
        messages: &[ChatMessage],
        options: CompletionOptions,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        let base = endpoint.base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return Err(CoreError::new(
                "llm.no_endpoint",
                "No LLM base URL configured.",
            ));
        }
        if endpoint.model.trim().is_empty() {
            return Err(CoreError::new(
                "llm.no_model",
                "No LLM model selected. Choose one in Settings.",
            ));
        }

        let url = format!("{base}/chat/completions");
        let host = url_host(base).to_owned();
        let models = models_in_order(endpoint);
        let paced = PacingRequest {
            endpoint,
            models: &models,
            system_message: messages
                .iter()
                .find(|message| message.role == "system")
                .map(|message| message.content.as_str()),
            prompt_chars: messages
                .iter()
                .map(|message| onspot_app::usage_pacing::utf16_length(&message.content))
                .sum(),
            max_tokens: u64::from(options.max_tokens),
            patience_ms: options.patience_ms,
        };

        let mut invalid_json_replies = 0;
        let mut refusals = 0;
        loop {
            if token.is_cancelled() {
                return Err(token.error());
            }

            let plan = self.pacer.plan(&paced, self.clock.now_ms()).await?;
            if plan.wait_ms > 0 {
                self.wait_for_room(endpoint, &plan.model, plan.wait_ms, token)
                    .await?;
                // Planned again after the wait: other requests may have taken the room meanwhile.
                continue;
            }

            let admission = self.pacer.admit(&plan, &paced, self.clock.now_ms());
            let request = HttpRequest {
                method: String::from("POST"),
                url: url.clone(),
                headers: BTreeMap::from([(
                    String::from("Content-Type"),
                    String::from("application/json"),
                )]),
                body: request_body(&plan.model, messages, options).to_string(),
                provider: Some(endpoint.provider.clone()),
                timeout_ms: Some(options.timeout_ms),
            };
            let response = match self.http.send(&request, token).await {
                Ok(response) => response,
                Err(error) => {
                    // A request that never reached the provider gives its charge back.
                    self.pacer.release(&admission, self.clock.now_ms());
                    return Err(error);
                }
            };

            if !is_success(response.status) {
                let now = self.clock.now_ms();
                let refusal = RefusalReport {
                    host: host.clone(),
                    model: plan.model.clone(),
                    key_id: endpoint.key_id.clone(),
                    body: response.body.clone(),
                };
                self.pacer.ledger().record_refusal(&refusal, now).await;

                let rejected = if options.json {
                    rejected_json_reply(&response.body)
                } else {
                    None
                };
                if let Some(rejected) = rejected {
                    // The reply was written (and counted) even though the provider refused it.
                    self.pacer.settle(
                        &admission,
                        &CompletedUsage::default(),
                        &response.headers,
                        now,
                    );
                    if let Some(repaired) = repair_json(&rejected) {
                        return Ok(repaired);
                    }
                    if invalid_json_replies < INVALID_JSON_RETRIES {
                        invalid_json_replies += 1;
                        continue;
                    }
                    return Err(CoreError::new(
                        "llm.invalid_json",
                        format!(
                            "{}'s reply wasn't valid JSON. Please try again.",
                            model_label(&plan.model)
                        ),
                    ));
                }

                let outcome =
                    self.pacer
                        .learn_from_refusal(&admission, response.status, &response.body, now);
                if outcome == RefusalOutcome::TryAgain {
                    refusals += 1;
                    if refusals < MAX_REFUSALS {
                        continue;
                    }
                }
                return Err(CoreError::new(
                    "llm.request_failed",
                    failure_message(&plan.model, response.status, &response.body),
                ));
            }

            let now = self.clock.now_ms();
            // A misconfigured custom base URL can answer 200 with an HTML page.
            let Ok(data) = serde_json::from_str::<Value>(&response.body) else {
                self.pacer.release(&admission, now);
                return Err(CoreError::new(
                    "llm.invalid_response",
                    format!("{host} did not return a chat-completions response. Check the provider URL."),
                ));
            };
            let usage = completed_usage(&data);
            self.pacer
                .settle(&admission, &usage, &response.headers, now);
            let report = CallReport {
                host: host.clone(),
                model: plan.model.clone(),
                key_id: endpoint.key_id.clone(),
                tokens: usage.total_tokens,
                reserved_tokens: reserved_tokens(&usage, options),
                headers: response.headers.clone(),
                ..CallReport::default()
            };
            self.pacer.ledger().record_call(&report, now).await;
            return Ok(reply_text(&data));
        }
    }

    /// Lists the chat models a key can use, via the OpenAI-compatible
    /// `GET /models`, so Settings can offer models added since this build.
    pub async fn list_models(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<Vec<String>, CoreError> {
        let base = endpoint.base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return Err(CoreError::new(
                "llm.no_endpoint",
                "No LLM base URL configured.",
            ));
        }

        let request = HttpRequest {
            method: String::from("GET"),
            url: format!("{base}/models"),
            headers: BTreeMap::new(),
            body: String::new(),
            provider: Some(endpoint.provider.clone()),
            timeout_ms: Some(QUICK_REQUEST_TIMEOUT_MS),
        };
        let response = self.http.send(&request, token).await?;
        if !is_success(response.status) {
            let detail: String = response.body.chars().take(MAX_ERROR_CHARS).collect();
            let said = if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            };
            return Err(CoreError::new(
                "llm.list_models_failed",
                format!("Could not list models (HTTP {}){said}", response.status),
            ));
        }

        let data: Value = serde_json::from_str(&response.body).unwrap_or(Value::Null);
        let entries = data.get("data").unwrap_or(&data);
        let ids = entries
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.as_str().or_else(|| entry.get("id")?.as_str()))
                    .filter(|id| !id.is_empty() && is_chat_model(id))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    /// Waits before sending a request, visibly when it is long enough to
    /// notice, and stops waiting if the request is cancelled.
    async fn wait_for_room(
        &self,
        endpoint: &LlmEndpoint,
        model: &str,
        wait_ms: u64,
        token: &CancelToken,
    ) -> Result<(), CoreError> {
        let ticket = self
            .pacer
            .begin_wait(endpoint, model, wait_ms, self.clock.now_ms());
        let waited = self.clock.sleep(wait_ms, token).await;
        self.pacer.end_wait(ticket);

        if waited {
            Ok(())
        } else {
            Err(token.error())
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl LlmProvider for OpenAiEvaluator {
    async fn evaluate(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        OpenAiEvaluator::evaluate(self, request, token).await
    }

    async fn write_prompt(
        &self,
        request: &PromptTopicRequest,
        token: &CancelToken,
    ) -> Result<GeneratedPrompt, CoreError> {
        /// A new topic each time matters more than the likeliest one.
        const PROMPT_TOPIC_TEMPERATURE: f32 = 0.9;

        let messages = build_prompt_messages(request);
        let options = CompletionOptions {
            json: true,
            temperature: PROMPT_TOPIC_TEMPERATURE,
            max_tokens: PROMPT_TOPIC_TOKENS,
            ..CompletionOptions::default()
        };
        let raw = self
            .chat_completion(&request.endpoint, &messages, options, token)
            .await?;
        let generated = parse_prompt_topic(&raw)
            .and_then(|prompt| {
                validate_prompt_topic(&prompt, request)?;
                Ok(prompt)
            })
            .map_err(|message| CoreError::new("llm.invalid_prompt", message))?;
        Ok(GeneratedPrompt {
            title: generated.title,
            text: generated.text,
        })
    }

    async fn translate(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<onspot_domain::TranslationSet, CoreError> {
        OpenAiEvaluator::translate(self, text, endpoint, language, translation_target, token).await
    }

    async fn gloss(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        with_pos: bool,
        token: &CancelToken,
    ) -> Result<onspot_domain::TextGlosses, CoreError> {
        OpenAiEvaluator::gloss(
            self,
            text,
            endpoint,
            language,
            translation_target,
            with_pos,
            token,
        )
        .await
    }

    async fn phrase(
        &self,
        phrase: &str,
        context: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        OpenAiEvaluator::phrase(
            self,
            phrase,
            context,
            endpoint,
            language,
            translation_target,
            token,
        )
        .await
    }

    /// Verifies that the endpoint, optional key and model work together by
    /// sending a one-token chat completion, the exact path evaluation uses.
    async fn test_connection(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        const CONNECTION_TEST_TOKENS: u32 = 16;

        let messages = vec![
            ChatMessage {
                role: String::from("system"),
                content: String::from(
                    "You are a connection check. Reply with the single word OK and nothing else.",
                ),
            },
            ChatMessage {
                role: String::from("user"),
                content: String::from("Connection test"),
            },
        ];
        let options = CompletionOptions {
            temperature: 0.0,
            max_tokens: CONNECTION_TEST_TOKENS,
            timeout_ms: QUICK_REQUEST_TIMEOUT_MS,
            ..CompletionOptions::default()
        };
        let reply = self
            .chat_completion(endpoint, &messages, options, token)
            .await?;
        let cleaned = strip_thinking(&reply);
        Ok(if cleaned.is_empty() {
            reply.trim().to_owned()
        } else {
            cleaned
        })
    }
}

/// What the provider had to set aside to admit a call: Groq checks the prompt
/// plus the whole reply budget against its minute limit. Zero when the reply
/// did not say how long the prompt was.
fn reserved_tokens(usage: &CompletedUsage, options: CompletionOptions) -> u64 {
    if usage.prompt_tokens > 0 {
        usage.prompt_tokens + u64::from(options.max_tokens)
    } else {
        0
    }
}

/// The endpoint's model first, then its fallbacks, each once.
fn models_in_order(endpoint: &LlmEndpoint) -> Vec<String> {
    let fallbacks = endpoint
        .fallback_models
        .iter()
        .filter(|model| **model != endpoint.model)
        .cloned();
    std::iter::once(endpoint.model.clone())
        .chain(fallbacks)
        .collect()
}

fn is_success(status: u16) -> bool {
    (200..300).contains(&status)
}

/// The request body. GPT-OSS models reason before answering, and that
/// reasoning counts against `max_tokens`; at the default effort it used ~2,100
/// of the 3,072-token evaluation budget and the JSON answer was cut off. At low
/// effort: 130–440 reasoning tokens and valid answers (measured 2026-10-04).
/// Only GPT-OSS gets the parameter; other providers may reject it.
fn request_body(model: &str, messages: &[ChatMessage], options: CompletionOptions) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": options.temperature,
        "max_tokens": options.max_tokens,
    });
    if model.contains("gpt-oss") {
        body["reasoning_effort"] = json!("low");
    }
    if options.json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

/// The `usage` block of a chat-completions reply; zeros where a gateway leaves it out.
fn completed_usage(data: &Value) -> CompletedUsage {
    let usage = data.get("usage");
    let count = |value: Option<&Value>| {
        value
            .and_then(Value::as_f64)
            .map_or(0, |count| count.max(0.0) as u64)
    };
    CompletedUsage {
        prompt_tokens: count(usage.and_then(|usage| usage.get("prompt_tokens"))),
        total_tokens: count(usage.and_then(|usage| usage.get("total_tokens"))),
        cached_tokens: count(
            usage
                .and_then(|usage| usage.get("prompt_tokens_details"))
                .and_then(|details| details.get("cached_tokens")),
        ),
    }
}

/// The reply's text; some OpenAI-compatible gateways return content as an
/// array of parts.
fn reply_text(data: &Value) -> String {
    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|part| match part {
                Value::String(text) => text.as_str(),
                other => other
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            })
            .collect(),
        _ => String::new(),
    }
}

/// Groq checks JSON-mode replies itself and answers HTTP 400
/// `json_validate_failed` over a single stray character, returning the model's
/// text as `failed_generation`. That text, when there is one, is the reply.
fn rejected_json_reply(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let error = value.get("error")?;
    let rejected = error.get("code").and_then(Value::as_str) == Some("json_validate_failed");
    rejected
        .then(|| error.get("failed_generation").and_then(Value::as_str))
        .flatten()
        .map(str::to_owned)
}

/// The readable part of a provider's error body: its `error.message` when the
/// body is the usual JSON, otherwise the body itself.
fn provider_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            let message = value
                .get("error")?
                .get("message")?
                .as_str()?
                .trim()
                .to_owned();
            (!message.is_empty()).then_some(message)
        })
        .unwrap_or_else(|| body.trim().to_owned())
}

/// A failed request's message for the learner: which model, what went wrong,
/// and what the provider said.
fn failure_message(model: &str, status: u16, body: &str) -> String {
    let said: String = provider_message(body)
        .chars()
        .take(MAX_ERROR_CHARS)
        .collect();
    let name = model_label(model);
    match (status, said.is_empty()) {
        (401, true) => format!("{name}: the provider rejected the API key. Check it in Settings."),
        (401, false) => {
            format!("{name}: the provider rejected the API key. Check it in Settings. ({said})")
        }
        (_, true) => format!("{name} request failed (HTTP {status})"),
        (_, false) => format!("{name} request failed (HTTP {status}): {said}"),
    }
}
