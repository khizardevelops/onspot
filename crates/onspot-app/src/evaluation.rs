// SPDX-License-Identifier: AGPL-3.0-or-later

//! The evaluation use cases over the `LlmProvider` port.
//!
//! Prompt rendering, transport, pacing and parsing belong to the adapter; the
//! application only chooses the request and returns the validated result.

use std::sync::Arc;

use onspot_domain::{EvaluationRequest, EvaluationResult, LlmEndpoint};
use onspot_ports::{CancelToken, CoreError, EvaluationPort, LlmProvider};

/// Judges one take through the configured LLM.
pub struct EvaluateAttempt<'a> {
    evaluator: &'a dyn LlmProvider,
}

impl<'a> EvaluateAttempt<'a> {
    /// Creates the use case over an evaluator.
    pub fn new(evaluator: &'a dyn LlmProvider) -> Self {
        Self { evaluator }
    }

    /// Runs the evaluation.
    pub async fn execute(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        self.evaluator.evaluate(request, token).await
    }
}

/// Checks that a provider endpoint answers.
pub struct TestLlmConnection<'a> {
    evaluator: &'a dyn LlmProvider,
}

impl<'a> TestLlmConnection<'a> {
    /// Creates the use case over an evaluator.
    pub fn new(evaluator: &'a dyn LlmProvider) -> Self {
        Self { evaluator }
    }

    /// Returns the provider's short reply, or a typed failure.
    pub async fn execute(
        &self,
        endpoint: &LlmEndpoint,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        self.evaluator.test_connection(endpoint, token).await
    }
}

/// Exposes a Rust evaluator through the practice loop's `EvaluationPort`.
pub struct EvaluatorPort {
    evaluator: Arc<dyn LlmProvider>,
}

impl EvaluatorPort {
    /// Wraps an evaluator for `RunPracticeSession`.
    pub fn new(evaluator: Arc<dyn LlmProvider>) -> Self {
        Self { evaluator }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl EvaluationPort for EvaluatorPort {
    async fn evaluate(
        &self,
        request: &EvaluationRequest,
        token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        EvaluateAttempt::new(self.evaluator.as_ref())
            .execute(request, token)
            .await
    }
}
