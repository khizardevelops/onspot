// SPDX-License-Identifier: AGPL-3.0-or-later

//! onspot's core: the use cases and the state they own.
//!
//! Core crates know nothing about a driver. A driver boots one [`Core`], hands
//! it an [`EventSink`], and reaches it only through `onspot-bridge`.

pub mod core;
pub mod evaluation;
pub mod events;
pub mod export;
pub mod export_validate;
pub mod history;
pub mod host_rpc;
pub mod hosts;
pub mod insights;
pub mod language;
pub mod language_download;
pub mod onboarding;
pub mod portability;
pub mod practice;
pub mod prompts;
pub mod providers;
pub mod reminders;
pub mod settings;
pub mod sync;
pub mod sync_policy;
pub mod usage;
pub mod usage_format;
pub mod usage_ledger;
pub mod usage_limits;
pub mod usage_monitor;

pub use core::{Core, CoreConfig};
pub use evaluation::{EvaluateAttempt, EvaluatorPort, TestLlmConnection};
pub use events::{EventSink, UiEvent};
pub use export::{build_session_markdown, export_timestamp, session_file_stem};
pub use export_validate::{is_onspot_database, is_sqlite_database};
pub use history::{HistoryError, HistoryService, HistorySession};
pub use host_rpc::HostRpc;
pub use hosts::HostAdapters;
pub use insights::{compute_insights, InsightsData, Pattern};
pub use language::{
    catalog, default_language_id, default_voice, language, plan_language_data, resource_level,
    voices_for, Catalog, InstructionLanguage, Language, LanguageParts, LanguagePlan,
    LanguagePlanInput, PendingBytes, Voice,
};
pub use language_download::{LanguageDownloadSnapshot, RunLanguageDownload};
pub use onboarding::{parse_onboarding_status, should_offer_onboarding, OnboardingStatus};
pub use portability::{
    backup_date, backup_file_name, ExportDatabase, ExportDatabaseResult, PickRestore,
    RestoreDatabase, StagedRestore,
};
pub use practice::{
    AttemptView, PracticeConfig, PracticePhase, PracticePorts, PracticeSnapshot, PromptView,
    RunPracticeSession,
};
pub use prompts::{
    catalogue_prompts_for, english_prompt_text_by_title, prompt_catalogue, CataloguePrompt,
};
pub use reminders::{
    is_reminder_due, reminder_state, ReminderFrequency, ReminderInput, ReminderState,
};
pub use settings::{AppSettings, LoadedSettings, PatchedSettings, SettingsService, VoiceTuning};
pub use sync::{run_sync, SyncOutcome, SyncRequest};
pub use sync_policy::{
    compare_sync, decide_sync, decide_with_choice, RemoteFile, SyncChoice, SyncComparison,
    SyncDecision, SyncMetadata,
};
pub use usage::{
    parse_duration, parse_rate_limit_headers, parse_refusal, HeaderBudget, HeaderLimits,
    LimitWindow, RateLimitHeaders, RefusalLimit,
};
pub use usage_format::{
    format_count, format_duration, format_portion, format_quantity, format_reset, UsageUnit,
};
pub use usage_ledger::{
    key_id, prune, scope_key, totals_within, CallTotals, LedgerState, LiveReading, ReportedReading,
    UsageEntry, UsageScope,
};
pub use usage_limits::{
    groq_known_limits, groq_plan_of, groq_published_limits, ModelLimits, GROQ_PUBLISHED_MODELS,
};
pub use usage_monitor::{usage_snapshot, UsageInput, UsageSnapshot};

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-app");
    }
}
