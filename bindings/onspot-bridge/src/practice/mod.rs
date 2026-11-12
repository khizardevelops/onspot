// SPDX-License-Identifier: AGPL-3.0-or-later

//! The practice command surface and the host shims its ports call.
//!
//! The core owns the state machine; media, speech engines and the legacy LLM
//! evaluation live in the driver. A port here sends one `HostRequest` event and
//! awaits `core.host_reply`, so the same Rust loop runs in the browser and in
//! the Tauri webview.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use onspot_app::practice::{
    PracticeConfig, PracticePorts, PracticeSnapshot, PromptView, RunPracticeSession,
};
use onspot_app::{Core, UiEvent};
use onspot_ports::{
    AudioCapture, AudioClip, AudioFrame, AudioLevelSink, AudioPlayback, CancelToken,
    CaptureOptions, Clock, CoreError, GeneratedPrompt, HttpClient, HttpRequest, HttpResponse,
    IdSource, LlmProvider, ModelProgress, PlaybackRequest, PromptRequest, PromptSource,
    SpeechPiece, SttEngine, SttOptions, SttProgressSink, Transcript, TtsEngine,
};

use crate::commands::serialize;
use crate::error::BridgeError;

pub const PRACTICE_CONFIGURE: &str = "practice.configure";
pub const PRACTICE_SNAPSHOT: &str = "practice.snapshot";
pub const PRACTICE_NEW_SESSION: &str = "practice.new_session";
pub const PRACTICE_SET_PROMPT: &str = "practice.set_prompt";
pub const PRACTICE_NEXT_PROMPT: &str = "practice.next_prompt";
pub const PRACTICE_START_RECORDING: &str = "practice.start_recording";
pub const PRACTICE_STOP_AND_ANALYZE: &str = "practice.stop_and_analyze";
pub const PRACTICE_CANCEL_RECORDING: &str = "practice.cancel_recording";
pub const PRACTICE_TICK: &str = "practice.tick";
pub const PRACTICE_AUDIO_LEVEL: &str = "practice.audio_level";
pub const PRACTICE_STT_PROGRESS: &str = "practice.stt_progress";
pub const PRACTICE_SET_ACTIVE_ATTEMPT: &str = "practice.set_active_attempt";
pub const PRACTICE_CLEAR_ERROR: &str = "practice.clear_error";
pub const PRACTICE_RESUME_LAST_SESSION: &str = "practice.resume_last_session";
pub const PRACTICE_OPEN_SESSION: &str = "practice.open_session";
pub const PRACTICE_RENAME_SESSION: &str = "practice.rename_session";
pub const PRACTICE_DELETE_SESSION: &str = "practice.delete_session";
pub const PRACTICE_SPEAK_TRACK: &str = "practice.speak_track";
pub const PRACTICE_PLAY_SEGMENT: &str = "practice.play_segment";
pub const PRACTICE_SPEAK_TEXT: &str = "practice.speak_text";
pub const PRACTICE_PLAY_RECORDING: &str = "practice.play_recording";
pub const PRACTICE_SET_ATTEMPT_VOICE: &str = "practice.set_attempt_voice";
pub const CORE_HOST_REPLY: &str = "core.host_reply";
pub const EVALUATION_TEST_CONNECTION: &str = "evaluation.test_connection";
pub const TRANSLATIONS_ENSURE: &str = "translations.ensure";
pub const INSIGHTS_BUILD: &str = "insights.build";
pub const GLOSSES_ENSURE: &str = "glosses.ensure";
pub const PHRASES_ENSURE: &str = "phrases.ensure";
pub const USAGE_SNAPSHOT: &str = "usage.snapshot";

/// `practice.configure` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureRequest {
    pub config: PracticeConfig,
}

/// `practice.set_prompt` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPromptRequest {
    pub prompt: PromptView,
}

/// `practice.next_prompt` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextPromptRequest {
    pub candidates: Vec<PromptView>,
    #[serde(default)]
    pub english_fallback: bool,
}

/// `practice.audio_level` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevelRequest {
    pub level: f32,
}

/// `practice.stt_progress` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttProgressRequest {
    pub progress: ModelProgress,
}

/// `practice.set_active_attempt` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAttemptRequest {
    #[serde(default)]
    pub attempt_id: Option<String>,
}

/// A session id argument.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdRequest {
    pub session_id: String,
}

/// `practice.rename_session` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionRequest {
    pub session_id: String,
    pub title: String,
}

/// `practice.speak_track` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTrackRequest {
    pub attempt_id: String,
    pub kind: String,
}

/// `practice.play_segment` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySegmentRequest {
    pub attempt_id: String,
    pub text: String,
    pub index: u32,
}

/// `practice.speak_text` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextRequest {
    pub text: String,
}

/// `practice.play_recording` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRecordingRequest {
    pub attempt_id: String,
}

/// `practice.set_attempt_voice` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptVoiceRequest {
    pub attempt_id: String,
    pub voice: String,
}

/// `core.host_reply` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReplyRequest {
    pub id: u32,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<HostFailure>,
}

/// A failed host operation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFailure {
    pub code: String,
    pub message: String,
}

/// The open session after an operation.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PracticeResponse {
    pub snapshot: PracticeSnapshot,
}

/// Whether a stored session was found and resumed.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ResumeResponse {
    pub resumed: bool,
    pub snapshot: PracticeSnapshot,
}

/// Whether a stored session was found and opened.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct OpenResponse {
    pub opened: bool,
    pub snapshot: PracticeSnapshot,
}

/// An empty acknowledgement.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct AcceptedResponse {
    pub accepted: bool,
}

/// Runs one practice command, or reports that it is not a practice command.
#[allow(clippy::too_many_lines)]
pub async fn dispatch(
    core: &Core,
    command: &str,
    payload: Value,
) -> Option<Result<Value, BridgeError>> {
    let result = match command {
        PRACTICE_CONFIGURE => configure(core, payload).and_then(serialize),
        PRACTICE_SNAPSHOT => snapshot(core).and_then(serialize),
        PRACTICE_NEW_SESSION => new_session(core).await.and_then(serialize),
        PRACTICE_SET_PROMPT => set_prompt(core, payload).and_then(serialize),
        PRACTICE_NEXT_PROMPT => next_prompt(core, payload).await.and_then(serialize),
        PRACTICE_START_RECORDING => start_recording(core).await.and_then(serialize),
        PRACTICE_STOP_AND_ANALYZE => stop_and_analyze(core).await.and_then(serialize),
        PRACTICE_CANCEL_RECORDING => cancel_recording(core).await.and_then(serialize),
        PRACTICE_TICK => tick(core).await.and_then(serialize),
        PRACTICE_AUDIO_LEVEL => audio_level(core, payload).and_then(serialize),
        PRACTICE_STT_PROGRESS => stt_progress(core, payload).and_then(serialize),
        PRACTICE_SET_ACTIVE_ATTEMPT => set_active_attempt(core, payload).and_then(serialize),
        PRACTICE_CLEAR_ERROR => clear_error(core).and_then(serialize),
        PRACTICE_RESUME_LAST_SESSION => resume_last_session(core).await.and_then(serialize),
        PRACTICE_OPEN_SESSION => open_session(core, payload).await.and_then(serialize),
        PRACTICE_RENAME_SESSION => rename_session(core, payload).await.and_then(serialize),
        PRACTICE_DELETE_SESSION => delete_session(core, payload).await.and_then(serialize),
        PRACTICE_SPEAK_TRACK => speak_track(core, payload).and_then(serialize),
        PRACTICE_PLAY_SEGMENT => play_segment(core, payload).and_then(serialize),
        PRACTICE_SPEAK_TEXT => speak_text(core, payload).and_then(serialize),
        PRACTICE_PLAY_RECORDING => play_recording(core, payload).and_then(serialize),
        PRACTICE_SET_ATTEMPT_VOICE => set_attempt_voice(core, payload).await.and_then(serialize),
        CORE_HOST_REPLY => host_reply(core, payload).and_then(serialize),
        EVALUATION_TEST_CONNECTION => test_connection(core, payload).await.and_then(serialize),
        TRANSLATIONS_ENSURE => ensure_translations(core, payload).await.and_then(serialize),
        INSIGHTS_BUILD => build_insights(core).await.and_then(serialize),
        GLOSSES_ENSURE => ensure_glosses(core, payload).await.and_then(serialize),
        PHRASES_ENSURE => ensure_phrase(core, payload).await.and_then(serialize),
        USAGE_SNAPSHOT => usage_snapshot(core, payload).and_then(serialize),
        _ => return None,
    };
    Some(result)
}

fn parse<T: for<'de> Deserialize<'de>>(command: &str, payload: Value) -> Result<T, BridgeError> {
    serde_json::from_value(payload).map_err(|error| BridgeError::invalid_payload(command, error))
}

fn practice(core: &Core) -> Result<Arc<RunPracticeSession>, BridgeError> {
    core.practice()
        .ok_or_else(|| BridgeError::unavailable("practice"))
}

fn configure(core: &Core, payload: Value) -> Result<PracticeResponse, BridgeError> {
    let request: ConfigureRequest = parse(PRACTICE_CONFIGURE, payload)?;
    let session = match core.practice() {
        Some(session) => {
            session.configure(request.config);
            session
        }
        None => {
            let records = core
                .hosts()
                .records
                .clone()
                .ok_or_else(|| BridgeError::unavailable("storage"))?;
            let history = core
                .hosts()
                .history
                .clone()
                .ok_or_else(|| BridgeError::unavailable("storage"))?;
            let ports = PracticePorts {
                events: core.event_sink(),
                history,
                records,
                capture: Arc::new(RpcCapture(core.host_rpc().clone())),
                stt: Arc::new(RpcStt(core.host_rpc().clone())),
                tts: Arc::new(RpcTts(core.host_rpc().clone())),
                playback: Arc::new(RpcPlayback),
                clock: Arc::new(SystemClock),
                evaluation: Arc::new(onspot_app::EvaluatorPort::new(rust_evaluator(
                    core.host_rpc().clone(),
                ))),
                prompts: Arc::new(RpcPrompts(core.host_rpc().clone())),
                ids: Arc::new(BridgeIds::default()),
            };
            core.install_practice(Arc::new(RunPracticeSession::new(ports, request.config)))
        }
    };
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

fn snapshot(core: &Core) -> Result<PracticeResponse, BridgeError> {
    Ok(PracticeResponse {
        snapshot: practice(core)?.snapshot(),
    })
}

async fn new_session(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    session.start_session().await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

fn set_prompt(core: &Core, payload: Value) -> Result<PracticeResponse, BridgeError> {
    let request: SetPromptRequest = parse(PRACTICE_SET_PROMPT, payload)?;
    let session = practice(core)?;
    session.set_prompt(request.prompt);
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn next_prompt(core: &Core, payload: Value) -> Result<PracticeResponse, BridgeError> {
    let request: NextPromptRequest = parse(PRACTICE_NEXT_PROMPT, payload)?;
    let session = practice(core)?;
    let _ = session
        .request_prompt(&request.candidates, request.english_fallback)
        .await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn start_recording(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    let _ = session.start_recording().await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn stop_and_analyze(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    let _ = session.stop_and_analyze().await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn tick(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    let _ = session.tick().await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn cancel_recording(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    session.cancel_recording().await;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

fn audio_level(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: AudioLevelRequest = parse(PRACTICE_AUDIO_LEVEL, payload)?;
    practice(core)?.set_level(request.level);
    Ok(AcceptedResponse { accepted: true })
}

fn stt_progress(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: SttProgressRequest = parse(PRACTICE_STT_PROGRESS, payload)?;
    practice(core)?.set_progress(request.progress);
    Ok(AcceptedResponse { accepted: true })
}

fn set_active_attempt(core: &Core, payload: Value) -> Result<PracticeResponse, BridgeError> {
    let request: ActiveAttemptRequest = parse(PRACTICE_SET_ACTIVE_ATTEMPT, payload)?;
    let session = practice(core)?;
    session.set_active_attempt(request.attempt_id.as_deref());
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

fn clear_error(core: &Core) -> Result<PracticeResponse, BridgeError> {
    let session = practice(core)?;
    session.clear_error();
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

async fn resume_last_session(core: &Core) -> Result<ResumeResponse, BridgeError> {
    let session = practice(core)?;
    let resumed = session.resume_last_session().await.map_err(core_error)?;
    Ok(ResumeResponse {
        resumed,
        snapshot: session.snapshot(),
    })
}

async fn open_session(core: &Core, payload: Value) -> Result<OpenResponse, BridgeError> {
    let request: SessionIdRequest = parse(PRACTICE_OPEN_SESSION, payload)?;
    let session = practice(core)?;
    let opened = session
        .open_session(&request.session_id)
        .await
        .map_err(core_error)?;
    Ok(OpenResponse {
        opened,
        snapshot: session.snapshot(),
    })
}

async fn rename_session(
    core: &Core,
    payload: Value,
) -> Result<crate::storage::ChangedResponse, BridgeError> {
    let request: RenameSessionRequest = parse(PRACTICE_RENAME_SESSION, payload)?;
    let session = practice(core)?;
    let changed = session
        .rename_session(&request.session_id, &request.title)
        .await
        .map_err(core_error)?;
    if changed {
        let sequence = core.next_sequence();
        core.emit(UiEvent::HistoryChanged { seq: sequence });
    }
    Ok(crate::storage::ChangedResponse { changed })
}

async fn delete_session(
    core: &Core,
    payload: Value,
) -> Result<crate::storage::ChangedResponse, BridgeError> {
    let request: SessionIdRequest = parse(PRACTICE_DELETE_SESSION, payload)?;
    let session = practice(core)?;
    let changed = session
        .delete_session(&request.session_id)
        .await
        .map_err(core_error)?;
    if changed {
        let sequence = core.next_sequence();
        core.emit(UiEvent::HistoryChanged { seq: sequence });
    }
    Ok(crate::storage::ChangedResponse { changed })
}

fn speak_track(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: SpeakTrackRequest = parse(PRACTICE_SPEAK_TRACK, payload)?;
    practice(core)?
        .request_track(&request.attempt_id, &request.kind)
        .map_err(core_error)?;
    Ok(AcceptedResponse { accepted: true })
}

fn play_segment(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: PlaySegmentRequest = parse(PRACTICE_PLAY_SEGMENT, payload)?;
    practice(core)?
        .request_segment(&request.attempt_id, &request.text, request.index)
        .map_err(core_error)?;
    Ok(AcceptedResponse { accepted: true })
}

fn speak_text(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: SpeakTextRequest = parse(PRACTICE_SPEAK_TEXT, payload)?;
    practice(core)?.request_speak_text(&request.text);
    Ok(AcceptedResponse { accepted: true })
}

fn play_recording(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: PlayRecordingRequest = parse(PRACTICE_PLAY_RECORDING, payload)?;
    practice(core)?
        .request_recording(&request.attempt_id)
        .map_err(core_error)?;
    Ok(AcceptedResponse { accepted: true })
}

async fn set_attempt_voice(core: &Core, payload: Value) -> Result<PracticeResponse, BridgeError> {
    let request: AttemptVoiceRequest = parse(PRACTICE_SET_ATTEMPT_VOICE, payload)?;
    let session = practice(core)?;
    session
        .set_attempt_voice(&request.attempt_id, &request.voice)
        .await
        .map_err(core_error)?;
    Ok(PracticeResponse {
        snapshot: session.snapshot(),
    })
}

/// `evaluation.test_connection` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionRequest {
    pub endpoint: onspot_domain::LlmEndpoint,
}

/// The provider's reply to a connection test.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResponse {
    pub reply: String,
}

async fn test_connection(
    core: &Core,
    payload: Value,
) -> Result<TestConnectionResponse, BridgeError> {
    let request: TestConnectionRequest = parse(EVALUATION_TEST_CONNECTION, payload)?;
    let evaluator = rust_evaluator(core.host_rpc().clone());
    let reply = onspot_app::TestLlmConnection::new(evaluator.as_ref())
        .execute(&request.endpoint, &CancelToken::new())
        .await
        .map_err(core_error)?;
    Ok(TestConnectionResponse { reply })
}

/// `usage.snapshot` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRequest {
    pub input: onspot_app::UsageInput,
}

fn usage_snapshot(core: &Core, payload: Value) -> Result<onspot_app::UsageSnapshot, BridgeError> {
    let request: UsageRequest = parse(USAGE_SNAPSHOT, payload)?;
    let snapshot = onspot_app::usage_snapshot(&request.input);
    for warning in &snapshot.warnings {
        core.emit(UiEvent::UsageWarning {
            kind: warning.level.clone(),
            provider: String::from("usage"),
            message_code: warning.message.clone(),
        });
    }
    Ok(snapshot)
}

/// `glosses.ensure` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossesRequest {
    pub attempt_id: String,
    pub text: String,
    pub word_index: i64,
    #[serde(default)]
    pub with_pos: bool,
}

/// `phrases.ensure` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhraseRequest {
    pub attempt_id: String,
    pub text: String,
    pub start: i64,
    pub end: i64,
    pub phrase: String,
}

/// One text's stored meanings.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GlossesResponse {
    pub key: String,
    pub glosses: onspot_domain::TextGlosses,
}

/// A selected phrase's meaning.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PhraseResponse {
    pub meaning: String,
}

fn gloss_key(text: &str, instruction_language: &str) -> String {
    let text_key = if instruction_language == "en" {
        hash_text(text)
    } else {
        format!("{instruction_language}:{}", hash_text(text))
    };
    format!("numbered:{text_key}")
}

fn hash_text(text: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let mut length = text.encode_utf16().count() as u64;
    let mut base36 = String::new();
    if length == 0 {
        base36.push('0');
    }
    while length > 0 {
        let digit = length % 36;
        base36.insert(0, char::from_digit(digit as u32, 36).unwrap_or('0'));
        length /= 36;
    }
    format!("{hash:08x}-{base36}")
}

async fn ensure_glosses(core: &Core, payload: Value) -> Result<GlossesResponse, BridgeError> {
    let request: GlossesRequest = parse(GLOSSES_ENSURE, payload)?;
    let session = practice(core)?;
    let config = session.config();
    let records = core
        .hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let mut attempt = records
        .get_attempt(&request.attempt_id)
        .await
        .map_err(|error| BridgeError::new("glosses.persistence_failed", error.message))?
        .ok_or_else(|| {
            BridgeError::new("practice.attempt_not_found", "the attempt is not stored")
        })?;
    let key = gloss_key(&request.text, &config.instruction_language_id);
    let mut glosses_by_text = attempt.word_glosses.clone().unwrap_or_default();
    if let Some(existing) = glosses_by_text.get(&key) {
        if existing.sections.is_some() || !existing.words.is_empty() {
            return Ok(GlossesResponse {
                key,
                glosses: existing.clone(),
            });
        }
    }

    let evaluator = rust_evaluator(core.host_rpc().clone());
    let glosses = evaluator
        .gloss(
            &request.text,
            &config.llm_endpoint,
            &config.target_language_name,
            &config.instruction_language_name,
            request.with_pos,
            &CancelToken::new(),
        )
        .await
        .map_err(core_error)?;
    glosses_by_text.insert(key.clone(), glosses.clone());
    attempt.word_glosses = Some(glosses_by_text);
    attempt.updated_at = now_rfc3339(SystemClock.now_ms());
    records
        .put_attempt(&attempt)
        .await
        .map_err(|error| BridgeError::new("glosses.persistence_failed", error.message))?;
    core.emit(UiEvent::GlossesReady {
        attempt_id: request.attempt_id,
        key: key.clone(),
        glosses: glosses.clone(),
    });
    let _ = request.word_index;
    Ok(GlossesResponse { key, glosses })
}

async fn ensure_phrase(core: &Core, payload: Value) -> Result<PhraseResponse, BridgeError> {
    let request: PhraseRequest = parse(PHRASES_ENSURE, payload)?;
    let session = practice(core)?;
    let config = session.config();
    let records = core
        .hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let mut attempt = records
        .get_attempt(&request.attempt_id)
        .await
        .map_err(|error| BridgeError::new("phrases.persistence_failed", error.message))?
        .ok_or_else(|| {
            BridgeError::new("practice.attempt_not_found", "the attempt is not stored")
        })?;
    let key = gloss_key(&request.text, &config.instruction_language_id);
    let mut glosses_by_text = attempt.word_glosses.clone().unwrap_or_default();
    if let Some(existing) = glosses_by_text.get(&key) {
        if let Some(saved) = existing.phrases.iter().find(|phrase| {
            phrase.origin == "selection"
                && phrase.start == request.start
                && phrase.end == request.end
        }) {
            return Ok(PhraseResponse {
                meaning: saved.meaning.clone(),
            });
        }
    }

    let evaluator = rust_evaluator(core.host_rpc().clone());
    let meaning = evaluator
        .phrase(
            &request.phrase,
            &request.text,
            &config.llm_endpoint,
            &config.target_language_name,
            &config.instruction_language_name,
            &CancelToken::new(),
        )
        .await
        .map_err(core_error)?;
    let entry = glosses_by_text
        .entry(key)
        .or_insert_with(|| onspot_domain::TextGlosses {
            words: Vec::new(),
            phrases: Vec::new(),
            pos: None,
            pos_sections: None,
            sections: None,
        });
    entry.phrases.push(onspot_domain::PhraseGloss {
        start: request.start,
        end: request.end,
        meaning: meaning.clone(),
        origin: String::from("selection"),
    });
    attempt.word_glosses = Some(glosses_by_text);
    attempt.updated_at = now_rfc3339(SystemClock.now_ms());
    records
        .put_attempt(&attempt)
        .await
        .map_err(|error| BridgeError::new("phrases.persistence_failed", error.message))?;
    core.emit(UiEvent::PhraseReady {
        attempt_id: request.attempt_id,
        meaning: meaning.clone(),
    });
    Ok(PhraseResponse { meaning })
}

/// The Insights page payload.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct InsightsResponse {
    pub data: onspot_app::InsightsData,
}

async fn build_insights(core: &Core) -> Result<InsightsResponse, BridgeError> {
    let history = core
        .hosts()
        .history
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let records = core
        .hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let sessions = history
        .list_sessions()
        .await
        .map_err(|error| BridgeError::new("insights.persistence_failed", error.message))?;
    let attempts = records
        .list_all_attempts()
        .await
        .map_err(|error| BridgeError::new("insights.persistence_failed", error.message))?;
    let corrections = records
        .list_all_corrections()
        .await
        .map_err(|error| BridgeError::new("insights.persistence_failed", error.message))?;
    Ok(InsightsResponse {
        data: onspot_app::compute_insights(&sessions, &attempts, &corrections),
    })
}

/// `translations.ensure` arguments.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRequest {
    pub attempt_id: String,
}

/// The generated translation set.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TranslationResponse {
    pub translations: onspot_domain::TranslationSet,
}

async fn ensure_translations(
    core: &Core,
    payload: Value,
) -> Result<TranslationResponse, BridgeError> {
    let request: AttemptRequest = parse(TRANSLATIONS_ENSURE, payload)?;
    let session = practice(core)?;
    let config = session.config();
    let records = core
        .hosts()
        .records
        .clone()
        .ok_or_else(|| BridgeError::unavailable("storage"))?;
    let mut attempt = records
        .get_attempt(&request.attempt_id)
        .await
        .map_err(|error| BridgeError::new("translations.persistence_failed", error.message))?
        .ok_or_else(|| {
            BridgeError::new("practice.attempt_not_found", "the attempt is not stored")
        })?;
    let text = attempt
        .corrected_text
        .clone()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| attempt.transcript.clone());
    let evaluator = rust_evaluator(core.host_rpc().clone());
    let mut translations = evaluator
        .translate(
            &text,
            &config.llm_endpoint,
            &config.target_language_name,
            &config.instruction_language_name,
            &CancelToken::new(),
        )
        .await
        .map_err(core_error)?;
    translations.instruction_language = Some(config.instruction_language_id.clone());
    attempt.translation = Some(translations.idiomatic.clone());
    attempt.translations = Some(translations.clone());
    attempt.updated_at = now_rfc3339(SystemClock.now_ms());
    records
        .put_attempt(&attempt)
        .await
        .map_err(|error| BridgeError::new("translations.persistence_failed", error.message))?;
    core.emit(UiEvent::TranslationsReady {
        attempt_id: request.attempt_id,
        translations: translations.clone(),
    });
    Ok(TranslationResponse { translations })
}

fn now_rfc3339(now_ms: u64) -> String {
    let seconds = (now_ms / 1000).min(i64::MAX as u64) as i64;
    let millis = (now_ms % 1000) as u32;
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .map(|datetime| {
            datetime
                .replace_nanosecond(millis * 1_000_000)
                .unwrap_or(datetime)
        })
        .and_then(|datetime| {
            datetime
                .format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_else(|| String::from("1970-01-01T00:00:00Z"))
}

fn host_reply(core: &Core, payload: Value) -> Result<AcceptedResponse, BridgeError> {
    let request: HostReplyRequest = parse(CORE_HOST_REPLY, payload)?;
    let reply = match request.error {
        Some(error) => Err(CoreError::new(error.code, error.message)),
        None => Ok(request.result.unwrap_or(Value::Null)),
    };
    Ok(AcceptedResponse {
        accepted: core.host_rpc().reply(request.id, reply),
    })
}

fn core_error(error: CoreError) -> BridgeError {
    BridgeError::new(&error.code, error.message)
}

async fn call<T: for<'de> Deserialize<'de>>(
    rpc: &onspot_app::HostRpc,
    method: &str,
    payload: Value,
) -> Result<T, CoreError> {
    let value = rpc.call(method, payload).await?;
    serde_json::from_value(value).map_err(|error| {
        CoreError::new(
            "core.host_invalid_reply",
            format!("the driver's {method} reply was invalid: {error}"),
        )
    })
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl AudioCapture for RpcCapture {
    async fn start(
        &self,
        options: &CaptureOptions,
        _levels: Arc<dyn AudioLevelSink>,
    ) -> Result<(), CoreError> {
        call::<Value>(&self.0, "capture.start", json!(options))
            .await
            .map(|_| ())
    }

    async fn stop(&self) -> Result<AudioFrame, CoreError> {
        call(&self.0, "capture.stop", Value::Null).await
    }

    async fn cancel(&self) -> Result<(), CoreError> {
        call::<Value>(&self.0, "capture.cancel", Value::Null)
            .await
            .map(|_| ())
    }
}

struct RpcCapture(Arc<onspot_app::HostRpc>);

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SttEngine for RpcStt {
    async fn transcribe(
        &self,
        frame: &AudioFrame,
        options: &SttOptions,
        _progress: &dyn SttProgressSink,
        _token: &CancelToken,
    ) -> Result<Transcript, CoreError> {
        // The driver already holds the frame it returned from `capture.stop`;
        // sending the PCM and blob back across the event channel would double
        // a minute of audio.
        let _ = frame;
        call(&self.0, "stt.transcribe", json!({ "options": options })).await
    }
}

struct RpcStt(Arc<onspot_app::HostRpc>);

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl TtsEngine for RpcTts {
    async fn synthesize(
        &self,
        piece: &SpeechPiece,
        _token: &CancelToken,
    ) -> Result<AudioClip, CoreError> {
        call(&self.0, "tts.synthesize", json!(piece)).await
    }
}

struct RpcTts(Arc<onspot_app::HostRpc>);

struct RpcPlayback;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl AudioPlayback for RpcPlayback {
    fn prime(&self) {}

    async fn play(&self, _request: PlaybackRequest) -> Result<(), CoreError> {
        Ok(())
    }

    fn stop(&self) {}
}

struct RpcHttp(Arc<onspot_app::HostRpc>);

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl HttpClient for RpcHttp {
    async fn send(
        &self,
        request: &HttpRequest,
        _token: &CancelToken,
    ) -> Result<HttpResponse, CoreError> {
        call(&self.0, "http.request", json!(request)).await
    }
}

fn rust_evaluator(rpc: Arc<onspot_app::HostRpc>) -> Arc<dyn LlmProvider> {
    Arc::new(onspot_adapter_llm_openai::client::OpenAiEvaluator::new(
        Arc::new(RpcHttp(rpc)),
        Arc::new(SystemClock),
    ))
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl PromptSource for RpcPrompts {
    async fn write(
        &self,
        request: &PromptRequest,
        _token: &CancelToken,
    ) -> Result<Option<GeneratedPrompt>, CoreError> {
        call(&self.0, "prompt.write", json!(request)).await
    }
}

struct RpcPrompts(Arc<onspot_app::HostRpc>);

struct SystemClock;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map_or(0, |duration| {
                duration.as_millis().min(u128::from(u64::MAX)) as u64
            })
    }

    async fn sleep(&self, milliseconds: u64, token: &CancelToken) -> bool {
        let mut remaining = milliseconds;
        while remaining > 0 {
            if token.is_cancelled() {
                return false;
            }
            let slice = remaining.min(50);
            futures_timer::Delay::new(std::time::Duration::from_millis(slice)).await;
            remaining -= slice;
        }
        !token.is_cancelled()
    }
}

#[derive(Default)]
struct BridgeIds {
    counter: AtomicU64,
}

impl IdSource for BridgeIds {
    fn new_id(&self, prefix: &str) -> String {
        let number = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        let millis = web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis());
        format!("{prefix}-{millis:x}-{number:x}")
    }

    fn random_index(&self, upper: usize) -> usize {
        if upper == 0 {
            return 0;
        }
        let number = self.counter.fetch_add(1, Ordering::Relaxed) ^ self.now_xor();
        (number as usize) % upper
    }
}

impl BridgeIds {
    fn now_xor(&self) -> u64 {
        web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map_or(0, |duration| duration.subsec_nanos() as u64)
    }
}

#[cfg(test)]
mod tests;
