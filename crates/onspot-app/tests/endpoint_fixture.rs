// SPDX-License-Identifier: AGPL-3.0-or-later

//! Golden fixture for endpoint resolution.
//!
//! `tests/fixtures/request-endpoints.json` is replayed here against
//! `providers::resolve_endpoint` and by `scripts/check-endpoint-parity.mjs`
//! against the TypeScript driver's `resolveLlmEndpoint`, so the web/desktop
//! composition and the core policy cannot drift. `bun run endpoint:capture`
//! rewrites it; the check fails when it is stale.

use std::path::Path;

use serde_json::Value;

use onspot_app::providers::{self, EndpointSettings};

fn fixture() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/request-endpoints.json");
    let text = std::fs::read_to_string(path).expect("request-endpoints.json");
    serde_json::from_str(&text).expect("request-endpoints.json shape")
}

#[test]
fn every_endpoint_fixture_case_matches_the_core() {
    let fixture = fixture();
    let cases = fixture["cases"].as_array().expect("cases");
    let expected = fixture["expected"].as_array().expect("expected");
    assert_eq!(cases.len(), expected.len());
    for (case, expected) in cases.iter().zip(expected) {
        let settings = &case["settings"];
        let text = |key: &str| settings[key].as_str().unwrap_or_default();
        let resolved = providers::resolve_endpoint(&EndpointSettings {
            correction_mode: text("correctionMode"),
            local_llm_url: text("localLlmUrl"),
            local_llm_model: text("localLlmModel"),
            llm_provider: text("llmProvider"),
            llm_model: text("llmModel"),
            custom_base_url: text("customBaseUrl"),
            custom_model: text("customModel"),
            target_language: text("targetLanguage"),
            instruction_language: text("instructionLanguage"),
            api_key: case["apiKey"].as_str().unwrap_or_default(),
        });
        assert_eq!(
            serde_json::to_value(serde_json::json!({
                "baseUrl": resolved.base_url,
                "provider": resolved.provider,
                "model": resolved.model,
                "fallbackModels": resolved.fallback_models,
            }))
            .expect("resolved json"),
            *expected,
            "case {}",
            case["name"].as_str().unwrap_or("?")
        );
    }
}
