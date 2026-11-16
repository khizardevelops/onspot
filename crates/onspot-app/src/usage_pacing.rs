// SPDX-License-Identifier: AGPL-3.0-or-later

//! Keeps LLM requests inside a provider's rate limits instead of running into
//! them, and moves on to another model when one is out of room. Ported from
//! `src/lib/adapters/llm/pacing.ts`.
//!
//! Groq gives each model its own allowances per account, which refill
//! continuously: tokens a minute (8,000 for GPT-OSS on the free plan; a
//! request 2 tokens over is told to "try again in 15ms"), and for some models
//! reply tokens a minute (Qwen 3.8: 1,000, stated only in refusals). So the
//! pacing keeps its own copy of each allowance as a token bucket, charges
//! every request before it is sent, and then either waits the moment it needs
//! or sends it to the next model in the rotation that has room. A model whose
//! daily allowance is used up is skipped until it resets.
//!
//! Only limits the provider has stated are paced: a refusal's "Limit 8000,
//! Used 5483", or the `x-ratelimit-*` headers a response carries. A paid plan
//! allows far more than the published free limits, so guessing them would slow
//! it down for nothing; the first refusal costs no tokens, is retried, and
//! teaches the limit (the usage ledger keeps it for a day).
//!
//! Choosing among the models (Automatic): they arrive in order of preference,
//! and the request goes to the first that has room for it now or within the
//! caller's patience. Groq's published limits only steer that choice: a model
//! the request is expected not to fit, or whose daily allowance looks spent, is
//! tried after the others, never refused, so a plan with higher limits still
//! reaches it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use onspot_domain::LlmEndpoint;
use onspot_ports::CoreError;

use crate::events::{EventSink, PacingWait, UiEvent};
use crate::providers::{model_label, provider_name_for, url_host};
use crate::usage::{parse_rate_limit_headers, parse_refusal, LimitWindow, RateLimitHeaders};
use crate::usage_format::{format_count, format_reset};
use crate::usage_ledger::{
    hash_text, scope_key, totals_within, LedgerState, UsageLedger, UsageScope,
};
use crate::usage_limits::{groq_known_limits, groq_plan_of, ModelLimits};

/// Characters per token before a model's real ratio is known (French and JSON
/// run denser than English prose).
const DEFAULT_CHARS_PER_TOKEN: f64 = 3.4;

/// How fast a measured characters-per-token ratio follows new replies
/// (exponential moving average).
const CHARS_PER_TOKEN_SMOOTHING: f64 = 0.3;

/// How long a system message the provider served from its cache is assumed to
/// stay cached. Groq leaves cached prompt tokens out of its rate limits, and
/// the evaluation's ~2,800-token instructions are the same for every take.
const PROMPT_CACHE_MS: u64 = 10 * 60_000;

/// By default, waiting this long for the preferred model beats switching to a
/// fallback.
pub const DEFAULT_PATIENCE_MS: u64 = 3_000;

/// Waits longer than this are not worth it: the request fails with a readable
/// reason instead.
const LONGEST_WAIT_MS: u64 = 65_000;

/// Added to every computed wait, so the request lands just after the
/// allowance has refilled.
const WAIT_MARGIN_MS: f64 = 120.0;

/// Shorter waits pass unannounced; a message for them would only flash.
const ANNOUNCED_WAIT_MS: u64 = 1_000;

/// A minute allowance refills over this long.
const MINUTE_MS: f64 = 60_000.0;

/// Daily allowances are counted over this rolling window.
const DAY_MS: u64 = 24 * 60 * 60_000;

/// How long a model is skipped after a refusal that gives no time to try again.
const RETRY_LATER_MINUTE_MS: u64 = 2_000;
const RETRY_LATER_DAY_MS: u64 = 60 * 60_000;
const RETRY_LATER_SERVER_ERROR_MS: u64 = 1_500;

/// The only host whose published limits steer the model choice.
const GROQ_HOST: &str = "api.groq.com";

/// One chat request, sized for the pacing.
#[derive(Debug, Clone)]
pub struct PacingRequest<'a> {
    pub endpoint: &'a LlmEndpoint,
    /// The models to choose from, in order of preference.
    pub models: &'a [String],
    /// The request's system message, which providers cache across requests.
    pub system_message: Option<&'a str>,
    /// Length of the whole prompt in UTF-16 code units, as the driver counted
    /// it, so the learnt characters-per-token ratio carries over.
    pub prompt_chars: usize,
    /// The reply budget (`max_tokens`).
    pub max_tokens: u64,
    /// How long a wait for the preferred model is worth before a fallback is used.
    pub patience_ms: u64,
}

/// Where to send a request, and how long to wait first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestPlan {
    pub model: String,
    pub scope: UsageScope,
    pub tokens: u64,
    pub max_tokens: u64,
    pub wait_ms: u64,
}

/// A request charged to a model's allowances, until it is settled or released.
#[derive(Debug, Clone)]
pub struct Admission {
    pub scope: UsageScope,
    tokens: u64,
    /// Its reply budget, which the provider counts in full when admitting it.
    max_tokens: u64,
    /// The whole prompt's length, to learn characters per token.
    prompt_chars: usize,
    /// Its system message, noted as cached when the provider reports cached tokens.
    system_key: Option<String>,
}

/// What a completed request used, from its `usage` block.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CompletedUsage {
    pub prompt_tokens: u64,
    pub total_tokens: u64,
    /// Prompt tokens served from the provider's cache, which Groq leaves out
    /// of its rate limits.
    pub cached_tokens: u64,
}

/// What to do after a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalOutcome {
    TryAgain,
    GiveUp,
}

/// A wait being shown to the learner, until [`RequestPacer::end_wait`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaitTicket(Option<u64>);

/// One per-minute allowance of one model for one key, as a bucket that
/// drains continuously.
#[derive(Debug, Clone)]
struct TokenBucket {
    capacity: f64,
    /// Tokens charged and not yet refilled, as of `measured_at`.
    level: f64,
    measured_at: u64,
}

impl TokenBucket {
    fn level_at(&self, now: u64) -> f64 {
        let elapsed = now.saturating_sub(self.measured_at) as f64;
        let refilled = elapsed * self.capacity / MINUTE_MS;
        (self.level - refilled).max(0.0)
    }

    fn set_level(&mut self, level: f64, now: u64) {
        self.level = level.max(0.0);
        self.measured_at = now;
    }

    fn add(&mut self, tokens: f64, now: u64) {
        let level = self.level_at(now) + tokens;
        self.set_level(level, now);
    }

    /// How long until `tokens` more fit; 0 when they fit now.
    fn refill_wait(&self, tokens: f64, now: u64) -> f64 {
        let overflow = self.level_at(now) + tokens - self.capacity;
        if overflow > 0.0 {
            overflow * MINUTE_MS / self.capacity + WAIT_MARGIN_MS
        } else {
            0.0
        }
    }
}

/// What the pacing has learnt in this run. Stated limits themselves live in
/// the ledger; this is the moment-to-moment state on top of them.
#[derive(Default)]
struct PacerState {
    /// Per-minute allowances by scope key and window.
    buckets: HashMap<String, TokenBucket>,
    /// Until when a model is skipped, by scope key.
    skipped_until: HashMap<String, u64>,
    /// Models a key cannot use (not found, not enabled for it), by scope key.
    unavailable: HashSet<String>,
    /// Measured characters per prompt token, by model.
    chars_per_token: HashMap<String, f64>,
    /// When the provider last served a system message from its cache.
    cached_system_messages: HashMap<String, u64>,
    /// Announced waits, by ticket.
    waits: BTreeMap<u64, PacingWait>,
    next_wait: u64,
}

/// What it would cost to send a request to one model now.
struct ModelOption {
    model: String,
    scope: UsageScope,
    tokens: u64,
    wait_ms: u64,
    /// The request alone is larger than one of the model's stated per-minute
    /// allowances.
    too_large: bool,
    /// The request is expected to fit the model's published limits and what
    /// is left of today's.
    expected_room: bool,
}

/// The rate-limit pacing every LLM request goes through, shared by all of a
/// driver's requests so they see each other.
pub struct RequestPacer {
    ledger: Arc<UsageLedger>,
    events: Arc<dyn EventSink>,
    state: Mutex<PacerState>,
}

impl RequestPacer {
    /// Creates the pacing over the device's usage ledger.
    pub fn new(ledger: Arc<UsageLedger>, events: Arc<dyn EventSink>) -> Self {
        Self {
            ledger,
            events,
            state: Mutex::new(PacerState::default()),
        }
    }

    /// The ledger the pacing reads stated limits from, for recording calls.
    pub fn ledger(&self) -> &Arc<UsageLedger> {
        &self.ledger
    }

    /// Chooses the model for a request: the first in order of preference that
    /// has room now or within its patience, otherwise whichever has room
    /// soonest. Models expected to have no room come after the others.
    ///
    /// @returns The model and how long to wait before sending.
    /// @throws `llm.rate_limited` when no model can take it within a minute, or at all.
    pub async fn plan(
        &self,
        request: &PacingRequest<'_>,
        now: u64,
    ) -> Result<RequestPlan, CoreError> {
        let ledger = self.ledger.snapshot(now).await;
        let provider = provider_name_for(&request.endpoint.base_url);
        let mut state = self.lock();

        let available: Vec<&String> = request
            .models
            .iter()
            .filter(|model| {
                let scope = scope_of(request.endpoint, model);
                !state.unavailable.contains(&scope_key(&scope))
            })
            .collect();
        let options: Vec<ModelOption> = available
            .into_iter()
            .map(|model| state.option_for(request, model, &ledger, now))
            .collect();
        if options.is_empty() {
            let verb = if request.models.len() == 1 {
                "is"
            } else {
                "are"
            };
            return Err(rate_limited(format!(
                "{} {verb} not available on this {provider} key. Choose another model in Settings.",
                names(request.models)
            )));
        }

        let fitting: Vec<&ModelOption> =
            options.iter().filter(|option| !option.too_large).collect();
        if fitting.is_empty() {
            let first = &options[0];
            let capacity = state
                .bucket_of(&first.scope, LimitWindow::TPM, &ledger, now)
                .map(|bucket| bucket.capacity);
            let allowance = capacity.map_or(String::new(), |capacity| {
                format!(
                    ", and {provider} allows {} a minute",
                    format_count(capacity)
                )
            });
            let all_models: Vec<String> =
                options.iter().map(|option| option.model.clone()).collect();
            return Err(rate_limited(format!(
                "This request is too long for {}: it needs about {} tokens{allowance}.",
                names(&all_models),
                format_count(first.tokens as f64)
            )));
        }

        // Stable order: preference within each group.
        let ranked: Vec<&ModelOption> = fitting
            .iter()
            .filter(|option| option.expected_room)
            .chain(fitting.iter().filter(|option| !option.expected_room))
            .copied()
            .collect();
        let soonest = ranked
            .iter()
            .copied()
            .reduce(|best, option| {
                if option.wait_ms < best.wait_ms {
                    option
                } else {
                    best
                }
            })
            .expect("ranked holds every fitting option");
        let chosen = ranked
            .iter()
            .copied()
            .find(|option| option.wait_ms <= request.patience_ms)
            .unwrap_or(soonest);

        if chosen.wait_ms > LONGEST_WAIT_MS {
            let fitting_models: Vec<String> =
                fitting.iter().map(|option| option.model.clone()).collect();
            return Err(rate_limited(format!(
                "{provider}'s limits for {} are used up for now; they reset {}. Try again then, or choose another provider in Settings.",
                names(&fitting_models),
                format_reset(now + chosen.wait_ms, now)
            )));
        }

        Ok(RequestPlan {
            model: chosen.model.clone(),
            scope: chosen.scope.clone(),
            tokens: chosen.tokens,
            max_tokens: request.max_tokens,
            wait_ms: chosen.wait_ms,
        })
    }

    /// Charges a request to its model's allowances right before it is sent,
    /// so requests planned at the same time see each other.
    pub fn admit(&self, plan: &RequestPlan, request: &PacingRequest<'_>, now: u64) -> Admission {
        let ledger = self.ledger.loaded_snapshot(now);
        let mut state = self.lock();

        state.add_to(
            &plan.scope,
            LimitWindow::TPM,
            plan.tokens as f64,
            &ledger,
            now,
        );
        state.add_to(
            &plan.scope,
            LimitWindow::OTPM,
            plan.max_tokens as f64,
            &ledger,
            now,
        );

        Admission {
            scope: plan.scope.clone(),
            tokens: plan.tokens,
            max_tokens: plan.max_tokens,
            prompt_chars: request.prompt_chars,
            system_key: system_key(request.system_message, &plan.model),
        }
    }

    /// Takes a charge back: the request never reached the provider, or was
    /// refused (refusals cost nothing).
    pub fn release(&self, admission: &Admission, now: u64) {
        let ledger = self.ledger.loaded_snapshot(now);
        self.lock().release(admission, &ledger, now);
    }

    /// Replaces a request's charges with what it really used, learns the
    /// model's characters-per-token ratio, and takes the provider's own count
    /// when its headers carry one. A reply refused after it was written
    /// (invalid JSON) reports no usage and keeps its whole charge.
    pub fn settle(
        &self,
        admission: &Admission,
        usage: &CompletedUsage,
        headers: &BTreeMap<String, String>,
        now: u64,
    ) {
        let ledger = self.ledger.loaded_snapshot(now);
        let mut state = self.lock();

        state.learn_prompt_size(admission, usage.prompt_tokens);
        if usage.cached_tokens > 0 {
            if let Some(key) = &admission.system_key {
                state.cached_system_messages.insert(key.clone(), now);
            }
        }

        let reported = usage.total_tokens > 0;
        let counted = if reported {
            usage.total_tokens.saturating_sub(usage.cached_tokens)
        } else {
            admission.tokens
        };
        let replied = if reported {
            usage.total_tokens.saturating_sub(usage.prompt_tokens)
        } else {
            admission.max_tokens
        };
        let counted_change = counted as f64 - admission.tokens as f64;
        let replied_change = replied as f64 - admission.max_tokens as f64;
        state.add_to(
            &admission.scope,
            LimitWindow::TPM,
            counted_change,
            &ledger,
            now,
        );
        state.add_to(
            &admission.scope,
            LimitWindow::OTPM,
            replied_change,
            &ledger,
            now,
        );

        let stated = parse_rate_limit_headers(&RateLimitHeaders::from_response(headers), now)
            .and_then(|limits| limits.tokens);
        let Some(stated) = stated else {
            return;
        };
        let capacity = stated.limit as f64;
        let key = bucket_key(&admission.scope, LimitWindow::TPM);
        let bucket = state.buckets.entry(key).or_insert(TokenBucket {
            capacity,
            level: 0.0,
            measured_at: now,
        });
        bucket.capacity = capacity;
        bucket.set_level(capacity - stated.remaining as f64, now);
    }

    /// Learns what a refusal says about the model's limits and decides whether
    /// another attempt (after a wait, or on another model) can succeed. Record
    /// the refusal in the ledger first, so a limit it states is picked up.
    pub fn learn_from_refusal(
        &self,
        admission: &Admission,
        status: u16,
        body: &str,
        now: u64,
    ) -> RefusalOutcome {
        let ledger = self.ledger.loaded_snapshot(now);
        let mut state = self.lock();
        state.release(admission, &ledger, now);
        let key = scope_key(&admission.scope);

        if is_unavailable_model(status, body) {
            state.unavailable.insert(key);
            return RefusalOutcome::TryAgain;
        }
        if status >= 500 {
            state
                .skipped_until
                .insert(key, now + RETRY_LATER_SERVER_ERROR_MS);
            return RefusalOutcome::TryAgain;
        }
        if status != 429 && status != 413 {
            return RefusalOutcome::GiveUp;
        }

        let refusal = parse_refusal(body, now);
        match refusal.as_ref().map(|refusal| refusal.window) {
            Some(window @ (LimitWindow::TPM | LimitWindow::OTPM)) => {
                // The refusal's "Requested" is not used to size prompts: it
                // leaves cached tokens out.
                let used = refusal.as_ref().and_then(|refusal| refusal.used);
                if let (Some(used), Some(bucket_key)) = (
                    used,
                    state.bucket_key_of(&admission.scope, window, &ledger, now),
                ) {
                    if let Some(bucket) = state.buckets.get_mut(&bucket_key) {
                        bucket.set_level(used as f64, now);
                    }
                }
            }
            Some(LimitWindow::RPD | LimitWindow::TPD) => {
                let retry_at = refusal.as_ref().and_then(|refusal| refusal.retry_at);
                state
                    .skipped_until
                    .insert(key, retry_at.unwrap_or(now + RETRY_LATER_DAY_MS));
            }
            _ => {
                let retry_at = refusal.as_ref().and_then(|refusal| refusal.retry_at);
                state
                    .skipped_until
                    .insert(key, retry_at.unwrap_or(now + RETRY_LATER_MINUTE_MS));
            }
        }
        RefusalOutcome::TryAgain
    }

    /// Announces a wait long enough to notice, so the learner sees why
    /// feedback paused instead of a screen that looks stuck.
    pub fn begin_wait(
        &self,
        endpoint: &LlmEndpoint,
        model: &str,
        wait_ms: u64,
        now: u64,
    ) -> WaitTicket {
        if wait_ms < ANNOUNCED_WAIT_MS {
            return WaitTicket(None);
        }

        let wait = PacingWait {
            provider: provider_name_for(&endpoint.base_url),
            model: model.to_owned(),
            until: now + wait_ms,
        };
        let longest = {
            let mut state = self.lock();
            let ticket = state.next_wait;
            state.next_wait += 1;
            state.waits.insert(ticket, wait);
            let longest = state.longest_wait();
            (ticket, longest)
        };
        self.events
            .emit(&UiEvent::PacingWaitChanged { wait: longest.1 });
        WaitTicket(Some(longest.0))
    }

    /// Ends a wait [`begin_wait`](Self::begin_wait) announced.
    pub fn end_wait(&self, ticket: WaitTicket) {
        let Some(ticket) = ticket.0 else {
            return;
        };
        let longest = {
            let mut state = self.lock();
            state.waits.remove(&ticket);
            state.longest_wait()
        };
        self.events
            .emit(&UiEvent::PacingWaitChanged { wait: longest });
    }

    fn lock(&self) -> MutexGuard<'_, PacerState> {
        // A panic while holding the lock leaves plain data behind; keep using it.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl PacerState {
    fn option_for(
        &mut self,
        request: &PacingRequest<'_>,
        model: &str,
        ledger: &LedgerState,
        now: u64,
    ) -> ModelOption {
        let scope = scope_of(request.endpoint, model);
        let tokens = self.request_tokens(request, model, now);
        let max_tokens = request.max_tokens as f64;

        let all_tokens = self
            .bucket_key_of(&scope, LimitWindow::TPM, ledger, now)
            .and_then(|key| self.buckets.get(&key).cloned());
        let reply_tokens = self
            .bucket_key_of(&scope, LimitWindow::OTPM, ledger, now)
            .and_then(|key| self.buckets.get(&key).cloned());

        let skipped_until = self
            .skipped_until
            .get(&scope_key(&scope))
            .copied()
            .unwrap_or(0);
        let skip_wait = skipped_until.saturating_sub(now) as f64;
        let all_wait = all_tokens
            .as_ref()
            .map_or(0.0, |bucket| bucket.refill_wait(tokens as f64, now));
        let reply_wait = reply_tokens
            .as_ref()
            .map_or(0.0, |bucket| bucket.refill_wait(max_tokens, now));
        let wait_ms = all_wait.max(reply_wait).max(skip_wait).ceil() as u64;

        let too_large = all_tokens
            .as_ref()
            .is_some_and(|bucket| tokens as f64 > bucket.capacity)
            || reply_tokens
                .as_ref()
                .is_some_and(|bucket| max_tokens > bucket.capacity);
        let expected_room = has_expected_room(&scope, tokens, request.max_tokens, ledger, now);

        ModelOption {
            model: model.to_owned(),
            scope,
            tokens,
            wait_ms,
            too_large,
            expected_room,
        }
    }

    /// How many tokens the provider will count a request as when admitting it:
    /// the prompt (estimated from its length, without a system message it has
    /// cached) plus the whole reply budget.
    fn request_tokens(&self, request: &PacingRequest<'_>, model: &str, now: u64) -> u64 {
        let ratio = self
            .chars_per_token
            .get(model)
            .copied()
            .unwrap_or(DEFAULT_CHARS_PER_TOKEN);

        let system_cached = system_key(request.system_message, model)
            .and_then(|key| self.cached_system_messages.get(&key).copied())
            .is_some_and(|cached_at| now.saturating_sub(cached_at) < PROMPT_CACHE_MS);
        let cached_chars = if system_cached {
            request.system_message.map_or(0, utf16_length)
        } else {
            0
        };
        let counted_chars = request.prompt_chars.saturating_sub(cached_chars);

        (counted_chars as f64 / ratio).ceil() as u64 + request.max_tokens
    }

    /// The key of a model's bucket for one window, sized by the limit the
    /// provider last stated (a refusal outranks headers: it names the window it
    /// hit; headers only ever describe all tokens). `None` while no limit is
    /// known and no bucket exists yet.
    fn bucket_key_of(
        &mut self,
        scope: &UsageScope,
        window: LimitWindow,
        ledger: &LedgerState,
        now: u64,
    ) -> Option<String> {
        let key = bucket_key(scope, window);
        let scope_id = scope_key(scope);
        let stated = ledger
            .reported
            .get(&scope_id)
            .and_then(|windows| windows.get(&window))
            .map(|reading| reading.limit);
        let header_limit = if window == LimitWindow::TPM {
            ledger
                .live
                .get(&scope_id)
                .and_then(|reading| reading.limits.tokens.as_ref())
                .map(|tokens| tokens.limit)
        } else {
            None
        };

        match stated.or(header_limit).filter(|capacity| *capacity > 0) {
            Some(capacity) => {
                let bucket = self.buckets.entry(key.clone()).or_insert(TokenBucket {
                    capacity: capacity as f64,
                    level: 0.0,
                    measured_at: now,
                });
                bucket.capacity = capacity as f64;
                Some(key)
            }
            None => self.buckets.contains_key(&key).then_some(key),
        }
    }

    fn bucket_of(
        &mut self,
        scope: &UsageScope,
        window: LimitWindow,
        ledger: &LedgerState,
        now: u64,
    ) -> Option<TokenBucket> {
        self.bucket_key_of(scope, window, ledger, now)
            .and_then(|key| self.buckets.get(&key).cloned())
    }

    fn add_to(
        &mut self,
        scope: &UsageScope,
        window: LimitWindow,
        tokens: f64,
        ledger: &LedgerState,
        now: u64,
    ) {
        if let Some(key) = self.bucket_key_of(scope, window, ledger, now) {
            if let Some(bucket) = self.buckets.get_mut(&key) {
                bucket.add(tokens, now);
            }
        }
    }

    fn release(&mut self, admission: &Admission, ledger: &LedgerState, now: u64) {
        self.add_to(
            &admission.scope,
            LimitWindow::TPM,
            -(admission.tokens as f64),
            ledger,
            now,
        );
        self.add_to(
            &admission.scope,
            LimitWindow::OTPM,
            -(admission.max_tokens as f64),
            ledger,
            now,
        );
    }

    /// Learns the model's characters per prompt token from a prompt whose
    /// token count the provider stated.
    fn learn_prompt_size(&mut self, admission: &Admission, prompt_tokens: u64) {
        if prompt_tokens == 0 {
            return;
        }
        let model = admission.scope.model.clone();
        let measured = admission.prompt_chars as f64 / prompt_tokens as f64;
        let previous = self
            .chars_per_token
            .get(&model)
            .copied()
            .unwrap_or(measured);
        let smoothed = previous + (measured - previous) * CHARS_PER_TOKEN_SMOOTHING;
        self.chars_per_token.insert(model, smoothed);
    }

    fn longest_wait(&self) -> Option<PacingWait> {
        self.waits.values().max_by_key(|wait| wait.until).cloned()
    }
}

/// Which key, provider and model a request is charged to.
pub fn scope_of(endpoint: &LlmEndpoint, model: &str) -> UsageScope {
    UsageScope {
        host: url_host(&endpoint.base_url).to_owned(),
        model: model.to_owned(),
        key_id: endpoint.key_id.clone(),
    }
}

/// Length in UTF-16 code units, the unit the driver's `.length` counts.
pub fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

fn bucket_key(scope: &UsageScope, window: LimitWindow) -> String {
    let window_name = match window {
        LimitWindow::OTPM => "OTPM",
        _ => "TPM",
    };
    format!("{}|{window_name}", scope_key(scope))
}

/// Identifies a request's system message for one model; `None` without one.
fn system_key(system_message: Option<&str>, model: &str) -> Option<String> {
    system_message.map(|content| format!("{model}|{}", hash_text(content)))
}

/// The limits Groq is known to set for a model on this key's plan; none for
/// other providers.
fn expected_limits(scope: &UsageScope, ledger: &LedgerState) -> ModelLimits {
    if scope.host != GROQ_HOST {
        return ModelLimits::new();
    }
    groq_known_limits(&scope.model, groq_plan_of(&ledger.live, &scope.key_id))
}

/// Whether a request is expected to fit a model: within each per-minute
/// allowance on its own, and within what is left of today's requests and
/// tokens. Today's use is the live header count where the response carried
/// one, otherwise what this device sent in the last 24 hours.
fn has_expected_room(
    scope: &UsageScope,
    tokens: u64,
    max_tokens: u64,
    ledger: &LedgerState,
    now: u64,
) -> bool {
    let limits = expected_limits(scope, ledger);
    let limit = |window: &str| limits.get(window).copied().unwrap_or(u64::MAX);
    let fits_minute = tokens <= limit("TPM") && max_tokens <= limit("OTPM");

    let sent_today = totals_within(&ledger.calls, scope, DAY_MS, now);
    let live_requests = ledger
        .live
        .get(&scope_key(scope))
        .and_then(|reading| reading.limits.requests.as_ref())
        .filter(|requests| requests.resets_at.unwrap_or(u64::MAX) > now);
    let requests_left = match live_requests {
        Some(requests) => requests.remaining as i128,
        None => limit("RPD") as i128 - sent_today.requests as i128,
    };
    let tokens_left = limit("TPD") as i128 - sent_today.tokens as i128;

    fits_minute && requests_left >= 1 && tokens_left >= tokens as i128
}

/// The model does not exist, was retired, or is not enabled for this key.
fn is_unavailable_model(status: u16, body: &str) -> bool {
    if status == 404 {
        return true;
    }
    status == 403 && body.to_lowercase().contains("model")
}

fn names(models: &[String]) -> String {
    models
        .iter()
        .map(|model| model_label(model))
        .collect::<Vec<_>>()
        .join(", ")
}

fn rate_limited(message: String) -> CoreError {
    CoreError::new("llm.rate_limited", message)
}

#[cfg(test)]
mod tests;
