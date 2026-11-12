// SPDX-License-Identifier: AGPL-3.0-or-later

//! Groq's published rate-limit tables, ported verbatim from
//! `src/lib/usage/publishedLimits.ts` (checked 2026-10-30).

use std::collections::BTreeMap;

/// A model's limits by window name (`RPM`, `TPM`, ...).
pub type ModelLimits = BTreeMap<String, u64>;

fn limits(entries: &[(&str, u64)]) -> ModelLimits {
    entries
        .iter()
        .map(|(window, value)| ((*window).to_owned(), *value))
        .collect()
}

fn free(model: &str) -> Option<ModelLimits> {
    Some(match model {
        "canopylabs/orpheus-arabic-saudi" => {
            limits(&[("RPM", 10), ("RPD", 100), ("TPM", 1_200), ("TPD", 3_600)])
        }
        "canopylabs/orpheus-v1-english" => {
            limits(&[("RPM", 10), ("RPD", 100), ("TPM", 1_200), ("TPD", 3_600)])
        }
        "meta-llama/llama-prompt-guard-2-22m" => limits(&[
            ("RPM", 30),
            ("RPD", 14_400),
            ("TPM", 15_000),
            ("TPD", 500_000),
        ]),
        "meta-llama/llama-prompt-guard-2-86m" => limits(&[
            ("RPM", 30),
            ("RPD", 14_400),
            ("TPM", 15_000),
            ("TPD", 500_000),
        ]),
        "openai/gpt-oss-120b" => limits(&[
            ("RPM", 30),
            ("RPD", 1_000),
            ("TPM", 8_000),
            ("TPD", 200_000),
        ]),
        "openai/gpt-oss-20b" => limits(&[
            ("RPM", 30),
            ("RPD", 1_000),
            ("TPM", 8_000),
            ("TPD", 200_000),
        ]),
        "openai/gpt-oss-safeguard-20b" => {
            limits(&[("RPM", 3), ("RPD", 1_000), ("TPM", 2_000), ("TPD", 200_000)])
        }
        "qwen/qwen3.8-27b" => limits(&[
            ("RPM", 30),
            ("RPD", 1_000),
            ("TPM", 8_000),
            ("TPD", 200_000),
        ]),
        "whisper-large-v3" => {
            limits(&[("RPM", 20), ("RPD", 2_000), ("ASH", 7_200), ("ASD", 28_800)])
        }
        "whisper-large-v3-turbo" => {
            limits(&[("RPM", 20), ("RPD", 2_000), ("ASH", 7_200), ("ASD", 28_800)])
        }
        _ => return None,
    })
}

fn developer(model: &str) -> Option<ModelLimits> {
    Some(match model {
        "canopylabs/orpheus-arabic-saudi" => {
            limits(&[("RPM", 250), ("RPD", 100_000), ("TPM", 50_000)])
        }
        "canopylabs/orpheus-v1-english" => {
            limits(&[("RPM", 250), ("RPD", 100_000), ("TPM", 50_000)])
        }
        "meta-llama/llama-prompt-guard-2-22m" => {
            limits(&[("RPM", 100), ("RPD", 50_000), ("TPM", 30_000)])
        }
        "meta-llama/llama-prompt-guard-2-86m" => {
            limits(&[("RPM", 100), ("RPD", 50_000), ("TPM", 30_000)])
        }
        "openai/gpt-oss-120b" => limits(&[("RPM", 1_000), ("RPD", 500_000), ("TPM", 250_000)]),
        "openai/gpt-oss-20b" => limits(&[("RPM", 1_000), ("RPD", 500_000), ("TPM", 250_000)]),
        "openai/gpt-oss-safeguard-20b" => {
            limits(&[("RPM", 1_000), ("RPD", 500_000), ("TPM", 150_000)])
        }
        "qwen/qwen3.8-27b" => limits(&[("RPM", 1_000), ("RPD", 500_000), ("TPM", 250_000)]),
        "whisper-large-v3" => limits(&[
            ("RPM", 300),
            ("RPD", 200_000),
            ("ASH", 200_000),
            ("ASD", 4_000_000),
        ]),
        "whisper-large-v3-turbo" => limits(&[
            ("RPM", 400),
            ("RPD", 200_000),
            ("ASH", 400_000),
            ("ASD", 4_000_000),
        ]),
        _ => return None,
    })
}

/// The published table for a model and plan; empty for an unknown model.
pub fn groq_published_limits(model: &str, plan: &str) -> ModelLimits {
    let table = if plan == "developer" {
        developer(model)
    } else {
        free(model)
    };
    table.unwrap_or_default()
}

/// Published limits plus the reply-token limit Groq only states in refusals.
pub fn groq_known_limits(model: &str, plan: &str) -> ModelLimits {
    let mut known = groq_published_limits(model, plan);
    if plan != "developer" && model == "qwen/qwen3.8-27b" {
        known.insert(String::from("OTPM"), 1_000);
    }
    known
}

/// Every model in Groq's published table, in menu order.
pub const GROQ_PUBLISHED_MODELS: &[&str] = &[
    "canopylabs/orpheus-arabic-saudi",
    "canopylabs/orpheus-v1-english",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-safeguard-20b",
    "qwen/qwen3.8-27b",
    "whisper-large-v3",
    "whisper-large-v3-turbo",
];

/// Which plan's table applies, inferred from live daily-request ceilings.
pub fn groq_plan_of(
    live: &std::collections::BTreeMap<String, crate::usage_ledger::LiveReading>,
    key_id: &str,
) -> &'static str {
    let above_free = live.values().any(|reading| {
        reading.key_id.as_deref() == Some(key_id)
            && reading.host.as_deref() == Some("api.groq.com")
            && reading.limits.requests.as_ref().is_some_and(|requests| {
                let free =
                    groq_published_limits(reading.model.as_deref().unwrap_or_default(), "free");
                free.get("RPD").is_some_and(|limit| requests.limit > *limit)
            })
    });
    if above_free {
        "developer"
    } else {
        "free"
    }
}
