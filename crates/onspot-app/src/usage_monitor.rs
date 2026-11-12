// SPDX-License-Identifier: AGPL-3.0-or-later

//! The usage monitor, ported from `src/lib/usage/monitor.ts`.
//!
//! Account probes stay driver-side; their readings and the resolved settings
//! arrive here, so keys never cross into the core.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::usage::{HeaderBudget, LimitWindow};
use crate::usage_format::{
    format_count, format_duration, format_quantity, format_reset, UsageUnit,
};
use crate::usage_ledger::{scope_key, totals_within, LedgerState, UsageScope};
use crate::usage_limits::{
    groq_plan_of, groq_published_limits, ModelLimits, GROQ_PUBLISHED_MODELS,
};

const MINUTE_MS: u64 = 60_000;
const HOUR_MS: u64 = 60 * MINUTE_MS;
const DAY_MS: u64 = 24 * HOUR_MS;
const DEFAULT_TOKENS_PER_TAKE: f64 = 2_500.0;
const DEFAULT_RESERVED_TOKENS_PER_TAKE: f64 = 4_850.0;
const MIN_TAKE_TOKENS: u64 = 600;
const DEFAULT_CHARACTERS_PER_READ: f64 = 150.0;
const LOW_REMAINING_SHARE: f64 = 0.1;
const FEW_TAKES: f64 = 5.0;
const GROQ_HOST: &str = "api.groq.com";
const OPENAI_HOST: &str = "api.openai.com";
const ELEVENLABS_HOST: &str = "api.elevenlabs.io";
const GROQ_LIMITS_CHECKED: &str = "2026-10-30";
const GROQ_WHISPER_MODEL: &str = "whisper-large-v3-turbo";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevenLabsSubscription {
    pub tier: String,
    #[serde(rename = "characterCount")]
    pub character_count: f64,
    #[serde(rename = "characterLimit")]
    pub character_limit: f64,
    #[serde(rename = "resetsAt")]
    pub resets_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeepSeekBalance {
    pub currency: String,
    pub total: f64,
    pub granted: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeepSeekAccount {
    #[serde(rename = "isAvailable")]
    pub is_available: bool,
    pub balances: Vec<DeepSeekBalance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountReading<T> {
    #[serde(rename = "keyId")]
    pub key_id: String,
    pub data: Option<T>,
    pub error: Option<String>,
    pub loading: bool,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: Option<u64>,
}

/// Everything the core needs to render the meter without holding keys.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInput {
    pub stt_mode: String,
    pub correction_mode: String,
    pub llm_provider: String,
    pub llm_host: String,
    pub llm_model: String,
    #[serde(default)]
    pub llm_fallback_models: Vec<String>,
    pub llm_key_id: String,
    pub tts_mode: String,
    pub tts_cloud_provider: String,
    pub tts_host: String,
    pub tts_model: String,
    pub tts_key_id: String,
    pub groq_key_id: String,
    pub deepseek_key_id: String,
    pub elevenlabs_key_id: String,
    pub is_tauri: bool,
    pub now: u64,
    #[serde(default)]
    pub ledger: LedgerState,
    #[serde(default)]
    pub elevenlabs: Option<AccountReading<ElevenLabsSubscription>>,
    #[serde(default)]
    pub deepseek: Option<AccountReading<DeepSeekAccount>>,
    #[serde(default)]
    pub groq_models: Vec<String>,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsedSource {
    Account,
    Live,
    Reported,
    Counted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LimitSource {
    Account,
    Live,
    Reported,
    Published,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageMeter {
    pub label: String,
    pub unit: UsageUnit,
    pub used: f64,
    pub limit: f64,
    pub used_source: UsedSource,
    pub limit_source: LimitSource,
    pub observed_at: Option<u64>,
    pub resets_at: Option<u64>,
    pub span: String,
    pub period: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWarning {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageView {
    pub meters: Vec<UsageMeter>,
    pub estimate: Option<String>,
    pub notes: Vec<String>,
    pub warnings: Vec<UsageWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    #[serde(flatten)]
    pub view: UsageView,
    pub model: String,
    pub label: String,
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceUsage {
    pub capability: String,
    pub provider: String,
    pub subject: String,
    pub scope: String,
    pub models: Vec<ModelUsage>,
    pub meters: Vec<UsageMeter>,
    pub estimate: Option<String>,
    pub notes: Vec<String>,
    pub warnings: Vec<UsageWarning>,
    pub balance: Option<String>,
    pub dashboard: Option<Dashboard>,
    pub loading: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dashboard {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub services: Vec<ServiceUsage>,
    pub warnings: Vec<UsageWarning>,
    pub accounts_loading: bool,
    pub accounts_read_at: Option<u64>,
}

struct WindowSpec {
    label: &'static str,
    unit: UsageUnit,
    span_ms: u64,
    span: &'static str,
    period: &'static str,
}

fn window_spec(window: LimitWindow) -> WindowSpec {
    match window {
        LimitWindow::RPM => WindowSpec {
            label: "Requests per minute",
            unit: UsageUnit::Requests,
            span_ms: MINUTE_MS,
            span: "per minute",
            period: "this minute",
        },
        LimitWindow::RPD => WindowSpec {
            label: "Requests today",
            unit: UsageUnit::Requests,
            span_ms: DAY_MS,
            span: "rolling 24 hours",
            period: "today",
        },
        LimitWindow::TPM => WindowSpec {
            label: "Tokens per minute",
            unit: UsageUnit::Tokens,
            span_ms: MINUTE_MS,
            span: "per minute",
            period: "this minute",
        },
        LimitWindow::OTPM => WindowSpec {
            label: "Reply tokens per minute",
            unit: UsageUnit::Tokens,
            span_ms: MINUTE_MS,
            span: "per minute",
            period: "this minute",
        },
        LimitWindow::TPD => WindowSpec {
            label: "Tokens today",
            unit: UsageUnit::Tokens,
            span_ms: DAY_MS,
            span: "rolling 24 hours",
            period: "today",
        },
        LimitWindow::ASH => WindowSpec {
            label: "Audio this hour",
            unit: UsageUnit::Seconds,
            span_ms: HOUR_MS,
            span: "rolling hour",
            period: "this hour",
        },
        LimitWindow::ASD => WindowSpec {
            label: "Audio today",
            unit: UsageUnit::Seconds,
            span_ms: DAY_MS,
            span: "rolling 24 hours",
            period: "today",
        },
    }
}

fn measure(window: LimitWindow, totals: &crate::usage_ledger::CallTotals) -> f64 {
    match window {
        LimitWindow::RPM | LimitWindow::RPD => totals.requests as f64,
        LimitWindow::TPM | LimitWindow::OTPM | LimitWindow::TPD => totals.tokens as f64,
        LimitWindow::ASH | LimitWindow::ASD => totals.audio_seconds,
    }
}

struct ModelContext<'a> {
    state: &'a LedgerState,
    scope: UsageScope,
    published: ModelLimits,
    now: u64,
}

fn live_budget<'a>(
    state: &'a LedgerState,
    scope: &UsageScope,
    window: LimitWindow,
) -> Option<(&'a crate::usage_ledger::LiveReading, &'a HeaderBudget)> {
    let live = state.live.get(&scope_key(scope))?;
    let (requests, tokens) = if scope.host == GROQ_HOST {
        (LimitWindow::RPD, LimitWindow::TPM)
    } else {
        (LimitWindow::RPM, LimitWindow::TPM)
    };
    if requests == window {
        live.limits.requests.as_ref().map(|budget| (live, budget))
    } else if tokens == window {
        live.limits.tokens.as_ref().map(|budget| (live, budget))
    } else {
        None
    }
}

fn window_meter(window: LimitWindow, context: &ModelContext<'_>) -> Option<UsageMeter> {
    let spec = window_spec(window);
    let key = scope_key(&context.scope);
    let now = context.now;

    if let Some((live, budget)) = live_budget(context.state, &context.scope, window) {
        let refill = budget.limit as f64 / spec.span_ms as f64;
        let used_at_reading = budget.limit.saturating_sub(budget.remaining) as f64;
        let used =
            (used_at_reading - (now.saturating_sub(live.observed_at) as f64) * refill).max(0.0);
        return Some(UsageMeter {
            label: spec.label.to_owned(),
            unit: spec.unit,
            used,
            limit: budget.limit as f64,
            used_source: UsedSource::Live,
            limit_source: LimitSource::Live,
            observed_at: Some(live.observed_at),
            resets_at: (used > 0.0).then_some(now + (used / refill) as u64),
            span: spec.span.to_owned(),
            period: spec.period.to_owned(),
        });
    }

    let reported = context
        .state
        .reported
        .get(&key)
        .and_then(|windows| windows.get(&window));
    let limit = reported
        .map(|reading| reading.limit)
        .or_else(|| context.published.get(window_name(window)).copied())? as f64;
    let totals = totals_within(&context.state.calls, &context.scope, spec.span_ms, now);
    let mut used = measure(window, &totals);
    let mut used_source = UsedSource::Counted;
    let mut resets_at = None;

    if let Some(reported) = reported {
        if reported.used.is_some() && now.saturating_sub(reported.observed_at) < spec.span_ms {
            let refill = reported.limit as f64 / spec.span_ms as f64;
            let reported_now = (reported.used.unwrap_or_default() as f64
                - now.saturating_sub(reported.observed_at) as f64 * refill)
                .max(0.0);
            if reported_now > used {
                used = reported_now;
                used_source = UsedSource::Reported;
                resets_at = reported.retry_at;
            }
        }
    }

    Some(UsageMeter {
        label: spec.label.to_owned(),
        unit: spec.unit,
        used: used.min(limit),
        limit,
        used_source,
        limit_source: if reported.is_some() {
            LimitSource::Reported
        } else {
            LimitSource::Published
        },
        observed_at: if used_source == UsedSource::Reported {
            reported.map(|reading| reading.observed_at)
        } else {
            None
        },
        resets_at,
        span: spec.span.to_owned(),
        period: spec.period.to_owned(),
    })
}

fn window_name(window: LimitWindow) -> &'static str {
    match window {
        LimitWindow::RPM => "RPM",
        LimitWindow::RPD => "RPD",
        LimitWindow::TPM => "TPM",
        LimitWindow::OTPM => "OTPM",
        LimitWindow::TPD => "TPD",
        LimitWindow::ASH => "ASH",
        LimitWindow::ASD => "ASD",
    }
}

fn remaining(meter: Option<&UsageMeter>) -> f64 {
    meter.map_or(f64::INFINITY, |meter| (meter.limit - meter.used).max(0.0))
}

fn find_meter<'a>(meters: &'a [UsageMeter], label: &str) -> Option<&'a UsageMeter> {
    meters.iter().find(|meter| meter.label == label)
}

fn unit_noun(unit: UsageUnit) -> &'static str {
    match unit {
        UsageUnit::Requests => "requests",
        UsageUnit::Tokens => "tokens",
        UsageUnit::Seconds => "audio",
        UsageUnit::Characters => "characters",
    }
}

fn amount_of(value: f64, unit: UsageUnit) -> String {
    if unit == UsageUnit::Seconds {
        format!("{} of audio", format_duration(value))
    } else {
        format_quantity(value, unit)
    }
}

fn meter_warnings(provider: &str, meters: &[UsageMeter], now: u64) -> Vec<UsageWarning> {
    let mut warnings = Vec::new();
    for meter in meters {
        let left = remaining(Some(meter));
        let reset = meter
            .resets_at
            .map(|at| format!(" It refills {}.", format_reset(at, now)))
            .unwrap_or_default();
        if left <= 0.0 {
            warnings.push(UsageWarning {
                level: String::from("error"),
                message: format!(
                    "{provider}: no {} left {}.{reset}",
                    unit_noun(meter.unit),
                    meter.period
                ),
            });
        } else if left / meter.limit < LOW_REMAINING_SHARE {
            warnings.push(UsageWarning {
                level: String::from("warning"),
                message: format!(
                    "{provider}: only {} left {}.{reset}",
                    amount_of(left, meter.unit),
                    meter.period
                ),
            });
        }
    }
    warnings
}

fn tokens_per_take(state: &LedgerState, scope: &UsageScope, now: u64) -> (f64, f64) {
    let takes: Vec<_> = state
        .calls
        .iter()
        .filter(|call| {
            call.key_id == scope.key_id
                && call.host == scope.host
                && call.model == scope.model
                && call.tokens >= MIN_TAKE_TOKENS
                && now.saturating_sub(call.at) < DAY_MS
        })
        .collect();
    let measured: Vec<_> = takes
        .iter()
        .filter(|call| call.reserved_tokens > 0)
        .collect();
    let used = if takes.is_empty() {
        DEFAULT_TOKENS_PER_TAKE
    } else {
        takes.iter().map(|call| call.tokens as f64).sum::<f64>() / takes.len() as f64
    };
    let reserved = if measured.is_empty() {
        DEFAULT_RESERVED_TOKENS_PER_TAKE
    } else {
        measured
            .iter()
            .map(|call| call.reserved_tokens as f64)
            .sum::<f64>()
            / measured.len() as f64
    };
    (used.round(), reserved.round())
}

struct TakeEstimate {
    text: Option<String>,
    warning: Option<UsageWarning>,
}

fn chat_take_estimate(model: &str, meters: &[UsageMeter], take: (f64, f64)) -> TakeEstimate {
    let tokens_per_minute = find_meter(meters, "Tokens per minute").map(|meter| meter.limit);
    let per_take = take.0;
    if let Some(limit) = tokens_per_minute {
        if limit < take.1 {
            let allowed = format_count(limit);
            return TakeEstimate {
                text: Some(format!("Groq sets aside about {} tokens for each take, but this model allows only {allowed} a minute, so takes are refused.", format_count(take.1))),
                warning: Some(UsageWarning { level: String::from("error"), message: format!("Groq {model} allows {allowed} tokens a minute, less than one take needs. Choose Automatic in Settings → LLM.") }),
            };
        }
    }
    let takes_by_tokens = (remaining(find_meter(meters, "Tokens today")) / per_take).floor();
    let takes_by_requests = remaining(find_meter(meters, "Requests today"));
    let takes_left = takes_by_tokens.min(takes_by_requests);
    if !takes_left.is_finite() {
        return TakeEstimate {
            text: None,
            warning: None,
        };
    }
    let count = format_count(takes_left);
    let plural = if takes_left == 1.0 { "" } else { "s" };
    let per_minute =
        tokens_per_minute
            .filter(|limit| *limit > 0.0)
            .map_or(String::new(), |limit| {
                format!(
                    ", up to {} a minute",
                    format_count(((limit - take.1) / per_take).floor() + 1.0)
                )
            });
    TakeEstimate {
        text: Some(format!(
            "Enough for about {count} more take{plural} today{per_minute}, at {} tokens a take.",
            format_count(per_take)
        )),
        warning: (takes_left < FEW_TAKES).then(|| UsageWarning {
            level: String::from("warning"),
            message: format!("Groq: about {count} take{plural} left today on {model}."),
        }),
    }
}

fn speech_estimate(meters: &[UsageMeter]) -> TakeEstimate {
    let today = remaining(find_meter(meters, "Audio today"));
    let hour = remaining(find_meter(meters, "Audio this hour"));
    if !today.is_finite() {
        return TakeEstimate {
            text: None,
            warning: None,
        };
    }
    let hour_part = if hour < today {
        format!(", {} of it this hour", format_duration(hour))
    } else {
        String::new()
    };
    TakeEstimate {
        text: Some(format!(
            "About {} of speech left today{hour_part}.",
            format_duration(today)
        )),
        warning: None,
    }
}

fn groq_label(model: &str, labels: &BTreeMap<String, String>) -> String {
    labels
        .get(model)
        .cloned()
        .or_else(|| match model {
            "whisper-large-v3" => Some(String::from("Whisper Large v3")),
            "whisper-large-v3-turbo" => Some(String::from("Whisper Large v3 Turbo")),
            _ => None,
        })
        .unwrap_or_else(|| model.rsplit('/').next().unwrap_or(model).to_owned())
}

fn is_chat_model(model: &str) -> bool {
    !model.starts_with("whisper-") && !model.starts_with("canopylabs/")
}

struct GroqContext<'a> {
    state: &'a LedgerState,
    key_id: &'a str,
    plan: &'a str,
    now: u64,
    labels: &'a BTreeMap<String, String>,
}

fn groq_model_usage(
    model: &str,
    speech: bool,
    in_use: bool,
    context: &GroqContext<'_>,
) -> ModelUsage {
    let scope = UsageScope {
        host: GROQ_HOST.to_owned(),
        model: model.to_owned(),
        key_id: context.key_id.to_owned(),
    };
    let model_context = ModelContext {
        state: context.state,
        scope: scope.clone(),
        published: groq_published_limits(model, context.plan),
        now: context.now,
    };
    let windows: &[LimitWindow] = if speech {
        &[LimitWindow::ASD, LimitWindow::ASH, LimitWindow::RPD]
    } else {
        &[LimitWindow::TPD, LimitWindow::RPD, LimitWindow::TPM]
    };
    let meters: Vec<_> = windows
        .iter()
        .filter_map(|window| window_meter(*window, &model_context))
        .collect();
    let mut warnings = meter_warnings(
        if speech {
            "Groq speech-to-text"
        } else {
            "Groq"
        },
        &meters,
        context.now,
    );
    let estimate = if speech {
        speech_estimate(&meters)
    } else {
        chat_take_estimate(
            model,
            &meters,
            tokens_per_take(context.state, &scope, context.now),
        )
    };
    let adds_news = estimate
        .warning
        .as_ref()
        .is_some_and(|warning| warning.level == "error")
        || warnings.is_empty();
    if let Some(warning) = estimate.warning.clone() {
        if adds_news {
            warnings.push(warning);
        }
    }

    let mut notes = Vec::new();
    if meters.is_empty() {
        notes.push(format!("Groq does not publish limits for this model (rate-limits page, checked {GROQ_LIMITS_CHECKED})."));
        let totals = totals_within(&context.state.calls, &scope, DAY_MS, context.now);
        let amount = if speech {
            amount_of(totals.audio_seconds, UsageUnit::Seconds)
        } else {
            format_quantity(totals.tokens as f64, UsageUnit::Tokens)
        };
        notes.push(format!(
            "Sent from this device in the last 24 hours: {}, {amount}.",
            format_quantity(totals.requests as f64, UsageUnit::Requests)
        ));
    } else if context.state.live.contains_key(&scope_key(&scope)) {
        notes.push(if speech { "Requests are Groq's live figures; audio is counted on this device.".to_owned() } else { "Requests and tokens per minute are Groq's live figures; tokens per day are counted on this device.".to_owned() });
    }
    if context.plan == "developer" {
        notes.push(
            "These are Developer-plan limits: Groq's live figures show this account is on it."
                .to_owned(),
        );
    }

    ModelUsage {
        view: UsageView {
            meters,
            estimate: estimate.text,
            notes,
            warnings,
        },
        model: model.to_owned(),
        label: groq_label(model, context.labels),
        in_use,
    }
}

fn candidate_warnings(candidates: &[ModelUsage]) -> Vec<UsageWarning> {
    if candidates.len() <= 1 {
        return candidates
            .first()
            .map(|model| model.view.warnings.clone())
            .unwrap_or_default();
    }
    let names: Vec<_> = candidates
        .iter()
        .map(|model| model.label.as_str())
        .collect();
    let names = names.join(", ");
    if candidates.iter().all(|model| {
        model
            .view
            .warnings
            .iter()
            .any(|warning| warning.level == "error")
    }) {
        return vec![UsageWarning {
            level: String::from("error"),
            message: format!(
                "Groq: {names} are all out of room for now. Feedback waits until one refills."
            ),
        }];
    }
    if candidates
        .iter()
        .all(|model| !model.view.warnings.is_empty())
    {
        return vec![UsageWarning {
            level: String::from("warning"),
            message: format!("Groq: little room left today on {names}."),
        }];
    }
    Vec::new()
}

fn groq_service(capability: &str, models: Vec<ModelUsage>, plan: &str) -> ServiceUsage {
    let candidates: Vec<_> = models
        .iter()
        .filter(|model| model.in_use)
        .cloned()
        .collect();
    let current = candidates
        .first()
        .cloned()
        .unwrap_or_else(|| models[0].clone());
    ServiceUsage {
        capability: capability.to_owned(),
        provider: String::from("Groq"),
        subject: format!(
            "{}-plan limits",
            if plan == "developer" {
                "Developer"
            } else {
                "Free"
            }
        ),
        scope: String::from("model"),
        models,
        meters: current.view.meters,
        estimate: current.view.estimate,
        notes: current.view.notes,
        warnings: candidate_warnings(&candidates),
        balance: None,
        dashboard: Some(Dashboard {
            label: String::from("Groq limits"),
            url: String::from("https://console.groq.com/settings/limits"),
        }),
        loading: false,
        error: None,
    }
}

fn groq_chat_service(input: &UsageInput) -> ServiceUsage {
    let in_use: Vec<String> = std::iter::once(input.llm_model.clone())
        .chain(input.llm_fallback_models.iter().cloned())
        .collect();
    let plan = groq_plan_of(&input.ledger.live, &input.groq_key_id);
    let context = GroqContext {
        state: &input.ledger,
        key_id: &input.groq_key_id,
        plan,
        now: input.now,
        labels: &input.labels,
    };
    let mut models: Vec<String> = Vec::new();
    for model in &input.groq_models {
        if is_chat_model(model) && !models.contains(model) {
            models.push(model.clone());
        }
    }
    for model in GROQ_PUBLISHED_MODELS {
        if is_chat_model(model) && !models.contains(&String::from(*model)) {
            models.push(String::from(*model));
        }
    }
    for call in &input.ledger.calls {
        if call.host == GROQ_HOST
            && call.key_id == input.groq_key_id
            && is_chat_model(&call.model)
            && !models.contains(&call.model)
        {
            models.push(call.model.clone());
        }
    }
    for model in &in_use {
        if !models.contains(model) {
            models.insert(0, model.clone());
        }
    }
    let models = models
        .into_iter()
        .map(|model| groq_model_usage(&model, false, in_use.contains(&model), &context))
        .collect();
    groq_service("LLM", models, plan)
}

fn groq_speech_service(input: &UsageInput) -> ServiceUsage {
    let plan = groq_plan_of(&input.ledger.live, &input.groq_key_id);
    let context = GroqContext {
        state: &input.ledger,
        key_id: &input.groq_key_id,
        plan,
        now: input.now,
        labels: &input.labels,
    };
    let models = vec![groq_model_usage(GROQ_WHISPER_MODEL, true, true, &context)];
    groq_service("Speech-to-text", models, plan)
}

fn live_only_service(
    capability: &str,
    provider: &str,
    scope: UsageScope,
    state: &LedgerState,
    now: u64,
    is_tauri: bool,
    dashboard: Option<Dashboard>,
) -> ServiceUsage {
    let context = ModelContext {
        state,
        scope: scope.clone(),
        published: ModelLimits::new(),
        now,
    };
    let meters: Vec<_> = [LimitWindow::RPM, LimitWindow::TPM]
        .iter()
        .filter_map(|window| window_meter(*window, &context))
        .collect();
    let mut notes = Vec::new();
    if meters.is_empty() {
        notes.push(if is_tauri { format!("{provider} has not reported limits yet; they appear after the next call.") } else { format!("Browsers cannot read {provider}'s rate limits, so they show only in the desktop and Android apps.") });
    }
    if scope.host == OPENAI_HOST {
        notes.push(String::from("OpenAI does not share your credit balance with API keys; check it on the billing page."));
    }
    ServiceUsage {
        capability: capability.to_owned(),
        provider: provider.to_owned(),
        subject: scope.model,
        scope: String::from("model"),
        models: Vec::new(),
        meters: meters.clone(),
        estimate: None,
        notes,
        warnings: meter_warnings(provider, &meters, now),
        balance: None,
        dashboard,
        loading: false,
        error: None,
    }
}

fn money(currency: &str, value: f64) -> String {
    let symbol = match currency {
        "USD" | "" => "$",
        "EUR" => "€",
        "GBP" => "£",
        _ => "",
    };
    let prefix = if symbol.is_empty() {
        format!("{currency} ")
    } else {
        symbol.to_owned()
    };
    let cents = (value * 100.0).round() as i64;
    let whole = crate::usage_format::format_count((cents / 100) as f64);
    format!("{prefix}{whole}.{:02}", cents.abs() % 100)
}

fn elevenlabs_service(input: &UsageInput) -> ServiceUsage {
    let current = input
        .elevenlabs
        .as_ref()
        .filter(|reading| reading.key_id == input.elevenlabs_key_id);
    let subscription = current.and_then(|reading| reading.data.as_ref());
    let meters = subscription
        .map(|subscription| {
            let mut meters = vec![UsageMeter {
                label: String::from("Characters this period"),
                unit: UsageUnit::Characters,
                used: subscription.character_count,
                limit: subscription.character_limit,
                used_source: UsedSource::Account,
                limit_source: LimitSource::Account,
                observed_at: current.and_then(|reading| reading.fetched_at),
                resets_at: subscription.resets_at,
                span: String::from("billing period"),
                period: String::from("this billing period"),
            }];
            meters[0].used = meters[0].used.min(meters[0].limit);
            meters
        })
        .unwrap_or_default();
    let estimate = subscription.map(|subscription| {
        let left = (subscription.character_limit - subscription.character_count).max(0.0);
        let scope = UsageScope {
            host: ELEVENLABS_HOST.to_owned(),
            model: String::from("*"),
            key_id: input.elevenlabs_key_id.clone(),
        };
        let recent = totals_within(&input.ledger.calls, &scope, DAY_MS, input.now);
        let per_read = if recent.requests > 0 {
            recent.characters as f64 / recent.requests as f64
        } else {
            DEFAULT_CHARACTERS_PER_READ
        };
        let reads_left = (left / per_read).floor();
        let until = subscription
            .resets_at
            .map(|at| format!(" before it refills {}", format_reset(at, input.now)))
            .unwrap_or_default();
        format!(
            "About {} more read-aloud{}{until}, at {} characters each.",
            format_count(reads_left),
            if reads_left == 1.0 { "" } else { "s" },
            format_count(per_read)
        )
    });
    let subject = subscription
        .map(|subscription| {
            let mut chars = subscription.tier.chars();
            format!(
                "{}{} plan",
                chars
                    .next()
                    .map(|c| c.to_uppercase().to_string())
                    .unwrap_or_default(),
                chars.as_str()
            )
        })
        .unwrap_or_else(|| String::from("Account"));
    ServiceUsage {
        capability: String::from("Text-to-speech"),
        provider: String::from("ElevenLabs"),
        subject,
        scope: String::from("account"),
        models: Vec::new(),
        meters: meters.clone(),
        estimate,
        notes: vec![String::from(
            "ElevenLabs counts characters per account, across every voice and model.",
        )],
        warnings: meter_warnings("ElevenLabs", &meters, input.now),
        balance: None,
        dashboard: Some(Dashboard {
            label: String::from("ElevenLabs subscription"),
            url: String::from("https://elevenlabs.io/app/subscription"),
        }),
        loading: current.is_some_and(|reading| reading.loading) && subscription.is_none(),
        error: current.and_then(|reading| reading.error.clone()),
    }
}

fn deepseek_service(input: &UsageInput) -> ServiceUsage {
    let current = input
        .deepseek
        .as_ref()
        .filter(|reading| reading.key_id == input.deepseek_key_id);
    let account = current.and_then(|reading| reading.data.as_ref());
    let balance = account.map(|account| {
        if account.balances.is_empty() {
            return String::from("No balance");
        }
        account
            .balances
            .iter()
            .map(|entry| {
                let granted = if entry.granted > 0.0 {
                    format!(
                        " ({} of it granted credit)",
                        money(&entry.currency, entry.granted)
                    )
                } else {
                    String::new()
                };
                format!("{} available{granted}", money(&entry.currency, entry.total))
            })
            .collect::<Vec<_>>()
            .join(" · ")
    });
    let warnings = if account.is_some_and(|account| !account.is_available) {
        vec![UsageWarning { level: String::from("error"), message: String::from("DeepSeek: the account balance cannot pay for more calls. Top it up to keep getting feedback.") }]
    } else {
        Vec::new()
    };
    ServiceUsage {
        capability: String::from("LLM"),
        provider: String::from("DeepSeek"),
        subject: input.llm_model.clone(),
        scope: String::from("account"),
        models: Vec::new(),
        meters: Vec::new(),
        estimate: None,
        notes: vec![String::from(
            "DeepSeek does not rate-limit; it charges each call to the account balance.",
        )],
        warnings,
        balance,
        dashboard: Some(Dashboard {
            label: String::from("DeepSeek usage"),
            url: String::from("https://platform.deepseek.com/usage"),
        }),
        loading: current.is_some_and(|reading| reading.loading) && account.is_none(),
        error: current.and_then(|reading| reading.error.clone()),
    }
}

fn local_service(capability: &str, subject: &str, where_: &str) -> ServiceUsage {
    ServiceUsage {
        capability: capability.to_owned(),
        provider: String::from("Local"),
        subject: subject.to_owned(),
        scope: String::from("local"),
        models: Vec::new(),
        meters: Vec::new(),
        estimate: Some(format!("No usage limits: it runs on {where_}.")),
        notes: Vec::new(),
        warnings: Vec::new(),
        balance: None,
        dashboard: None,
        loading: false,
        error: None,
    }
}

fn is_local_host(host: &str) -> bool {
    let name = host.split(':').next().unwrap_or(host);
    name == "localhost" || name == "127.0.0.1" || name == "[::1]"
}

/// Builds every step's meters, notes, estimates and warnings for one instant.
pub fn usage_snapshot(input: &UsageInput) -> UsageSnapshot {
    let mut services = Vec::new();
    services.push(if input.stt_mode == "cloud" {
        groq_speech_service(input)
    } else {
        local_service("Speech-to-text", "Whisper", "this device")
    });

    if input.correction_mode == "local" {
        services.push(local_service(
            "LLM",
            if input.llm_model.is_empty() {
                "Local model"
            } else {
                &input.llm_model
            },
            &input.llm_host,
        ));
    } else if input.llm_provider == "groq" {
        services.push(groq_chat_service(input));
    } else if input.llm_provider == "deepseek" {
        services.push(deepseek_service(input));
    } else {
        services.push(live_only_service(
            "LLM",
            &input.llm_host,
            UsageScope {
                host: input.llm_host.clone(),
                model: input.llm_model.clone(),
                key_id: input.llm_key_id.clone(),
            },
            &input.ledger,
            input.now,
            input.is_tauri,
            None,
        ));
    }

    if input.tts_mode == "local" {
        services.push(local_service("Text-to-speech", "Piper", "this device"));
    } else if input.tts_cloud_provider == "elevenlabs" {
        services.push(elevenlabs_service(input));
    } else if is_local_host(&input.tts_host) {
        services.push(local_service(
            "Text-to-speech",
            &input.tts_model,
            &input.tts_host,
        ));
    } else {
        let dashboard = (input.tts_host == OPENAI_HOST).then(|| Dashboard {
            label: String::from("OpenAI usage"),
            url: String::from("https://platform.openai.com/usage"),
        });
        services.push(live_only_service(
            "Text-to-speech",
            if input.tts_host == OPENAI_HOST {
                "OpenAI"
            } else {
                &input.tts_host
            },
            UsageScope {
                host: input.tts_host.clone(),
                model: input.tts_model.clone(),
                key_id: input.tts_key_id.clone(),
            },
            &input.ledger,
            input.now,
            input.is_tauri,
            dashboard,
        ));
    }

    let mut warnings: Vec<UsageWarning> = services
        .iter()
        .flat_map(|service| service.warnings.clone())
        .collect();
    warnings.sort_by_key(|warning| if warning.level == "error" { 0 } else { 1 });
    let read_at = [
        input
            .elevenlabs
            .as_ref()
            .and_then(|reading| reading.fetched_at),
        input
            .deepseek
            .as_ref()
            .and_then(|reading| reading.fetched_at),
    ]
    .into_iter()
    .flatten()
    .max();
    let accounts_loading = input
        .elevenlabs
        .as_ref()
        .is_some_and(|reading| reading.loading)
        || input
            .deepseek
            .as_ref()
            .is_some_and(|reading| reading.loading);
    UsageSnapshot {
        services,
        warnings,
        accounts_loading,
        accounts_read_at: read_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::{HeaderBudget, HeaderLimits};
    use crate::usage_ledger::{LiveReading, UsageEntry};

    fn input() -> UsageInput {
        UsageInput {
            stt_mode: String::from("local"),
            correction_mode: String::from("cloud"),
            llm_provider: String::from("groq"),
            llm_host: String::from(GROQ_HOST),
            llm_model: String::from("openai/gpt-oss-120b"),
            llm_fallback_models: Vec::new(),
            llm_key_id: String::from("k"),
            tts_mode: String::from("local"),
            tts_cloud_provider: String::from("elevenlabs"),
            tts_host: String::new(),
            tts_model: String::new(),
            tts_key_id: String::from("no-key"),
            groq_key_id: String::from("k"),
            deepseek_key_id: String::from("no-key"),
            elevenlabs_key_id: String::from("no-key"),
            is_tauri: true,
            now: 1_000_000,
            ledger: LedgerState::default(),
            elevenlabs: None,
            deepseek: None,
            groq_models: vec![String::from("openai/gpt-oss-120b")],
            labels: BTreeMap::new(),
        }
    }

    fn call(tokens: u64, at: u64) -> UsageEntry {
        UsageEntry {
            host: String::from(GROQ_HOST),
            model: String::from("openai/gpt-oss-120b"),
            key_id: String::from("k"),
            at,
            tokens,
            reserved_tokens: 4_850,
            audio_seconds: 0.0,
            characters: 0,
        }
    }

    #[test]
    fn counted_groq_meters_and_estimate_match_the_ts() {
        let mut input = input();
        input.ledger.calls = vec![call(3_000, input.now - 1_000)];
        let snapshot = usage_snapshot(&input);
        let llm = snapshot
            .services
            .iter()
            .find(|service| service.capability == "LLM")
            .expect("llm");
        let tokens_today = find_meter(&llm.meters, "Tokens today").expect("TPD");
        assert_eq!(
            (
                tokens_today.used,
                tokens_today.limit,
                tokens_today.used_source
            ),
            (3_000.0, 200_000.0, UsedSource::Counted)
        );
        assert_eq!(
            find_meter(&llm.meters, "Requests today").expect("RPD").used,
            1.0
        );
        assert!(llm
            .estimate
            .as_deref()
            .unwrap_or_default()
            .contains("more takes today"));
        assert_eq!(snapshot.warnings.len(), 0);
    }

    #[test]
    fn live_headers_age_forward_and_win_over_counts() {
        let mut input = input();
        input.ledger.live.insert(
            String::from("k|api.groq.com|openai/gpt-oss-120b"),
            LiveReading {
                limits: HeaderLimits {
                    requests: Some(HeaderBudget {
                        limit: 1_000,
                        remaining: 990,
                        resets_at: None,
                    }),
                    tokens: Some(HeaderBudget {
                        limit: 8_000,
                        remaining: 6_000,
                        resets_at: None,
                    }),
                },
                observed_at: input.now - 30_000,
                host: Some(String::from(GROQ_HOST)),
                model: Some(String::from("openai/gpt-oss-120b")),
                key_id: Some(String::from("k")),
            },
        );
        let snapshot = usage_snapshot(&input);
        let llm = snapshot
            .services
            .iter()
            .find(|service| service.capability == "LLM")
            .expect("llm");
        let tokens = find_meter(&llm.meters, "Tokens per minute").expect("TPM");
        assert_eq!(tokens.used_source, UsedSource::Live);
        assert_eq!(tokens.used, 0.0);
        let requests = find_meter(&llm.meters, "Requests today").expect("RPD");
        assert_eq!(requests.used_source, UsedSource::Live);
        assert!(requests.used < 10.0 && requests.used > 9.6);
    }

    #[test]
    fn low_meters_warn_and_live_readings_infer_the_paid_plan() {
        let mut input = input();
        input.ledger.calls = vec![call(198_000, input.now - 1_000)];
        let snapshot = usage_snapshot(&input);
        assert!(snapshot
            .warnings
            .iter()
            .any(|warning| warning.level == "error"));
        let llm = snapshot
            .services
            .iter()
            .find(|service| service.capability == "LLM")
            .expect("llm");
        assert_eq!(llm.subject, "Free-plan limits");

        input.ledger.live.insert(
            String::from("k|api.groq.com|openai/gpt-oss-120b"),
            LiveReading {
                limits: HeaderLimits {
                    requests: Some(HeaderBudget {
                        limit: 500_000,
                        remaining: 499_999,
                        resets_at: None,
                    }),
                    tokens: None,
                },
                observed_at: input.now,
                host: Some(String::from(GROQ_HOST)),
                model: Some(String::from("openai/gpt-oss-120b")),
                key_id: Some(String::from("k")),
            },
        );
        let llm = usage_snapshot(&input)
            .services
            .into_iter()
            .find(|service| service.capability == "LLM")
            .expect("llm");
        assert_eq!(llm.subject, "Developer-plan limits");
    }

    #[test]
    fn elevenlabs_uses_account_figures_and_counts_local_reads() {
        let mut input = input();
        input.tts_mode = String::from("cloud");
        input.tts_cloud_provider = String::from("elevenlabs");
        input.elevenlabs_key_id = String::from("e");
        input.ledger.calls = vec![UsageEntry {
            host: String::from(ELEVENLABS_HOST),
            model: String::from("eleven_multilingual_v2"),
            key_id: String::from("e"),
            at: input.now - 1_000,
            tokens: 0,
            reserved_tokens: 0,
            audio_seconds: 0.0,
            characters: 300,
        }];
        input.elevenlabs = Some(AccountReading {
            key_id: String::from("e"),
            data: Some(ElevenLabsSubscription {
                tier: String::from("creator"),
                character_count: 91_000.0,
                character_limit: 100_000.0,
                resets_at: Some(input.now + 3_600_000),
            }),
            error: None,
            loading: false,
            fetched_at: Some(input.now),
        });
        let snapshot = usage_snapshot(&input);
        let tts = snapshot
            .services
            .iter()
            .find(|service| service.capability == "Text-to-speech")
            .expect("tts");
        let meter = find_meter(&tts.meters, "Characters this period").expect("characters");
        assert_eq!(
            (meter.used, meter.limit, meter.used_source),
            (91_000.0, 100_000.0, UsedSource::Account)
        );
        assert_eq!(tts.subject, "Creator plan");
        assert!(tts
            .estimate
            .as_deref()
            .unwrap_or_default()
            .contains("30 more read-alouds"));
        assert!(snapshot
            .warnings
            .iter()
            .any(|warning| warning.level == "warning"));
    }
}
