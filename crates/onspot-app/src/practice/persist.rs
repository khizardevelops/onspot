// SPDX-License-Identifier: AGPL-3.0-or-later

//! Writes a finished take through the P2 repositories, in the same order and
//! with the same rows the legacy store uses.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use onspot_domain::{
    Attempt, AudioAsset, Correction, EvaluationResult, Prompt, Session, SessionSetup,
};
use onspot_dsp::speech::count_words;
use onspot_ports::{AudioFrame, CoreError, EngineMode, IdSource, RecordsStore, StoreError};

use super::config::PracticeConfig;

/// Everything one persisted take needs.
pub struct PersistTake<'a> {
    pub records: &'a dyn RecordsStore,
    pub ids: &'a dyn IdSource,
    pub config: &'a PracticeConfig,
    pub prompt: &'a Prompt,
    pub mode: &'a str,
    pub existing_session_id: Option<&'a str>,
    pub transcript: &'a str,
    pub evaluation: &'a EvaluationResult,
    pub recording: &'a AudioFrame,
    pub now: &'a str,
}

/// The persisted take and the session it belongs to.
pub struct PersistedTake {
    pub attempt: Attempt,
    pub corrections: Vec<Correction>,
    pub session_id: String,
}

/// Stores the session (when the draft has none), the attempt, its corrections
/// and its audio. Audio failure is non-fatal, as in the legacy store.
pub async fn persist_take(take: PersistTake<'_>) -> Result<PersistedTake, CoreError> {
    let session_id = match take.existing_session_id {
        Some(id) => String::from(id),
        None => create_session(&take).await?,
    };

    let attempt_id = take.ids.new_id("attempt");
    let audio_key = format!("attempt:{attempt_id}");
    let attempt = Attempt {
        id: attempt_id.clone(),
        session_id: session_id.clone(),
        prompt_id: Some(take.prompt.id.clone()).filter(|id| !id.is_empty()),
        prompt_text: take.prompt.text.clone(),
        transcript: String::from(take.transcript),
        corrected_text: Some(take.evaluation.corrected_text.clone()),
        translation: None,
        translations: None,
        tts_voice: Some(take.config.tts_voice.clone()),
        explanation: Some(take.evaluation.explanation.clone()),
        follow_up: take.evaluation.follow_up.clone(),
        word_glosses: None,
        duration_sec: (take.recording.duration_sec * 100.0).round() / 100.0,
        word_count: count_words(take.transcript) as i64,
        audio_key: Some(audio_key.clone()),
        created_at: String::from(take.now),
        updated_at: String::from(take.now),
    };

    take.records.put_attempt(&attempt).await.map_err(store)?;

    let corrections = build_corrections(
        take.ids,
        &attempt_id,
        take.transcript,
        take.evaluation,
        take.now,
    );
    take.records
        .replace_corrections(&attempt_id, &corrections)
        .await
        .map_err(store)?;

    let audio = AudioAsset {
        key: audio_key,
        attempt_id: Some(attempt_id),
        mime: take.recording.blob.mime.clone(),
        data_base64: BASE64.encode(&take.recording.blob.bytes),
        created_at: String::from(take.now),
    };
    if let Err(error) = take.records.put_audio(&audio).await {
        eprintln!("[practice] could not store audio: {}", error.message);
    }

    Ok(PersistedTake {
        attempt,
        corrections,
        session_id,
    })
}

async fn create_session(take: &PersistTake<'_>) -> Result<String, CoreError> {
    let session_id = take.ids.new_id("session");
    let session = Session {
        id: session_id.clone(),
        title: take.prompt.title.clone(),
        mode: String::from(take.mode),
        started_at: String::from(take.now),
        ended_at: None,
        created_at: String::from(take.now),
        updated_at: String::from(take.now),
        setup: Some(setup_from_config(take.config)),
    };
    take.records.put_session(&session).await.map_err(store)?;
    Ok(session_id)
}

/// The setup a new session records, matching `setupFromSettings` in TS.
fn setup_from_config(config: &PracticeConfig) -> SessionSetup {
    SessionSetup {
        target_language: config.target_language_id.clone(),
        instruction_language: config.instruction_language_id.clone(),
        tts_mode: match config.tts_mode {
            EngineMode::Local => String::from("local"),
            EngineMode::Cloud => String::from("cloud"),
        },
        tts_voice: config.tts_voice.clone(),
        explanation_voice: config.explanation_voice.clone(),
        target_speech_pace: f64::from(config.pace),
    }
}

/// Flattens an evaluation into correction rows, exactly as the legacy store's
/// `buildCorrections` does: vocabulary becomes `style`, connectors `register`.
pub fn build_corrections(
    ids: &dyn IdSource,
    attempt_id: &str,
    transcript: &str,
    evaluation: &EvaluationResult,
    created_at: &str,
) -> Vec<Correction> {
    let mut rows = Vec::new();

    for correction in &evaluation.corrections {
        rows.push(Correction {
            id: ids.new_id("corr"),
            attempt_id: String::from(attempt_id),
            category: correction.category.clone(),
            severity: correction.severity.clone(),
            label: correction.label.clone(),
            original: correction.original.clone(),
            replacement: correction.replacement.clone(),
            replacement_translation: correction.replacement_translation.clone(),
            start: None,
            end: None,
            explanation: correction.explanation.clone(),
            speak_text: correction.speak_text.clone(),
            exam_status: correction.exam_status.clone(),
            formal_alternatives: correction.formal_alternatives.clone(),
            sort_order: rows.len() as i64,
            created_at: String::from(created_at),
        });
    }

    for vocabulary in &evaluation.vocabulary {
        rows.push(Correction {
            id: ids.new_id("corr"),
            attempt_id: String::from(attempt_id),
            category: String::from("style"),
            severity: String::from("suggestion"),
            label: String::from("Vocabulary"),
            original: vocabulary.original.clone(),
            replacement: vocabulary.suggestion.clone(),
            replacement_translation: None,
            start: None,
            end: None,
            explanation: vocabulary.why.clone(),
            speak_text: None,
            exam_status: None,
            formal_alternatives: Vec::new(),
            sort_order: rows.len() as i64,
            created_at: String::from(created_at),
        });
    }

    for connector in &evaluation.connectors {
        rows.push(Correction {
            id: ids.new_id("corr"),
            attempt_id: String::from(attempt_id),
            category: String::from("register"),
            severity: String::from("suggestion"),
            label: String::from("Connector"),
            original: connector.instead_of.clone().unwrap_or_default(),
            replacement: connector.connector.clone(),
            replacement_translation: None,
            start: None,
            end: None,
            explanation: connector.why.clone(),
            speak_text: None,
            exam_status: None,
            formal_alternatives: Vec::new(),
            sort_order: rows.len() as i64,
            created_at: String::from(created_at),
        });
    }

    mark_transcript_ranges(&mut rows, transcript);
    rows
}

/// Resolves each `original` to a character range in the transcript, claiming
/// distinct occurrences so a repeated phrase is not marked twice. Leaves the
/// range `None` when the text is not found verbatim (the recognizer may have
/// dropped a filler sound).
fn mark_transcript_ranges(rows: &mut [Correction], transcript: &str) {
    let mut used: Vec<(usize, usize)> = Vec::new();

    for row in rows {
        if row.original.is_empty() {
            continue;
        }

        let mut from = 0;
        let mut chosen: Option<(usize, usize)> = None;
        while let Some(at) = transcript[from..].find(&row.original) {
            let start = from + at;
            let end = start + row.original.len();
            let overlaps = used
                .iter()
                .any(|(used_start, used_end)| start < *used_end && end > *used_start);
            if !overlaps {
                chosen = Some((start, end));
                break;
            }
            from = end;
        }

        if let Some((start, end)) = chosen {
            // The correction offsets are JavaScript string indices: UTF-16 code
            // units, not Rust bytes. Non-ASCII text must not shift the highlight.
            row.start = Some(transcript[..start].encode_utf16().count() as i64);
            row.end = Some(transcript[..end].encode_utf16().count() as i64);
            used.push((start, end));
        }
    }
}

pub(super) fn store(error: StoreError) -> CoreError {
    CoreError::new("practice.persistence_failed", error.message)
}
