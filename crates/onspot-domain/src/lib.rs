// SPDX-License-Identifier: AGPL-3.0-or-later

//! onspot's entities, value objects and domain rules.
//!
//! Pure Rust: no I/O, no async runtime, no framework types. The only allowed
//! dependencies are `serde` and `thiserror`, checked by
//! `scripts/check-boundaries.mjs`.
//!
//! P2 adds the storage-facing session, attempt, prompt, correction, audio,
//! submission and sync records the SQL repositories need. Their behaviour
//! (evaluation, translation, the usage ledger) moves in P3–P6; see
//! `docs/architecture/hexagonal-blueprint.md`.

pub mod entities;
pub mod evaluation;
pub mod records;

pub use entities::{AttemptPreview, Session, SessionSetup, Setting};
pub use evaluation::{
    ConnectorSuggestion, EvaluationCorrection, EvaluationRequest, EvaluationResult, LlmEndpoint,
    VocabularySuggestion,
};
pub use records::{
    Attempt, AudioAsset, Correction, FollowUp, GlossedRange, PhraseGloss, Prompt, PromptSubmission,
    SyncMetadata, TextGlosses, TranslationBreakdownItem, TranslationSet, WordGlosses,
};
