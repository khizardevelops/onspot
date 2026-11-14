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

/// The host part of a URL, as the legacy `new URL(url).host` would show it.
fn host(url: &str) -> &str {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    without_scheme.split('/').next().unwrap_or(without_scheme)
}

/// The provider an endpoint URL belongs to ("Groq"), or its host for any other
/// server.
pub fn provider_name_for(base_url: &str) -> String {
    if let Some(known) = CATALOG.providers.iter().find(|provider| {
        !provider.base_url.is_empty() && host(&provider.base_url) == host(base_url)
    }) {
        return known.name.clone();
    }
    host(base_url).to_owned()
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
}
