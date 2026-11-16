// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::{language, providers, AppSettings, EvaluateAttempt};
use onspot_domain::{EvaluationRequest, EvaluationResult, LlmEndpoint};
use onspot_ports::{CancelToken, LlmProvider};

use crate::error::CliError;
use crate::secrets::CliSecrets;

pub const DEFAULT_PROMPT: &str = "Tell me about your morning routine.";

#[derive(Debug, Clone)]
pub struct EvaluateOptions {
    pub transcript: String,
    pub prompt: Option<String>,
    pub mode: Option<String>,
    pub level: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub target_language: Option<String>,
    pub instruction_language: Option<String>,
}

/// Builds the same `EvaluationRequest` the GUI's practice core sends.
pub fn build_request(
    settings: &AppSettings,
    options: &EvaluateOptions,
) -> Result<EvaluationRequest, CliError> {
    let transcript = options.transcript.trim();
    if transcript.is_empty() {
        return Err(CliError::message("the transcript is empty"));
    }

    let provider = options
        .provider
        .clone()
        .unwrap_or_else(|| settings.llm_provider.clone());
    let provider = providers::provider(&provider).id.clone();

    let target_language = options
        .target_language
        .clone()
        .unwrap_or_else(|| settings.target_language.clone());
    let instruction_language = options
        .instruction_language
        .clone()
        .unwrap_or_else(|| settings.instruction_language.clone());

    let language_name = language::language(&target_language)
        .map(|language| language.name.clone())
        .unwrap_or_else(|| target_language.clone());
    let instruction_name = language::catalog()
        .instruction_languages
        .iter()
        .find(|language| language.id == instruction_language)
        .map(|language| language.name.clone())
        .unwrap_or_else(|| instruction_language.clone());

    let llm_model = options.model.as_ref().unwrap_or(&settings.llm_model);
    let custom_model = options.model.as_ref().unwrap_or(&settings.custom_model);
    let resolved = providers::resolve_endpoint(&providers::EndpointSettings {
        correction_mode: &settings.correction_mode,
        local_llm_url: &settings.local_llm_url,
        local_llm_model: &settings.local_llm_model,
        llm_provider: &provider,
        llm_model,
        custom_base_url: &settings.custom_base_url,
        custom_model,
        target_language: &target_language,
        instruction_language: &instruction_language,
        api_key: "",
    });
    if resolved.base_url.trim().is_empty() {
        return Err(CliError::message(format!(
            "no base URL for provider {provider}; set customBaseUrl in settings"
        )));
    }
    if resolved.model.trim().is_empty() {
        return Err(CliError::message(format!(
            "no model selected for provider {provider}"
        )));
    }
    let base_url = resolved.base_url;
    let model = resolved.model;
    let fallback_models = resolved.fallback_models;

    Ok(EvaluationRequest {
        transcript: transcript.to_owned(),
        prompt: options
            .prompt
            .clone()
            .unwrap_or_else(|| DEFAULT_PROMPT.to_owned()),
        mode: options
            .mode
            .clone()
            .unwrap_or_else(|| settings.mode.clone()),
        level: options
            .level
            .clone()
            .unwrap_or_else(|| settings.level.clone()),
        language: language_name,
        translation_target: instruction_name,
        endpoint: LlmEndpoint {
            base_url,
            provider,
            model,
            fallback_models,
            // Filled by `evaluate_with`, which holds the keys.
            key_id: String::new(),
        },
    })
}

/// Evaluates a transcript with the endpoint the settings and options choose.
///
/// @param secrets The keys, only to identify the one in use for the usage
///   ledger; the transport adds the key itself.
pub async fn evaluate_with(
    settings: &AppSettings,
    options: &EvaluateOptions,
    secrets: &CliSecrets,
    evaluator: &dyn LlmProvider,
    token: &CancelToken,
) -> Result<(EvaluationRequest, EvaluationResult), CliError> {
    let mut request = build_request(settings, options)?;
    let key = secrets.key(&request.endpoint.provider).unwrap_or_default();
    request.endpoint.key_id = onspot_app::key_id(&key);

    let result = EvaluateAttempt::new(evaluator)
        .execute(&request, token)
        .await?;
    Ok((request, result))
}
