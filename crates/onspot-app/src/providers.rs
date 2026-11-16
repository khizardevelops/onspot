// SPDX-License-Identifier: AGPL-3.0-or-later

//! The LLM provider and model catalog, moved from
//! `src/lib/adapters/llm/providers.ts`.
//!
//! The JSON is generated from the TypeScript registry by
//! `scripts/export-provider-catalog.mjs`; the build test reads the same file
//! and fails if it cannot be deserialized. The core owns the catalog and the
//! Automatic-model policy; the TypeScript copy remains a generated view
//! catalog for the Settings screen.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::language::{language, resource_level};

/// A provider preset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub default_model: String,
    #[serde(default)]
    pub key_url: String,
    #[serde(default)]
    pub models_url: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub requires_base_url: Option<bool>,
}

/// One selectable model in the Settings dropdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub note: Option<String>,
}

/// A model Automatic may choose, and the least-resourced language it is
/// trusted with (`low`, `medium` or `high`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticModel {
    pub id: String,
    pub least_resourced: String,
}

/// The checked-in provider catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalog {
    #[serde(default)]
    pub captured_from: String,
    pub automatic_model: String,
    pub providers: Vec<ProviderConfig>,
    pub models: BTreeMap<String, Vec<ModelOption>>,
    pub automatic_models: BTreeMap<String, Vec<AutomaticModel>>,
}

static CATALOG: Lazy<ProviderCatalog> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/providers.json"))
        .expect("the checked-in provider catalog is valid")
});

/// Models that are not chat-completion models: speech-to-text, text-to-speech,
/// classifiers and guards. Mirrors `isChatModel` in the TypeScript client.
static NON_CHAT_MODEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)whisper|orpheus|prompt-guard|safeguard|\btts\b|embed|moderation|guard")
        .expect("the non-chat model expression is valid")
});

/// The whole provider catalog.
pub fn catalog() -> &'static ProviderCatalog {
    &CATALOG
}

/// The `llmModel` value that lets onspot choose per request.
pub fn automatic_model() -> &'static str {
    &CATALOG.automatic_model
}

/// A provider by id; the custom provider for an unknown id, like the legacy
/// `getProvider`.
pub fn provider(id: &str) -> &'static ProviderConfig {
    CATALOG
        .providers
        .iter()
        .find(|provider| provider.id == id)
        .or_else(|| {
            CATALOG
                .providers
                .iter()
                .find(|provider| provider.id == "custom")
        })
        .unwrap_or(&CATALOG.providers[0])
}

/// The curated dropdown models for a provider.
pub fn model_options(id: &str) -> &'static [ModelOption] {
    CATALOG
        .models
        .get(id)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// A model's display name, or its id without the vendor prefix.
pub fn model_label(model: &str) -> String {
    CATALOG
        .models
        .values()
        .flatten()
        .find(|option| option.id == model)
        .map(|option| option.label.clone())
        .unwrap_or_else(|| model.rsplit('/').next().unwrap_or(model).to_owned())
}

/// The host part of a URL, as the driver's `new URL(url).host` shows it.
pub fn url_host(url: &str) -> &str {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    without_scheme.split('/').next().unwrap_or(without_scheme)
}

/// The provider an endpoint URL belongs to ("Groq"), or its host for any other
/// server.
pub fn provider_name_for(base_url: &str) -> String {
    if let Some(known) = CATALOG.providers.iter().find(|provider| {
        !provider.base_url.is_empty() && url_host(&provider.base_url) == url_host(base_url)
    }) {
        return known.name.clone();
    }
    url_host(base_url).to_owned()
}

/// Whether a provider model id is a chat model the LLM step can use.
pub fn is_chat_model(id: &str) -> bool {
    !NON_CHAT_MODEL.is_match(id)
}

/// Resource levels from most to least text.
fn level_rank(level: &str) -> Option<usize> {
    match level {
        "high" => Some(0),
        "medium" => Some(1),
        "low" => Some(2),
        _ => None,
    }
}

/// The models Automatic may use for a provider and a language level, in order
/// of preference. Empty for a provider Automatic does not cover (custom).
pub fn automatic_models(provider: &str, level: &str) -> Vec<&'static str> {
    let Some(request_rank) = level_rank(level) else {
        return Vec::new();
    };
    CATALOG
        .automatic_models
        .get(provider)
        .map(|models| {
            models
                .iter()
                .filter(|model| {
                    level_rank(model.least_resourced.as_str())
                        .map(|rank| rank >= request_rank)
                        .unwrap_or(false)
                })
                .map(|model| model.id.as_str())
                .collect()
        })
        .unwrap_or_default()
}

/// The endpoint and key the LLM client should use for one request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEndpoint {
    pub base_url: String,
    pub provider: String,
    pub model: String,
    pub fallback_models: Vec<String>,
    /// The key the driver found in its secret store; never persisted here.
    pub api_key: String,
}

/// The settings the endpoint resolution reads.
#[derive(Debug, Clone, PartialEq)]
pub struct EndpointSettings<'a> {
    pub correction_mode: &'a str,
    pub local_llm_url: &'a str,
    pub local_llm_model: &'a str,
    pub llm_provider: &'a str,
    pub llm_model: &'a str,
    pub custom_base_url: &'a str,
    pub custom_model: &'a str,
    /// The language being studied; the LLM reads it.
    pub target_language: &'a str,
    /// The language of instruction; the LLM writes it intro.
    pub instruction_language: &'a str,
    /// The key from the driver's secret store, or empty.
    pub api_key: &'a str,
}

/// The resource level a request needs: the model reads the studied language and
/// writes the language of instruction, so the less-resourced of the two decides.
fn language_level(target_language: &str, instruction_language: &str) -> &'static str {
    let studied =
        language(target_language).map_or(f64::INFINITY, |language| language.web_text_percent);
    let instruction = crate::language::catalog()
        .instruction_languages
        .iter()
        .find(|language| language.id == instruction_language)
        .map_or(f64::INFINITY, |language| language.web_text_percent);
    resource_level(studied.min(instruction))
}

/// Resolves the model Automatic should use: the chosen one, or the first model
/// trusted with the languages in use, else the provider default.
pub fn models_for(provider_id: &str, chosen: &str, language_level: &str) -> Vec<String> {
    if provider_id == "custom" {
        return vec![chosen.to_owned()];
    }
    if !chosen.is_empty() && chosen != automatic_model() {
        return vec![chosen.to_owned()];
    }
    let automatic = automatic_models(provider_id, language_level);
    if automatic.is_empty() {
        vec![provider(provider_id).default_model.clone()]
    } else {
        automatic.into_iter().map(str::to_owned).collect()
    }
}

/// The key slot of the local-server endpoint.
const LOCAL_KEY_SLOT: &str = "local";

/// Builds the endpoint the LLM client needs from settings and a secret.
/// `provider` is the key slot the driver's host adds a key from.
pub fn resolve_endpoint(settings: &EndpointSettings<'_>) -> ResolvedEndpoint {
    if settings.correction_mode == "local" {
        return ResolvedEndpoint {
            base_url: settings.local_llm_url.to_owned(),
            // The local server keeps its own key, never a cloud provider's.
            provider: String::from(LOCAL_KEY_SLOT),
            model: settings.local_llm_model.to_owned(),
            fallback_models: Vec::new(),
            api_key: settings.api_key.to_owned(),
        };
    }

    let id = if settings.llm_provider == "custom" {
        "custom"
    } else {
        settings.llm_provider
    };
    let provider = provider(id);
    let base_url = if id == "custom" {
        settings.custom_base_url
    } else {
        provider.base_url.as_str()
    };
    let base_url = if base_url.trim().is_empty() {
        provider.base_url.clone()
    } else {
        base_url.to_owned()
    };
    let chosen = if id == "custom" {
        settings.custom_model
    } else {
        settings.llm_model
    };
    let level = language_level(settings.target_language, settings.instruction_language);
    let models = models_for(id, chosen, level);
    let mut models = models.into_iter();
    let model = models.next().unwrap_or_default();
    ResolvedEndpoint {
        base_url,
        // The key slot is the chosen provider's: a custom URL that points at a
        // known host still uses the custom key the learner gave for it.
        provider: id.to_owned(),
        model,
        fallback_models: models.collect(),
        api_key: settings.api_key.to_owned(),
    }
}

/// Whether evaluation can run at all: a cloud provider needs a key; a custom
/// endpoint (often local) needs a URL and model, and its key is optional.
pub fn is_configured(settings: &EndpointSettings<'_>) -> bool {
    if settings.correction_mode == "local" {
        return !settings.local_llm_url.trim().is_empty()
            && !settings.local_llm_model.trim().is_empty();
    }
    match settings.llm_provider {
        "groq" | "deepseek" => !settings.api_key.trim().is_empty(),
        _ => {
            !settings.custom_base_url.trim().is_empty() && !settings.custom_model.trim().is_empty()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_carries_the_three_providers_and_their_models() {
        assert_eq!(catalog().providers.len(), 3);
        assert_eq!(provider("groq").name, "Groq");
        assert_eq!(provider("deepseek").default_model, "deepseek-flash");
        assert_eq!(provider("missing").id, "custom");
        assert_eq!(model_options("groq").len(), 6);
        assert!(model_options("custom").is_empty());
        assert_eq!(automatic_model(), "auto");
    }

    #[test]
    fn automatic_models_follow_the_language_resource_level() {
        assert_eq!(automatic_models("groq", "low"), vec!["openai/gpt-oss-120b"]);
        assert_eq!(
            automatic_models("groq", "medium"),
            vec!["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]
        );
        assert_eq!(
            automatic_models("groq", "high"),
            vec![
                "openai/gpt-oss-120b",
                "qwen/qwen3.8-27b",
                "openai/gpt-oss-20b"
            ]
        );
        assert_eq!(automatic_models("deepseek", "low"), vec!["deepseek-v4-pro"]);
        assert_eq!(
            automatic_models("deepseek", "high"),
            vec!["deepseek-flash", "deepseek-v4-pro"]
        );
        assert!(automatic_models("custom", "high").is_empty());
        assert!(automatic_models("groq", "unknown").is_empty());
    }

    #[test]
    fn labels_and_provider_names_match_the_legacy_helpers() {
        assert_eq!(model_label("openai/gpt-oss-120b"), "GPT-OSS 120B");
        assert_eq!(model_label("vendor/private-model"), "private-model");
        assert_eq!(provider_name_for("https://api.groq.com/openai/v1"), "Groq");
        assert_eq!(
            provider_name_for("http://localhost:1234/v1"),
            "localhost:1234"
        );
        assert_eq!(provider_name_for("not a url"), "not a url");
    }

    #[test]
    fn chat_models_filter_speech_and_classifiers() {
        assert!(is_chat_model("openai/gpt-oss-120b"));
        assert!(is_chat_model("deepseek-flash"));
        assert!(!is_chat_model("whisper-large-v3"));
        assert!(!is_chat_model("openai/gpt-oss-safeguard-20b"));
        assert!(!is_chat_model("text-embedding-3-small"));
        assert!(!is_chat_model("Whisper-Large-V3"));
    }

    fn settings<'a>(api_key: &'a str) -> EndpointSettings<'a> {
        EndpointSettings {
            correction_mode: "cloud",
            local_llm_url: "",
            local_llm_model: "",
            llm_provider: "groq",
            llm_model: automatic_model(),
            custom_base_url: "",
            custom_model: "",
            target_language: "fr",
            instruction_language: "en",
            api_key,
        }
    }

    #[test]
    fn a_configured_provider_resolves_automatic_models() {
        let resolved = resolve_endpoint(&settings("sk-live"));
        assert_eq!(resolved.provider, "groq");
        assert_eq!(resolved.api_key, "sk-live");
        assert!(!resolved.base_url.is_empty());

        assert!(!resolved.model.is_empty());
    }

    #[test]
    fn a_custom_url_on_a_known_host_still_uses_the_custom_key() {
        let mut custom = settings("");
        custom.llm_provider = "custom";
        custom.custom_base_url = "https://api.groq.com/openai/v1";
        custom.custom_model = "openai/gpt-oss-120b";
        assert_eq!(resolve_endpoint(&custom).provider, "custom");
    }

    #[test]
    fn language_level_takes_the_less_resourced_of_the_pair() {
        // Both fr and en are high-resource, so Automatic may choose between them.
        assert_eq!(language_level("fr", "en"), "high");
        // The studied and instruction languages both count: a low-resource
        // instruction language must not be hidden by a high-resource target.
        assert_eq!(language_level("fr", "fa"), "medium");
        assert_eq!(language_level("fr", "ur"), "low");
    }

    #[test]
    fn configuration_needs_a_key_except_for_a_custom_endpoint() {
        assert!(is_configured(&settings("sk-live")));
        assert!(!is_configured(&settings("")));

        let mut custom = settings("");
        custom.llm_provider = "custom";
        custom.custom_base_url = "http://localhost:1234/v1";
        custom.custom_model = "local";
        assert!(is_configured(&custom));
        assert_eq!(
            models_for("custom", "local", "low"),
            vec![String::from("local")]
        );
        assert_eq!(resolve_endpoint(&custom).model, "local");

        let mut local = settings("");
        local.correction_mode = "local";
        local.local_llm_url = "http://127.0.0.1:4330/v1";
        local.local_llm_model = "stub";
        let resolved = resolve_endpoint(&local);
        assert_eq!(
            resolved.provider, "local",
            "a local server never gets a cloud key"
        );
        assert_eq!(resolved.base_url, "http://127.0.0.1:4330/v1");
        assert!(is_configured(&local));
        let mut blank = settings("");
        blank.correction_mode = "local";
        assert!(!is_configured(&blank));
    }
}
