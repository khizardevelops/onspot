// SPDX-License-Identifier: AGPL-3.0-or-later

//! P8 cross-driver gate: the CLI driver and the GUI practice driver must turn
//! the same settings and languages into the same LLM endpoint.
//!
//! The GUI (browser/Tauri) resolves its endpoint with
//! `providers::resolve_endpoint` when it builds `PracticeConfig`/`PromptRequest`;
//! the CLI calls `onspot_cli::evaluation::build_request`. This test feeds both
//! the same `AppSettings` and compares the endpoints, so a driver that ever
//! grows its own model policy fails here.

use onspot_app::{providers, AppSettings};
use onspot_cli::evaluation::{build_request, EvaluateOptions};
use onspot_domain::LlmEndpoint;

fn gui_endpoint(settings: &AppSettings) -> LlmEndpoint {
    let resolved = providers::resolve_endpoint(&providers::EndpointSettings {
        correction_mode: &settings.correction_mode,
        local_llm_url: &settings.local_llm_url,
        local_llm_model: &settings.local_llm_model,
        llm_provider: &settings.llm_provider,
        llm_model: &settings.llm_model,
        custom_base_url: &settings.custom_base_url,
        custom_model: &settings.custom_model,
        target_language: &settings.target_language,
        instruction_language: &settings.instruction_language,
        api_key: "",
    });
    LlmEndpoint {
        base_url: resolved.base_url,
        provider: resolved.provider,
        model: resolved.model,
        fallback_models: resolved.fallback_models,
    }
}

fn cli_endpoint(settings: &AppSettings) -> LlmEndpoint {
    build_request(
        settings,
        &EvaluateOptions {
            transcript: String::from("bonjour"),
            prompt: None,
            mode: None,
            level: None,
            provider: None,
            model: None,
            target_language: None,
            instruction_language: None,
        },
    )
    .expect("cli request")
    .endpoint
}

#[test]
fn the_gui_and_cli_resolve_the_same_groq_endpoint() {
    let settings = AppSettings {
        llm_provider: String::from("groq"),
        llm_model: providers::automatic_model().to_owned(),
        target_language: String::from("fr"),
        instruction_language: String::from("en"),
        ..AppSettings::default()
    };
    let gui = gui_endpoint(&settings);
    let cli = cli_endpoint(&settings);
    assert_eq!(gui, cli);
    assert_eq!(gui.provider, "groq");
    assert!(gui.base_url.contains("api.groq.com"));
    assert!(!gui.model.is_empty());
}

#[test]
fn the_gui_and_cli_resolve_the_same_custom_endpoint() {
    let settings = AppSettings {
        llm_provider: String::from("custom"),
        custom_base_url: String::from("http://127.0.0.1:1234/v1"),
        custom_model: String::from("local-model"),
        target_language: String::from("fr"),
        instruction_language: String::from("en"),
        ..AppSettings::default()
    };
    let gui = gui_endpoint(&settings);
    let cli = cli_endpoint(&settings);
    assert_eq!(gui, cli);
    assert_eq!(gui.model, "local-model");
    assert_eq!(gui.provider, "custom");
}

#[test]
fn the_gui_and_cli_agree_on_the_language_level_for_low_resource_pairs() {
    // Persian instruction, Japanese target: the less-resourced language decides.
    let settings = AppSettings {
        llm_provider: String::from("groq"),
        llm_model: providers::automatic_model().to_owned(),
        target_language: String::from("ja"),
        instruction_language: String::from("fa"),
        ..AppSettings::default()
    };
    assert_eq!(gui_endpoint(&settings), cli_endpoint(&settings));
}
