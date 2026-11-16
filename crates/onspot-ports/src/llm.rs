// SPDX-License-Identifier: AGPL-3.0-or-later

//! HTTP and evaluation ports for the LLM pipeline.
//!
//! The host owns the transport and the key: requests carry a provider id but
//! never an API key, and the webview/Tauri shim adds the `Authorization` header
//! from its secret store. The evaluator port is the only thing a use case sees.

use std::collections::BTreeMap;

use onspot_domain::{
    EvaluationRequest, EvaluationResult, LlmEndpoint, TextGlosses, TranslationSet,
};
use serde::{Deserialize, Serialize};

use crate::{CancelToken, CoreError, GeneratedPrompt};

/// One HTTP request to an OpenAI-compatible endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    /// Provider id whose stored key the host adds, or null for a local server.
    pub provider: Option<String>,
    /// Give up after this long, so a stalled provider cannot leave the learner
    /// waiting forever. `None` keeps the host's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

/// The host's HTTP response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

/// One HTTP request whose body is bytes, not text (a database snapshot).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpBytesRequest {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

/// The host's byte response, with the headers providers inspect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpBytesResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl HttpBytesResponse {
    /// Whether the status is 2xx.
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// The body as UTF-8 text, for provider error messages.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// Performs one HTTP request through the driver.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
pub trait HttpClient: Send + Sync {
    async fn send(
        &self,
        request: &HttpRequest,
        token: &CancelToken,
    ) -> Result<HttpResponse, CoreError>;

    /// Performs one request whose body is bytes.
    ///
    /// Only the sync adapters need this. Drivers that cannot move a binary
    /// body keep the default, which fails with a stable code rather than
    /// silently corrupting a snapshot through a text body.
    async fn send_bytes(
        &self,
        request: &HttpBytesRequest,
        token: &CancelToken,
    ) -> Result<HttpBytesResponse, CoreError> {
        let _ = (request, token);
        Err(CoreError::new(
            "core.http_binary_unsupported",
            "this driver cannot send a binary HTTP body",
        ))
    }
}

/// Performs one HTTP request through the driver (wasm: same thread).
#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
pub trait HttpClient {
    async fn send(
        &self,
        request: &HttpRequest,
        token: &CancelToken,
    ) -> Result<HttpResponse, CoreError>;

    /// Performs one request whose body is bytes (see the native variant).
    async fn send_bytes(
        &self,
        request: &HttpBytesRequest,
        token: &CancelToken,
    ) -> Result<HttpBytesResponse, CoreError> {
        let _ = (request, token);
        Err(CoreError::new(
            "core.http_binary_unsupported",
            "this driver cannot send a binary HTTP body",
        ))
    }
}

/// What the next speaking prompt should be about.
///
/// The practice loop fills this from its configuration; the LLM adapter writes
/// and validates the prompt. Language names and scripts come from the core's
/// catalogue so no driver has to duplicate prompt policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTopicRequest {
    pub endpoint: LlmEndpoint,
    /// The language the prompt must be written in, e.g. `English`.
    pub instruction_language: String,
    /// Its ISO 639-1 code, used to check the model answered in that language.
    pub instruction_language_id: String,
    /// The Unicode scripts that language uses.
    #[serde(default)]
    pub instruction_scripts: Vec<String>,
    /// The language being studied, e.g. `French`.
    pub target_language: String,
    /// The learner's level, e.g. `B1`.
    pub level: String,
    /// The session's tone: `exam`, `casual` or `freeflow`.
    pub mode: String,
    /// Titles already offered, so the model does not repeat them.
    #[serde(default)]
    pub avoid_topics: Vec<String>,
}

/// Builds prompts, calls the endpoint and validates its answer.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    async fn evaluate(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError>;

    /// Writes and validates one speaking prompt in the instruction language.
    async fn write_prompt(
        &self,
        request: &PromptTopicRequest,
        token: &CancelToken,
    ) -> Result<GeneratedPrompt, CoreError>;

    async fn test_connection(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<String, CoreError>;

    async fn translate(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<TranslationSet, CoreError>;

    async fn gloss(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        with_pos: bool,
        token: &CancelToken,
    ) -> Result<TextGlosses, CoreError>;

    async fn phrase(
        &self,
        phrase: &str,
        context: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<String, CoreError>;
}

/// Builds prompts, calls the endpoint and validates its answer (wasm).
#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
pub trait LlmProvider {
    async fn evaluate(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError>;
    /// Writes and validates one speaking prompt in the instruction language.
    async fn write_prompt(
        &self,
        request: &PromptTopicRequest,
        token: &CancelToken,
    ) -> Result<GeneratedPrompt, CoreError>;

    async fn test_connection(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<String, CoreError>;

    async fn translate(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<TranslationSet, CoreError>;

    async fn gloss(
        &self,
        text: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        with_pos: bool,
        token: &CancelToken,
    ) -> Result<TextGlosses, CoreError>;

    async fn phrase(
        &self,
        phrase: &str,
        context: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<String, CoreError>;
}
