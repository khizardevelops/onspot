// SPDX-License-Identifier: AGPL-3.0-or-later

//! The OpenAI-compatible chat client and evaluator over the `HttpClient` port.

use std::collections::BTreeMap;

use onspot_domain::{EvaluationRequest, EvaluationResult, LlmEndpoint};
use onspot_ports::{
    CancelToken, Clock, CoreError, GeneratedPrompt, HttpClient, HttpRequest, LlmProvider,
    PromptTopicRequest,
};
use serde_json::{json, Value};

use crate::json_repair::repair_json;
use crate::pacing::{Pacing, DEFAULT_TOKENS_PER_MINUTE};
use crate::parse::{extract_json, normalize_evaluation, strip_thinking};
use crate::prompt::{build_evaluation_messages, ChatMessage};
use crate::prompt_topic::{
    build_prompt_messages, parse_prompt_topic, validate_prompt_topic, PROMPT_TOPIC_TOKENS,
};

const DEFAULT_TEMPERATURE: f32 = 0.2;
const MAX_ERROR_CHARS: usize = 2000;
const MAX_REFUSALS: usize = 6;
const REFUSAL_WAIT_MS: u64 = 2_000;

/// The production evaluator: prompts and parsing are local; transport and the
/// API key belong to the driver's `HttpClient`.
pub struct OpenAiEvaluator {
    http: std::sync::Arc<dyn HttpClient>,
    clock: std::sync::Arc<dyn Clock>,
    pacing: Pacing,
}

impl OpenAiEvaluator {
    /// Creates the evaluator over a transport and clock.
    pub fn new(http: std::sync::Arc<dyn HttpClient>, clock: std::sync::Arc<dyn Clock>) -> Self {
        Self {
            http,
            clock,
            pacing: Pacing::default(),
        }
    }

    /// Sends one chat-completion request and returns the model's text.
    pub async fn complete(
        &self,
        endpoint: &LlmEndpoint,
        messages: &[ChatMessage],
        max_tokens: u32,
        json_mode: bool,
        temperature: f32,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        let _ = temperature;
        self.completion(endpoint, messages, max_tokens, json_mode, token)
            .await
    }

    async fn completion(
        &self,
        endpoint: &LlmEndpoint,
        messages: &[ChatMessage],
        max_tokens: u32,
        json_mode: bool,
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
        let models: Vec<&str> = std::iter::once(endpoint.model.as_str())
            .chain(
                endpoint
                    .fallback_models
                    .iter()
                    .map(String::as_str)
                    .filter(|model| *model != endpoint.model),
            )
            .collect();
        for model in models {
            for attempt in 0..MAX_REFUSALS {
                if token.is_cancelled() {
                    return Err(token.error());
                }
                let estimate = prompt_tokens(messages) + u64::from(max_tokens);
                let key = format!("{url}|{model}");
                let wait = self.pacing.wait_ms(
                    &key,
                    estimate,
                    u64::from(DEFAULT_TOKENS_PER_MINUTE),
                    self.clock.now_ms(),
                );
                if wait > 0 && !self.clock.sleep(wait, token).await {
                    return Err(token.error());
                }
                self.pacing.charge(
                    &key,
                    estimate,
                    u64::from(DEFAULT_TOKENS_PER_MINUTE),
                    self.clock.now_ms(),
                );

                let body = request_body(model, messages, max_tokens, json_mode);
                let mut headers = BTreeMap::new();
                headers.insert(
                    String::from("Content-Type"),
                    String::from("application/json"),
                );
                let request = HttpRequest {
                    method: String::from("POST"),
                    url: url.clone(),
                    headers,
                    body: body.to_string(),
                    provider: Some(endpoint.provider.clone()),
                };
                let response = self.http.send(&request, token).await?;
                if response.status == 200 {
                    return completion_text(&response.body);
                }

                let rejected = if json_mode {
                    rejected_json_reply(&response.body)
                } else {
                    None
                };
                if let Some(rejected) = rejected {
                    if let Some(repaired) = repair_json(&rejected) {
                        return Ok(repaired);
                    }
                }

                if response.status == 429 && attempt + 1 < MAX_REFUSALS {
                    if !self.clock.sleep(REFUSAL_WAIT_MS, token).await {
                        return Err(token.error());
                    }
                    continue;
                }

                return Err(CoreError::new(
                    "llm.request_failed",
                    failure_message(model, response.status, &response.body),
                ));
            }
        }

        Err(CoreError::new(
            "llm.request_failed",
            "No model could take the request.",
        ))
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
        let messages = build_evaluation_messages(
            &request.transcript,
            &request.prompt,
            &request.mode,
            &request.level,
            &request.language,
            &request.translation_target,
            None,
        );
        let raw = self
            .completion(
                &request.endpoint,
                &messages,
                crate::prompt::MAX_EVALUATION_TOKENS,
                true,
                token,
            )
            .await?;
        let parsed = extract_json(&raw).map_err(|message| {
            CoreError::new(
                "llm.invalid_json",
                format!("The model returned unusable JSON: {message}"),
            )
        })?;
        Ok(normalize_evaluation(
            &parsed,
            &request.transcript,
            Some(&request.language),
        ))
    }

    async fn write_prompt(
        &self,
        request: &PromptTopicRequest,
        token: &CancelToken,
    ) -> Result<GeneratedPrompt, CoreError> {
        let messages = build_prompt_messages(request);
        let raw = self
            .complete(
                &request.endpoint,
                &messages,
                PROMPT_TOPIC_TOKENS,
                true,
                0.9,
                token,
            )
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

    async fn test_connection(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        let messages = vec![
            ChatMessage {
                role: String::from("system"),
                content: String::from("You are a connection test. Reply with the single word OK."),
            },
            ChatMessage {
                role: String::from("user"),
                content: String::from("Reply OK."),
            },
        ];
        let reply = self
            .completion(endpoint, &messages, 16, false, token)
            .await?;
        Ok(strip_thinking(&reply).trim().to_owned())
    }
}

fn prompt_tokens(messages: &[ChatMessage]) -> u64 {
    let characters: usize = messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum();
    (characters as u64).div_ceil(3) + messages.len() as u64 * 4
}

fn request_body(model: &str, messages: &[ChatMessage], max_tokens: u32, json_mode: bool) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": DEFAULT_TEMPERATURE,
        "max_tokens": max_tokens,
    });
    if model.contains("gpt-oss") {
        body["reasoning_effort"] = json!("low");
    }
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

fn completion_text(body: &str) -> Result<String, CoreError> {
    let value: Value = serde_json::from_str(body).map_err(|error| {
        CoreError::new(
            "llm.invalid_response",
            format!("The endpoint did not return a chat-completions response: {error}"),
        )
    })?;
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            CoreError::new(
                "llm.invalid_response",
                "The endpoint returned no message content.",
            )
        })
}

fn rejected_json_reply(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let error = value.get("error")?;
    let rejected = error.get("code").and_then(Value::as_str) == Some("json_validate_failed");
    rejected
        .then(|| error.get("failed_generation").and_then(Value::as_str))
        .flatten()
        .map(str::to_owned)
}

fn failure_message(model: &str, status: u16, body: &str) -> String {
    let provider_message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.trim().to_owned());
    let said = provider_message
        .chars()
        .take(MAX_ERROR_CHARS)
        .collect::<String>();
    let name = model.split('/').next_back().unwrap_or(model);
    if status == 401 {
        format!(
            "{name}: the provider rejected the API key. Check it in Settings.{}{said}{}",
            if said.is_empty() { "" } else { " (" },
            if said.is_empty() { "" } else { ")" }
        )
    } else if said.is_empty() {
        format!("{name} request failed (HTTP {status})")
    } else {
        format!("{name} request failed (HTTP {status}): {said}")
    }
}
