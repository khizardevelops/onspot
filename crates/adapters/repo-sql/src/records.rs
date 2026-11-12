// SPDX-License-Identifier: AGPL-3.0-or-later

//! The remaining typed repositories ported from `SqlDatabaseAdapter`.
//!
//! SQL matches the legacy adapter column for column. JSON columns are parsed
//! with its tolerance: malformed stored values become `None` rather than an
//! error, and hover-gloss entries with invalid shapes are dropped one by one.

use std::sync::Arc;

use async_trait::async_trait;
use onspot_domain::{
    Attempt, AudioAsset, Correction, FollowUp, GlossedRange, PhraseGloss, Prompt, PromptSubmission,
    Session, SyncMetadata, TextGlosses, TranslationBreakdownItem, TranslationSet, WordGlosses,
};
use onspot_ports::{RecordsStore, SqlDriver, SqlRow, SqlStatement, SqlValue, StoreError};

use crate::stores::{optional_text, required_text, session_from_row, text_opt, NOW_SQL};

const PROMPT_COLUMNS: &str =
    "id, title, text, category, language, instruction_language, created_at";

const ATTEMPT_COLUMNS: &str = "id, session_id, prompt_id, prompt_text, transcript, corrected_text,
     translation, translations, tts_voice, explanation, follow_up, word_glosses,
     duration_sec, word_count, audio_key, created_at, updated_at";

const SESSION_COLUMNS: &str =
    "id, title, mode, started_at, ended_at, created_at, updated_at, setup";

const CORRECTION_COLUMNS: &str = "id, attempt_id, category, severity, label, original, replacement,
     replacement_translation, start_index, end_index, explanation, speak_text,
     exam_status, formal_alternatives, sort_order, created_at";

/// Prompts, full sessions and attempts, corrections, audio and sync metadata.
pub struct SqlRecordsStore {
    driver: Arc<dyn SqlDriver>,
}

impl SqlRecordsStore {
    /// Creates the store over an open driver.
    pub fn new(driver: Arc<dyn SqlDriver>) -> Self {
        Self { driver }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl RecordsStore for SqlRecordsStore {
    async fn list_prompts(
        &self,
        target_language: Option<&str>,
        instruction_language: Option<&str>,
    ) -> Result<Vec<Prompt>, StoreError> {
        let mut conditions = Vec::new();
        let mut values = Vec::new();
        if let Some(language) = target_language {
            conditions.push("language = ?");
            values.push(language.into());
        }
        if let Some(language) = instruction_language {
            conditions.push("instruction_language = ?");
            values.push(language.into());
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", conditions.join(" AND "))
        };
        let rows = self
            .driver
            .select(
                &format!(
                    "SELECT {PROMPT_COLUMNS} FROM prompts{where_clause} ORDER BY created_at DESC"
                ),
                &values,
            )
            .await?;
        rows.iter().map(prompt_from_row).collect()
    }

    async fn get_prompt(&self, id: &str) -> Result<Option<Prompt>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {PROMPT_COLUMNS} FROM prompts WHERE id = ?"),
                &[id.into()],
            )
            .await?;
        rows.first().map(prompt_from_row).transpose()
    }

    async fn put_prompt(&self, prompt: &Prompt) -> Result<(), StoreError> {
        self.driver
            .execute(
                "INSERT INTO prompts
                 (id, title, text, category, language, instruction_language, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title=excluded.title, text=excluded.text, category=excluded.category,
                   language=excluded.language,
                   instruction_language=excluded.instruction_language,
                   created_at=excluded.created_at",
                &[
                    prompt.id.clone().into(),
                    prompt.title.clone().into(),
                    prompt.text.clone().into(),
                    text_opt(&prompt.category),
                    text_opt(&prompt.language),
                    prompt.instruction_language.clone().into(),
                    prompt.created_at.clone().into(),
                ],
            )
            .await?;
        Ok(())
    }

    async fn delete_prompt(&self, id: &str) -> Result<bool, StoreError> {
        self.delete("DELETE FROM prompts WHERE id = ?", id).await
    }

    async fn get_session(&self, id: &str) -> Result<Option<Session>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?"),
                &[id.into()],
            )
            .await?;
        rows.first().map(session_from_row).transpose()
    }

    async fn put_session(&self, session: &Session) -> Result<(), StoreError> {
        let setup = session
            .setup
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| StoreError::new(error.to_string()))?;
        self.driver
            .execute(
                "INSERT INTO sessions
                 (id, title, mode, started_at, ended_at, created_at, updated_at, setup)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title=excluded.title, mode=excluded.mode,
                   started_at=excluded.started_at, ended_at=excluded.ended_at,
                   created_at=excluded.created_at, updated_at=excluded.updated_at,
                   setup=excluded.setup",
                &[
                    session.id.clone().into(),
                    session.title.clone().into(),
                    session.mode.clone().into(),
                    session.started_at.clone().into(),
                    text_opt(&session.ended_at),
                    session.created_at.clone().into(),
                    session.updated_at.clone().into(),
                    setup.map_or(SqlValue::Null, SqlValue::Text),
                ],
            )
            .await?;
        Ok(())
    }

    async fn list_attempts(&self, session_id: &str) -> Result<Vec<Attempt>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!(
                    "SELECT {ATTEMPT_COLUMNS} FROM attempts WHERE session_id = ? ORDER BY created_at ASC"
                ),
                &[session_id.into()],
            )
            .await?;
        rows.iter().map(attempt_from_row).collect()
    }

    async fn list_all_attempts(&self) -> Result<Vec<Attempt>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {ATTEMPT_COLUMNS} FROM attempts ORDER BY created_at ASC"),
                &[],
            )
            .await?;
        rows.iter().map(attempt_from_row).collect()
    }

    async fn get_attempt(&self, id: &str) -> Result<Option<Attempt>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {ATTEMPT_COLUMNS} FROM attempts WHERE id = ?"),
                &[id.into()],
            )
            .await?;
        rows.first().map(attempt_from_row).transpose()
    }

    async fn put_attempt(&self, attempt: &Attempt) -> Result<(), StoreError> {
        let translations = json_column(&attempt.translations)?;
        let follow_up = json_column(&attempt.follow_up)?;
        let glosses = json_column(&attempt.word_glosses)?;
        self.driver
            .execute(
                "INSERT INTO attempts
                 (id, session_id, prompt_id, prompt_text, transcript, corrected_text,
                  translation, translations, tts_voice, explanation, follow_up, word_glosses,
                  duration_sec, word_count, audio_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   session_id=excluded.session_id, prompt_id=excluded.prompt_id,
                   prompt_text=excluded.prompt_text, transcript=excluded.transcript,
                   corrected_text=excluded.corrected_text, translation=excluded.translation,
                   translations=excluded.translations, tts_voice=excluded.tts_voice,
                   explanation=excluded.explanation, follow_up=excluded.follow_up,
                   word_glosses=excluded.word_glosses, duration_sec=excluded.duration_sec,
                   word_count=excluded.word_count, audio_key=excluded.audio_key,
                   created_at=excluded.created_at, updated_at=excluded.updated_at",
                &[
                    attempt.id.clone().into(),
                    attempt.session_id.clone().into(),
                    text_opt(&attempt.prompt_id),
                    attempt.prompt_text.clone().into(),
                    attempt.transcript.clone().into(),
                    text_opt(&attempt.corrected_text),
                    text_opt(&attempt.translation),
                    translations,
                    text_opt(&attempt.tts_voice),
                    text_opt(&attempt.explanation),
                    follow_up,
                    glosses,
                    attempt.duration_sec.into(),
                    attempt.word_count.into(),
                    text_opt(&attempt.audio_key),
                    attempt.created_at.clone().into(),
                    attempt.updated_at.clone().into(),
                ],
            )
            .await?;
        Ok(())
    }

    async fn delete_attempt(&self, id: &str) -> Result<bool, StoreError> {
        self.delete("DELETE FROM attempts WHERE id = ?", id).await
    }

    async fn get_word_glosses(&self, attempt_id: &str) -> Result<Option<WordGlosses>, StoreError> {
        let value = self.json_field(attempt_id, "word_glosses").await?;
        Ok(value.as_deref().and_then(parse_word_glosses))
    }

    async fn set_word_glosses(
        &self,
        attempt_id: &str,
        glosses: &WordGlosses,
    ) -> Result<bool, StoreError> {
        let json =
            serde_json::to_string(glosses).map_err(|error| StoreError::new(error.to_string()))?;
        self.update_json_field(attempt_id, "word_glosses", &json)
            .await
    }

    async fn get_translations(
        &self,
        attempt_id: &str,
    ) -> Result<Option<TranslationSet>, StoreError> {
        let value = self.json_field(attempt_id, "translations").await?;
        Ok(value.as_deref().and_then(parse_translations))
    }

    async fn set_translations(
        &self,
        attempt_id: &str,
        translations: &TranslationSet,
    ) -> Result<bool, StoreError> {
        let json = serde_json::to_string(translations)
            .map_err(|error| StoreError::new(error.to_string()))?;
        self.update_json_field(attempt_id, "translations", &json)
            .await
    }

    async fn list_corrections(&self, attempt_id: &str) -> Result<Vec<Correction>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!(
                    "SELECT {CORRECTION_COLUMNS} FROM corrections WHERE attempt_id = ? ORDER BY sort_order ASC"
                ),
                &[attempt_id.into()],
            )
            .await?;
        rows.iter().map(correction_from_row).collect()
    }

    async fn list_all_corrections(&self) -> Result<Vec<Correction>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!(
                    "SELECT {CORRECTION_COLUMNS} FROM corrections ORDER BY created_at ASC, sort_order ASC"
                ),
                &[],
            )
            .await?;
        rows.iter().map(correction_from_row).collect()
    }

    async fn replace_corrections(
        &self,
        attempt_id: &str,
        corrections: &[Correction],
    ) -> Result<(), StoreError> {
        // One transaction where the driver supports it: a failed insert must
        // not leave the attempt with its old set deleted and a partial new one.
        let mut statements = vec![SqlStatement::with_params(
            "DELETE FROM corrections WHERE attempt_id = ?",
            vec![attempt_id.into()],
        )];
        for correction in corrections {
            statements.push(SqlStatement::with_params(
                "INSERT INTO corrections
                 (id, attempt_id, category, severity, label, original, replacement,
                  replacement_translation, start_index, end_index, explanation, speak_text,
                  exam_status, formal_alternatives, sort_order, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                vec![
                    correction.id.clone().into(),
                    attempt_id.into(),
                    correction.category.clone().into(),
                    correction.severity.clone().into(),
                    correction.label.clone().into(),
                    correction.original.clone().into(),
                    correction.replacement.clone().into(),
                    text_opt(&correction.replacement_translation),
                    correction.start.map_or(SqlValue::Null, SqlValue::Integer),
                    correction.end.map_or(SqlValue::Null, SqlValue::Integer),
                    correction.explanation.clone().into(),
                    text_opt(&correction.speak_text),
                    text_opt(&correction.exam_status),
                    serde_json::to_string(&correction.formal_alternatives)
                        .map_err(|error| StoreError::new(error.to_string()))?
                        .into(),
                    correction.sort_order.into(),
                    correction.created_at.clone().into(),
                ],
            ));
        }
        if self.driver.supports_batch() {
            self.driver.batch(&statements).await?;
        } else {
            for statement in statements {
                self.driver
                    .execute(&statement.sql, &statement.params)
                    .await?;
            }
        }
        Ok(())
    }

    async fn put_audio(&self, asset: &AudioAsset) -> Result<(), StoreError> {
        self.driver
            .execute(
                "INSERT INTO audio_assets (key, attempt_id, mime, data_base64, created_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET
                   attempt_id=excluded.attempt_id, mime=excluded.mime,
                   data_base64=excluded.data_base64, created_at=excluded.created_at",
                &[
                    asset.key.clone().into(),
                    text_opt(&asset.attempt_id),
                    asset.mime.clone().into(),
                    asset.data_base64.clone().into(),
                    asset.created_at.clone().into(),
                ],
            )
            .await?;
        Ok(())
    }

    async fn get_audio(&self, key: &str) -> Result<Option<AudioAsset>, StoreError> {
        let rows = self
            .driver
            .select(
                "SELECT key, attempt_id, mime, data_base64, created_at
                 FROM audio_assets WHERE key = ?",
                &[key.into()],
            )
            .await?;
        rows.first().map(audio_from_row).transpose()
    }

    async fn delete_audio(&self, key: &str) -> Result<bool, StoreError> {
        self.delete("DELETE FROM audio_assets WHERE key = ?", key)
            .await
    }

    async fn delete_attempt_audio(&self, attempt_id: &str) -> Result<u64, StoreError> {
        self.driver
            .execute(
                "DELETE FROM audio_assets WHERE attempt_id = ?",
                &[attempt_id.into()],
            )
            .await?;
        self.changed().await
    }

    async fn list_prompt_submissions(&self) -> Result<Vec<PromptSubmission>, StoreError> {
        let rows = self
            .driver
            .select(
                "SELECT id, title, text, instruction_language, target_language, level, mode,
                        created_at, attempts, last_attempt_at, last_error
                 FROM prompt_submissions ORDER BY created_at ASC",
                &[],
            )
            .await?;
        rows.iter().map(submission_from_row).collect()
    }

    async fn put_prompt_submission(&self, submission: &PromptSubmission) -> Result<(), StoreError> {
        // Keep the existing row: a failed send must not lose its backoff.
        self.driver
            .execute(
                "INSERT INTO prompt_submissions
                 (id, title, text, instruction_language, target_language, level, mode,
                  created_at, attempts, last_attempt_at, last_error)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO NOTHING",
                &[
                    submission.id.clone().into(),
                    submission.title.clone().into(),
                    submission.text.clone().into(),
                    submission.instruction_language.clone().into(),
                    submission.target_language.clone().into(),
                    submission.level.clone().into(),
                    submission.mode.clone().into(),
                    submission.created_at.clone().into(),
                    submission.attempts.into(),
                    text_opt(&submission.last_attempt_at),
                    text_opt(&submission.last_error),
                ],
            )
            .await?;
        Ok(())
    }

    async fn mark_prompt_submission_failed(
        &self,
        id: &str,
        error: &str,
        attempted_at: &str,
    ) -> Result<bool, StoreError> {
        self.driver
            .execute(
                "UPDATE prompt_submissions
                 SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
                 WHERE id = ?",
                &[attempted_at.into(), error.into(), id.into()],
            )
            .await?;
        Ok(self.changed().await? > 0)
    }

    async fn delete_prompt_submission(&self, id: &str) -> Result<bool, StoreError> {
        self.delete("DELETE FROM prompt_submissions WHERE id = ?", id)
            .await
    }

    async fn get_sync_metadata(&self, provider: &str) -> Result<Option<SyncMetadata>, StoreError> {
        let rows = self
            .driver
            .select(
                "SELECT provider, remote_file_id, etag, last_synced_at, cursor, updated_at
                 FROM sync_metadata WHERE provider = ?",
                &[provider.into()],
            )
            .await?;
        rows.first().map(sync_from_row).transpose()
    }

    async fn set_sync_metadata(&self, metadata: &SyncMetadata) -> Result<(), StoreError> {
        self.driver
            .execute(
                "INSERT INTO sync_metadata
                 (provider, remote_file_id, etag, last_synced_at, cursor, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(provider) DO UPDATE SET
                   remote_file_id=excluded.remote_file_id, etag=excluded.etag,
                   last_synced_at=excluded.last_synced_at, cursor=excluded.cursor,
                   updated_at=excluded.updated_at",
                &[
                    metadata.provider.clone().into(),
                    text_opt(&metadata.remote_file_id),
                    text_opt(&metadata.etag),
                    text_opt(&metadata.last_synced_at),
                    text_opt(&metadata.cursor),
                    metadata.updated_at.clone().into(),
                ],
            )
            .await?;
        Ok(())
    }
}

impl SqlRecordsStore {
    async fn delete(&self, sql: &str, id: &str) -> Result<bool, StoreError> {
        self.driver.execute(sql, &[id.into()]).await?;
        Ok(self.changed().await? > 0)
    }

    async fn changed(&self) -> Result<u64, StoreError> {
        let changed = self
            .driver
            .select("SELECT changes() AS changed", &[])
            .await?
            .first()
            .and_then(|row| row.get("changed"))
            .and_then(SqlValue::as_i64)
            .unwrap_or(0);
        Ok(changed.max(0) as u64)
    }

    async fn json_field(
        &self,
        attempt_id: &str,
        column: &str,
    ) -> Result<Option<String>, StoreError> {
        let rows = self
            .driver
            .select(
                &format!("SELECT {column} FROM attempts WHERE id = ?"),
                &[attempt_id.into()],
            )
            .await?;
        Ok(rows
            .first()
            .and_then(|row| row.get(column))
            .and_then(SqlValue::as_str)
            .map(str::to_owned))
    }

    async fn update_json_field(
        &self,
        attempt_id: &str,
        column: &str,
        json: &str,
    ) -> Result<bool, StoreError> {
        self.driver
            .execute(
                &format!("UPDATE attempts SET {column} = ?, updated_at = {NOW_SQL} WHERE id = ?"),
                &[json.into(), attempt_id.into()],
            )
            .await?;
        Ok(self.changed().await? > 0)
    }
}

fn json_column<T: serde::Serialize>(value: &Option<T>) -> Result<SqlValue, StoreError> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map(|value| value.map_or(SqlValue::Null, SqlValue::Text))
        .map_err(|error| StoreError::new(error.to_string()))
}

fn optional_i64(row: &SqlRow, column: &str) -> Option<i64> {
    row.get(column).and_then(SqlValue::as_i64)
}

fn required_f64(row: &SqlRow, column: &str) -> Result<f64, StoreError> {
    row.get(column)
        .and_then(SqlValue::as_f64)
        .ok_or_else(|| StoreError::new(format!("column `{column}` is missing or not numeric")))
}

fn prompt_from_row(row: &SqlRow) -> Result<Prompt, StoreError> {
    Ok(Prompt {
        id: required_text(row, "id")?,
        title: required_text(row, "title")?,
        text: required_text(row, "text")?,
        category: optional_text(row, "category"),
        language: optional_text(row, "language"),
        instruction_language: required_text(row, "instruction_language")?,
        created_at: required_text(row, "created_at")?,
    })
}

fn attempt_from_row(row: &SqlRow) -> Result<Attempt, StoreError> {
    Ok(Attempt {
        id: required_text(row, "id")?,
        session_id: required_text(row, "session_id")?,
        prompt_id: optional_text(row, "prompt_id"),
        prompt_text: required_text(row, "prompt_text")?,
        transcript: required_text(row, "transcript")?,
        corrected_text: optional_text(row, "corrected_text"),
        translation: optional_text(row, "translation"),
        translations: optional_text(row, "translations").and_then(|json| parse_translations(&json)),
        tts_voice: optional_text(row, "tts_voice"),
        explanation: optional_text(row, "explanation"),
        follow_up: optional_text(row, "follow_up").and_then(|json| parse_follow_up(&json)),
        word_glosses: optional_text(row, "word_glosses").and_then(|json| parse_word_glosses(&json)),
        duration_sec: required_f64(row, "duration_sec")?,
        word_count: optional_i64(row, "word_count").unwrap_or(0),
        audio_key: optional_text(row, "audio_key"),
        created_at: required_text(row, "created_at")?,
        updated_at: required_text(row, "updated_at")?,
    })
}

fn correction_from_row(row: &SqlRow) -> Result<Correction, StoreError> {
    let alternatives = optional_text(row, "formal_alternatives")
        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default();
    Ok(Correction {
        id: required_text(row, "id")?,
        attempt_id: required_text(row, "attempt_id")?,
        category: required_text(row, "category")?,
        severity: required_text(row, "severity")?,
        label: required_text(row, "label")?,
        original: required_text(row, "original")?,
        replacement: required_text(row, "replacement")?,
        replacement_translation: optional_text(row, "replacement_translation"),
        start: optional_i64(row, "start_index"),
        end: optional_i64(row, "end_index"),
        explanation: required_text(row, "explanation")?,
        speak_text: optional_text(row, "speak_text"),
        exam_status: optional_text(row, "exam_status"),
        formal_alternatives: alternatives,
        sort_order: optional_i64(row, "sort_order").unwrap_or(0),
        created_at: required_text(row, "created_at")?,
    })
}

fn audio_from_row(row: &SqlRow) -> Result<AudioAsset, StoreError> {
    Ok(AudioAsset {
        key: required_text(row, "key")?,
        attempt_id: optional_text(row, "attempt_id"),
        mime: required_text(row, "mime")?,
        data_base64: required_text(row, "data_base64")?,
        created_at: required_text(row, "created_at")?,
    })
}

fn submission_from_row(row: &SqlRow) -> Result<PromptSubmission, StoreError> {
    Ok(PromptSubmission {
        id: required_text(row, "id")?,
        title: required_text(row, "title")?,
        text: required_text(row, "text")?,
        instruction_language: required_text(row, "instruction_language")?,
        target_language: required_text(row, "target_language")?,
        level: required_text(row, "level")?,
        mode: required_text(row, "mode")?,
        created_at: required_text(row, "created_at")?,
        attempts: optional_i64(row, "attempts").unwrap_or(0),
        last_attempt_at: optional_text(row, "last_attempt_at"),
        last_error: optional_text(row, "last_error"),
    })
}

fn sync_from_row(row: &SqlRow) -> Result<SyncMetadata, StoreError> {
    Ok(SyncMetadata {
        provider: required_text(row, "provider")?,
        remote_file_id: optional_text(row, "remote_file_id"),
        etag: optional_text(row, "etag"),
        last_synced_at: optional_text(row, "last_synced_at"),
        cursor: optional_text(row, "cursor"),
        updated_at: required_text(row, "updated_at")?,
    })
}

/// Reads a stored translation set with the legacy tolerance: missing scalar
/// fields become empty, missing lists empty, and a malformed value is `None`.
fn parse_translations(json: &str) -> Option<TranslationSet> {
    let parsed = serde_json::from_str::<serde_json::Value>(json).ok()?;
    if !parsed.is_object() {
        return None;
    }
    let idiomatic = parsed
        .get("idiomatic")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    let version = parsed
        .get("version")
        .and_then(|v| v.as_i64())
        .filter(|version| *version > 0);
    let instruction_language = parsed
        .get("instructionLanguage")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let literal = parsed
        .get("literal")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    let word_for_word = parsed
        .get("wordForWord")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();
    let idiomatic_variants = parsed
        .get("idiomaticVariants")
        .and_then(|v| v.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|value| !value.is_empty() && *value != idiomatic)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let word_breakdown = parsed
        .get("wordBreakdown")
        .and_then(|v| v.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let source = value.get("source")?.as_str()?;
                    let target = value.get("target")?.as_str()?;
                    (!source.is_empty() && !target.is_empty()).then(|| TranslationBreakdownItem {
                        source: source.to_owned(),
                        target: target.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(TranslationSet {
        version,
        instruction_language,
        idiomatic,
        idiomatic_variants,
        literal,
        word_for_word,
        word_breakdown,
    })
}

/// Reads a stored follow-up; an empty question means none.
fn parse_follow_up(json: &str) -> Option<FollowUp> {
    let parsed = serde_json::from_str::<serde_json::Value>(json).ok()?;
    let question = parsed.get("question").and_then(|v| v.as_str())?;
    if question.is_empty() {
        return None;
    }
    Some(FollowUp {
        question: question.to_owned(),
        translation: parsed
            .get("translation")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned(),
    })
}

/// Reads the hover glosses, dropping entries the legacy adapter would drop:
/// a text needs a string-only word list; phrases need integer ranges and a
/// known origin; section ranges must be ordered.
fn parse_word_glosses(json: &str) -> Option<WordGlosses> {
    let parsed = serde_json::from_str::<serde_json::Value>(json).ok()?;
    let object = parsed.as_object()?;
    let mut glosses = WordGlosses::new();
    for (key, value) in object {
        let Some(words) = value.get("words").and_then(|v| v.as_array()) else {
            continue;
        };
        if !words.iter().all(|word| word.is_string()) {
            continue;
        }
        let words = words
            .iter()
            .filter_map(|word| word.as_str().map(str::to_owned))
            .collect();
        let phrases = value
            .get("phrases")
            .and_then(|v| v.as_array())
            .map(|values| values.iter().filter_map(parse_phrase).collect())
            .unwrap_or_default();
        let sections = value
            .get("sections")
            .and_then(|v| v.as_array())
            .map(|values| values.iter().filter_map(parse_range).collect());
        let pos = value.get("pos").and_then(|v| v.as_array()).map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect()
        });
        let pos_sections = value
            .get("posSections")
            .and_then(|v| v.as_array())
            .map(|values| values.iter().filter_map(parse_range).collect());
        glosses.insert(
            key.clone(),
            TextGlosses {
                words,
                phrases,
                pos,
                pos_sections,
                sections,
            },
        );
    }
    (!glosses.is_empty()).then_some(glosses)
}

fn parse_phrase(value: &serde_json::Value) -> Option<PhraseGloss> {
    let start = value.get("start")?.as_i64()?;
    let end = value.get("end")?.as_i64()?;
    let origin = value.get("origin")?.as_str()?;
    if origin != "expression" && origin != "selection" {
        return None;
    }
    Some(PhraseGloss {
        start,
        end,
        meaning: value.get("meaning")?.as_str()?.to_owned(),
        origin: origin.to_owned(),
    })
}

fn parse_range(value: &serde_json::Value) -> Option<GlossedRange> {
    let start = value.get("start")?.as_i64()?;
    let end = value.get("end")?.as_i64()?;
    (start <= end).then_some(GlossedRange { start, end })
}
