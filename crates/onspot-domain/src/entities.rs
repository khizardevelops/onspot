// SPDX-License-Identifier: AGPL-3.0-or-later

//! The storage-facing entities moved in P2.
//!
//! Their field names match the TypeScript types in `src/lib/adapters/db/types.ts`
//! after the camelCase wire rename; the database column names stay snake_case
//! and are mapped by the repositories.

use serde::{Deserialize, Serialize};

/// How a practice session is run. Stored as the same three strings the
/// TypeScript app uses (`exam`, `casual`, `freeflow`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// What the session is practised with (migration 10). `None` on sessions
    /// from before that migration, until they are opened and worked out.
    pub setup: Option<SessionSetup>,
}

/// A session's languages and speaking setup, stored as JSON in `sessions.setup`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSetup {
    pub target_language: String,
    pub instruction_language: String,
    /// `local` or `cloud`. Kept as the stored string: history only displays it,
    /// and older rows are accepted exactly as the TypeScript app accepts them.
    pub tts_mode: String,
    pub tts_voice: String,
    pub explanation_voice: String,
    pub target_speech_pace: f64,
}

/// The fields the history screen needs from a take. The full attempt is read
/// by the practice-loop phases; history only searches transcripts and shows a
/// snippet, so it does not deserialize the JSON columns yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptPreview {
    pub id: String,
    pub session_id: String,
    pub transcript: String,
    pub duration_sec: f64,
    pub audio_key: Option<String>,
    pub created_at: String,
}

/// One persisted key/value setting row. The typed settings document is a P4
/// concern; P2 exposes the rows the legacy store reads and writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}
