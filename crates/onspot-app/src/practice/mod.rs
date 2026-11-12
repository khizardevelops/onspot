// SPDX-License-Identifier: AGPL-3.0-or-later

//! The practice run: one state machine over the speech ports and repositories.
//!
//! This is the first slice of `RunPracticeSession` (P3): drafts, recording,
//! the synchronous stop claim, silence rejection, transcription, evaluation,
//! persistence and the active take. Prompt selection, resume and the view
//! adapter land next; the ports and persistence order are already fixed.

mod config;
mod persist;
mod view;

use std::sync::{Arc, Mutex, MutexGuard};

use crate::events::{EventSink, UiEvent};
use onspot_domain::{Attempt, Prompt, Session};
use onspot_dsp::speech::{cap_words, is_silent, MAX_ATTEMPT_WORDS};
use onspot_ports::{
    AudioCapture, AudioLevelSink, AudioPlayback, CancelToken, CaptureOptions, Clock, CoreError,
    EvaluationPort, HistoryStore, IdSource, ModelProgress, PlaybackRequest, PromptRequest,
    PromptSource, RecordsStore, SpeechPiece, SpeechTrack, SttEngine, SttOptions, SttProgressSink,
    TtsEngine,
};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub use config::PracticeConfig;
pub use view::{AttemptView, ErrorView, PracticePhase, PracticeSnapshot, ProgressView, PromptView};

/// Every outward capability one practice run needs.
pub struct PracticePorts {
    pub events: Arc<dyn EventSink>,
    pub records: Arc<dyn RecordsStore>,
    pub history: Arc<dyn HistoryStore>,
    pub capture: Arc<dyn AudioCapture>,
    pub stt: Arc<dyn SttEngine>,
    pub tts: Arc<dyn TtsEngine>,
    pub playback: Arc<dyn AudioPlayback>,
    pub clock: Arc<dyn Clock>,
    pub evaluation: Arc<dyn EvaluationPort>,
    pub prompts: Arc<dyn PromptSource>,
    pub ids: Arc<dyn IdSource>,
}

const TIMER_TICK_MS: u64 = 250;

struct Inner {
    config: PracticeConfig,
    snapshot: PracticeSnapshot,
    starting: bool,
    run: u64,
    take_token: Option<CancelToken>,
    recording_started_ms: Option<u64>,
}

/// The practice use cases over one open session.
pub struct RunPracticeSession {
    ports: PracticePorts,
    inner: Arc<Mutex<Inner>>,
}

impl RunPracticeSession {
    /// Creates a draft session with the supplied ports and settings.
    pub fn new(ports: PracticePorts, config: PracticeConfig) -> Self {
        let snapshot = PracticeSnapshot::empty(config.mode.clone());
        Self {
            ports,
            inner: Arc::new(Mutex::new(Inner {
                config,
                snapshot,
                starting: false,
                run: 0,
                take_token: None,
                recording_started_ms: None,
            })),
        }
    }

    /// The settings this session was configured with.
    pub fn config(&self) -> PracticeConfig {
        self.lock().config.clone()
    }

    /// The current snapshot.
    pub fn snapshot(&self) -> PracticeSnapshot {
        self.lock().snapshot.clone()
    }

    fn emit_state(&self) {
        let snapshot = self.snapshot();
        self.ports.events.emit(&UiEvent::PracticeStateChanged {
            snapshot: Box::new(snapshot),
        });
    }

    /// Replaces the driver-supplied settings, keeping the open session's mode.
    pub fn configure(&self, config: PracticeConfig) {
        let mut inner = self.lock();
        inner.config = config;
        inner.snapshot.explanation_audio_available = inner.config.explanation_audio_available;
        if inner.snapshot.session_id.is_none() {
            inner.snapshot.mode = inner.config.mode.clone();
        }
    }

    /// Shows a prompt chosen by the driver or by `next_prompt`.
    pub fn set_prompt(&self, prompt: PromptView) {
        self.lock().snapshot.prompt = prompt;
        self.emit_state();
    }

    /// Chooses a prompt from stored candidates, avoiding the current one.
    ///
    /// Catalogue data and generation stay in the driver during P3; the core
    /// owns the "may the prompt change now?" guard and the choice.
    pub fn next_prompt(
        &self,
        candidates: &[PromptView],
        english_fallback: bool,
    ) -> Option<PromptView> {
        if candidates.is_empty() {
            return None;
        }
        let mut inner = self.lock();
        if !matches!(
            inner.snapshot.phase,
            PracticePhase::Idle | PracticePhase::Error
        ) {
            return None;
        }

        let current = inner.snapshot.prompt.id.clone();
        let pool: Vec<&PromptView> = candidates
            .iter()
            .filter(|candidate| candidate.id != current)
            .collect();
        let pool = if pool.is_empty() {
            candidates.iter().collect()
        } else {
            pool
        };
        let index = self.ports.ids.random_index(pool.len()).min(pool.len() - 1);
        let mut chosen = pool[index].clone();
        chosen.english_fallback = english_fallback;
        inner.snapshot.prompt = chosen.clone();
        drop(inner);
        self.emit_state();
        Some(chosen)
    }

    /// Loads a stored session and its takes, the resume path after a restart.
    pub async fn resume_session(
        &self,
        session: Session,
        attempts: Vec<Attempt>,
    ) -> Result<bool, CoreError> {
        let mut views = Vec::with_capacity(attempts.len());
        for attempt in &attempts {
            let corrections = self
                .ports
                .records
                .list_corrections(&attempt.id)
                .await
                .map_err(persist::store)?;
            views.push(AttemptView {
                attempt: attempt.clone(),
                corrections,
            });
        }

        let prompt = attempts
            .last()
            .map(|attempt| PromptView {
                id: attempt.prompt_id.clone().unwrap_or_default(),
                title: session.title.clone(),
                text: attempt.prompt_text.clone(),
                english_fallback: false,
            })
            .unwrap_or_else(|| PromptView {
                id: String::new(),
                title: session.title.clone(),
                text: String::new(),
                english_fallback: false,
            });

        self.abandon_take().await;
        let mut inner = self.lock();
        let mode = session.mode.clone();
        let mut snapshot = PracticeSnapshot::empty(mode);
        snapshot.session_id = Some(session.id);
        snapshot.prompt = prompt;
        snapshot.active_attempt_id = views.last().map(|view| view.attempt.id.clone());
        snapshot.attempts = views;
        snapshot.explanation_audio_available = inner.config.explanation_audio_available;
        inner.snapshot = snapshot;
        drop(inner);
        self.emit_state();
        Ok(true)
    }

    /// Resumes the most recently created stored session, if any.
    pub async fn resume_last_session(&self) -> Result<bool, CoreError> {
        let sessions = self
            .ports
            .history
            .list_sessions()
            .await
            .map_err(persist::store)?;
        let Some(session) = sessions.into_iter().next() else {
            return Ok(false);
        };
        let attempts = self
            .ports
            .records
            .list_attempts(&session.id)
            .await
            .map_err(persist::store)?;
        self.resume_session(session, attempts).await
    }

    /// Asks the driver's model for a prompt, falling back to a stored choice.
    ///
    /// Catalogue data stays in the driver in P3; the core owns the phase guard,
    /// stores a generated prompt and makes sure a late answer cannot replace a
    /// newer session or prompt.
    pub async fn request_prompt(
        &self,
        candidates: &[PromptView],
        english_fallback: bool,
    ) -> Option<PromptView> {
        let (run, config, current, can_change) = {
            let inner = self.lock();
            (
                inner.run,
                inner.config.clone(),
                inner.snapshot.prompt.id.clone(),
                matches!(
                    inner.snapshot.phase,
                    PracticePhase::Idle | PracticePhase::Error
                ),
            )
        };
        if !can_change {
            return None;
        }

        let request = PromptRequest {
            target_language_id: config.target_language_id.clone(),
            instruction_language_id: config.instruction_language_id.clone(),
            level: config.level.clone(),
            mode: config.mode.clone(),
            avoid_topics: candidates
                .iter()
                .map(|candidate| candidate.title.clone())
                .collect(),
        };
        let generated = self
            .ports
            .prompts
            .write(&request, &CancelToken::new())
            .await
            .ok()
            .flatten();

        if let Some(generated) = generated {
            let now = now_rfc3339(self.ports.clock.now_ms());
            let prompt = Prompt {
                id: self.ports.ids.new_id("prompt"),
                title: generated.title,
                text: generated.text,
                category: Some(String::from("generated")),
                language: Some(config.target_language_id),
                instruction_language: config.instruction_language_id,
                created_at: now,
            };
            if let Err(error) = self.ports.records.put_prompt(&prompt).await {
                eprintln!(
                    "[practice] could not store the generated prompt: {}",
                    error.message
                );
            }

            let mut inner = self.lock();
            if inner.run != run
                || !matches!(
                    inner.snapshot.phase,
                    PracticePhase::Idle | PracticePhase::Error
                )
            {
                return None;
            }
            let chosen = PromptView {
                id: prompt.id,
                title: prompt.title,
                text: prompt.text,
                english_fallback: false,
            };
            inner.snapshot.prompt = chosen.clone();
            drop(inner);
            self.emit_state();
            return Some(chosen);
        }

        let mut inner = self.lock();
        if inner.run != run {
            return None;
        }
        let pool: Vec<&PromptView> = candidates
            .iter()
            .filter(|candidate| candidate.id != current)
            .collect();
        let pool = if pool.is_empty() {
            candidates.iter().collect()
        } else {
            pool
        };
        if pool.is_empty() {
            return None;
        }
        let index = self.ports.ids.random_index(pool.len()).min(pool.len() - 1);
        let mut chosen = pool[index].clone();
        chosen.english_fallback = english_fallback;
        inner.snapshot.prompt = chosen.clone();
        drop(inner);
        self.emit_state();
        Some(chosen)
    }

    /// Loads one stored session by id.
    pub async fn open_session(&self, session_id: &str) -> Result<bool, CoreError> {
        let Some(session) = self
            .ports
            .records
            .get_session(session_id)
            .await
            .map_err(persist::store)?
        else {
            return Ok(false);
        };
        let attempts = self
            .ports
            .records
            .list_attempts(session_id)
            .await
            .map_err(persist::store)?;
        self.resume_session(session, attempts).await?;
        Ok(true)
    }

    /// Renames a stored session and the open prompt title.
    pub async fn rename_session(&self, session_id: &str, title: &str) -> Result<bool, CoreError> {
        let Some(mut session) = self
            .ports
            .records
            .get_session(session_id)
            .await
            .map_err(persist::store)?
        else {
            return Ok(false);
        };
        session.title = String::from(title);
        session.updated_at = now_rfc3339(self.ports.clock.now_ms());
        self.ports
            .records
            .put_session(&session)
            .await
            .map_err(persist::store)?;
        {
            let mut inner = self.lock();
            if inner.snapshot.session_id.as_deref() == Some(session_id) {
                inner.snapshot.prompt.title = String::from(title);
            }
        }
        self.emit_state();
        Ok(true)
    }

    /// Deletes a stored session; an open one becomes an empty draft.
    pub async fn delete_session(&self, session_id: &str) -> Result<bool, CoreError> {
        let changed = self
            .ports
            .history
            .delete_session(session_id)
            .await
            .map_err(persist::store)?;
        if changed {
            let is_open = self.lock().snapshot.session_id.as_deref() == Some(session_id);
            if is_open {
                self.start_session().await;
            }
        }
        Ok(changed)
    }

    /// Persists a new read-back voice for one stored take.
    pub async fn set_attempt_voice(&self, attempt_id: &str, voice: &str) -> Result<(), CoreError> {
        let mut attempt = {
            let inner = self.lock();
            inner
                .snapshot
                .attempts
                .iter()
                .find(|view| view.attempt.id == attempt_id)
                .map(|view| view.attempt.clone())
        }
        .ok_or_else(|| {
            CoreError::new(
                "practice.attempt_not_found",
                "the attempt is not in the open session",
            )
        })?;
        attempt.tts_voice = Some(String::from(voice));
        attempt.updated_at = now_rfc3339(self.ports.clock.now_ms());
        self.ports
            .records
            .put_attempt(&attempt)
            .await
            .map_err(persist::store)?;

        let mut inner = self.lock();
        if let Some(view) = inner
            .snapshot
            .attempts
            .iter_mut()
            .find(|view| view.attempt.id == attempt_id)
        {
            view.attempt = attempt;
        }
        drop(inner);
        self.emit_state();
        Ok(())
    }

    /// Updates the live microphone level while a take is recording.
    pub fn set_level(&self, level: f32) {
        let mut inner = self.lock();
        if inner.snapshot.phase != PracticePhase::Recording {
            return;
        }
        inner.snapshot.level = level;
        drop(inner);
        self.ports.events.emit(&UiEvent::AudioLevel { level });
    }

    /// Updates recognizer progress while a take is transcribing.
    pub fn set_progress(&self, progress: ModelProgress) {
        let mut inner = self.lock();
        if inner.snapshot.phase != PracticePhase::Transcribing {
            return;
        }
        inner.snapshot.progress = Some(progress.clone().into());
        inner.snapshot.status_text = progress.status.clone();
        drop(inner);
        self.ports.events.emit(&UiEvent::TranscriptionProgress {
            progress: progress.progress,
            status: progress.status,
        });
    }

    /// Asks the driver to speak one stored take's track.
    pub fn request_track(&self, attempt_id: &str, kind: &str) -> Result<(), CoreError> {
        self.require_attempt(attempt_id)?;
        self.ports.events.emit(&UiEvent::SpeakTrack {
            attempt_id: String::from(attempt_id),
            kind: String::from(kind),
        });
        Ok(())
    }

    /// Asks the driver to speak one sentence of a take.
    pub fn request_segment(
        &self,
        attempt_id: &str,
        text: &str,
        index: u32,
    ) -> Result<(), CoreError> {
        self.require_attempt(attempt_id)?;
        self.ports.events.emit(&UiEvent::PlaySegment {
            attempt_id: String::from(attempt_id),
            text: String::from(text),
            index,
        });
        Ok(())
    }

    /// Asks the driver to speak arbitrary text.
    pub fn request_speak_text(&self, text: &str) {
        self.ports.events.emit(&UiEvent::SpeakText {
            text: String::from(text),
        });
    }

    /// Asks the driver to play one take's stored recording.
    pub fn request_recording(&self, attempt_id: &str) -> Result<(), CoreError> {
        self.require_attempt(attempt_id)?;
        self.ports.events.emit(&UiEvent::PlayRecording {
            attempt_id: String::from(attempt_id),
        });
        Ok(())
    }

    fn require_attempt(&self, attempt_id: &str) -> Result<(), CoreError> {
        let inner = self.lock();
        if inner
            .snapshot
            .attempts
            .iter()
            .any(|view| view.attempt.id == attempt_id)
        {
            Ok(())
        } else {
            Err(CoreError::new(
                "practice.attempt_not_found",
                "the attempt is not in the open session",
            ))
        }
    }

    /// Starts a fresh draft, dropping the open session and its takes.
    pub async fn start_session(&self) {
        self.abandon_take().await;
        let mut inner = self.lock();
        inner.snapshot = PracticeSnapshot::empty(inner.config.mode.clone());
        inner.snapshot.explanation_audio_available = inner.config.explanation_audio_available;
        drop(inner);
        self.emit_state();
    }

    /// Discards the take in progress and returns to idle.
    pub async fn cancel_recording(&self) {
        self.abandon_take().await;
        let mut inner = self.lock();
        inner.snapshot.phase = PracticePhase::Idle;
        inner.snapshot.elapsed_seconds = 0.0;
        inner.snapshot.level = 0.0;
        inner.snapshot.status_text.clear();
        inner.snapshot.progress = None;
        drop(inner);
        self.emit_state();
    }

    /// Starts capturing a take. A second call while starting or busy is a no-op.
    pub async fn start_recording(&self) -> Result<(), CoreError> {
        let (token, capture, clock, playback) = {
            let mut inner = self.lock();
            if inner.starting
                || !matches!(
                    inner.snapshot.phase,
                    PracticePhase::Idle | PracticePhase::Error
                )
            {
                return Ok(());
            }

            inner.starting = true;
            inner.run += 1;
            let token = CancelToken::new();
            inner.take_token = Some(token.clone());
            inner.snapshot.error = None;
            inner.snapshot.level = 0.0;
            (
                token,
                Arc::clone(&self.ports.capture),
                Arc::clone(&self.ports.clock),
                Arc::clone(&self.ports.playback),
            )
        };

        playback.stop();
        playback.prime();

        let levels: Arc<dyn AudioLevelSink> = Arc::new(LevelSink {
            inner: Arc::clone(&self.inner),
            events: Arc::clone(&self.ports.events),
        });
        let options = CaptureOptions {
            max_seconds: self.lock().config.max_seconds,
        };
        if let Err(error) = capture.start(&options, levels).await {
            let mut inner = self.lock();
            inner.starting = false;
            if inner
                .take_token
                .as_ref()
                .is_some_and(|active| active.same(&token))
            {
                inner.snapshot.phase = PracticePhase::Error;
                inner.snapshot.error = Some(ErrorView {
                    code: String::from("practice.microphone_unavailable"),
                    message: error.message.clone(),
                });
                drop(inner);
                self.emit_state();
                self.ports.events.emit(&UiEvent::Error {
                    code: String::from("practice.microphone_unavailable"),
                    message: error.message.clone(),
                });
            }
            return Err(error);
        }

        let active = {
            let mut inner = self.lock();
            inner.starting = false;
            let active = inner
                .take_token
                .as_ref()
                .is_some_and(|active| active.same(&token));
            if active {
                inner.recording_started_ms = Some(clock.now_ms());
                inner.snapshot.phase = PracticePhase::Recording;
                inner.snapshot.elapsed_seconds = 0.0;
                inner.snapshot.error = None;
                inner.snapshot.status_text = String::from("Recording…");
                inner.snapshot.progress = None;
            }
            active
        };
        if !active {
            let _ = capture.cancel().await;
            return Ok(());
        }

        self.emit_state();
        Ok(())
    }

    /// Advances the recording clock and stops at the configured limit.
    pub async fn tick(&self) -> Result<(), CoreError> {
        let should_stop = {
            let mut inner = self.lock();
            if inner.snapshot.phase != PracticePhase::Recording {
                return Ok(());
            }

            let started = inner
                .recording_started_ms
                .unwrap_or_else(|| self.ports.clock.now_ms());
            let elapsed = self.ports.clock.now_ms().saturating_sub(started) as f64 / 1000.0;
            inner.snapshot.elapsed_seconds = elapsed;
            elapsed >= f64::from(inner.config.max_seconds)
        };

        if should_stop {
            self.stop_and_analyze().await?;
        }
        Ok(())
    }

    /// Runs the 250 ms recording timer until the take ends or is cancelled.
    ///
    /// The bridge owns the task runtime; the core only owns the cadence.
    pub async fn run_recording_timer(&self) {
        loop {
            let token = {
                let inner = self.lock();
                if inner.snapshot.phase != PracticePhase::Recording {
                    return;
                }
                match &inner.take_token {
                    Some(token) => token.clone(),
                    None => return,
                }
            };

            if !self.ports.clock.sleep(TIMER_TICK_MS, &token).await {
                return;
            }
            if self.tick().await.is_err() {
                return;
            }
        }
    }

    /// Stops the claimed take, rejects silence, transcribes, evaluates and
    /// persists it. The claim happens before the first await, so a double click
    /// or the 60 s timer cannot stop the same take twice.
    pub async fn stop_and_analyze(&self) -> Result<(), CoreError> {
        let (token, capture) = {
            let mut inner = self.lock();
            if inner.snapshot.phase != PracticePhase::Recording {
                return Ok(());
            }

            let token = match &inner.take_token {
                Some(token) => token.clone(),
                None => return Ok(()),
            };
            inner.snapshot.phase = PracticePhase::Transcribing;
            inner.snapshot.status_text = String::from("Transcribing…");
            inner.snapshot.progress = None;
            inner.snapshot.level = 0.0;
            drop(inner);
            self.emit_state();
            (token, Arc::clone(&self.ports.capture))
        };

        let recording = match capture.stop().await {
            Ok(recording) => recording,
            Err(error) => {
                if !token.is_cancelled() {
                    self.fail_with("practice.recording_failed", error.message);
                }
                return Ok(());
            }
        };

        if token.is_cancelled() {
            return Ok(());
        }

        if is_silent(&recording.pcm, recording.sample_rate) {
            self.ports.events.emit(&UiEvent::TakeSilent);
            self.fail_with("practice.take_silent", "No speech was heard in that take.");
            return Ok(());
        }

        let config = self.lock().config.clone();
        let progress = Arc::new(ProgressSink {
            inner: Arc::clone(&self.inner),
            events: Arc::clone(&self.ports.events),
        });
        let heard = match self
            .ports
            .stt
            .transcribe(
                &recording,
                &SttOptions {
                    language_id: config.target_language_id.clone(),
                    mode: config.stt_mode,
                },
                progress.as_ref(),
                &token,
            )
            .await
        {
            Ok(heard) => heard,
            Err(error) => {
                if !token.is_cancelled() {
                    self.fail_with("practice.transcription_failed", error.message);
                }
                return Ok(());
            }
        };

        if token.is_cancelled() {
            return Ok(());
        }

        let transcript = cap_words(&heard.text, MAX_ATTEMPT_WORDS);
        self.update_status(
            PracticePhase::Evaluating,
            format!("Analyzing your {}…", config.target_language_name),
        );
        self.ports.events.emit(&UiEvent::EvaluationStarted);

        let (prompt_text, evaluation_mode) = {
            let inner = self.lock();
            (
                inner.snapshot.prompt.text.clone(),
                inner.snapshot.mode.clone(),
            )
        };
        let evaluation = match self
            .ports
            .evaluation
            .evaluate(
                &onspot_domain::EvaluationRequest {
                    transcript: transcript.clone(),
                    prompt: prompt_text,
                    mode: evaluation_mode,
                    level: config.level.clone(),
                    language: config.target_language_name.clone(),
                    translation_target: config.instruction_language_name.clone(),
                    endpoint: config.llm_endpoint.clone(),
                },
                &token,
            )
            .await
        {
            Ok(evaluation) => evaluation,
            Err(error) => {
                if !token.is_cancelled() {
                    self.ports
                        .events
                        .emit(&UiEvent::EvaluationFinished { ok: false });
                    self.fail_with("practice.evaluation_failed", error.message);
                }
                return Ok(());
            }
        };
        self.ports
            .events
            .emit(&UiEvent::EvaluationFinished { ok: true });

        if token.is_cancelled() {
            return Ok(());
        }

        let persisted = {
            let prompt = {
                let inner = self.lock();
                Prompt {
                    id: inner.snapshot.prompt.id.clone(),
                    title: inner.snapshot.prompt.title.clone(),
                    text: inner.snapshot.prompt.text.clone(),
                    category: None,
                    language: Some(config.target_language_id.clone()),
                    instruction_language: config.instruction_language_id.clone(),
                    created_at: now_rfc3339(self.ports.clock.now_ms()),
                }
            };
            let mode = self.lock().snapshot.mode.clone();
            let session_id = self.lock().snapshot.session_id.clone();
            let now = now_rfc3339(self.ports.clock.now_ms());
            let take = persist::PersistTake {
                records: self.ports.records.as_ref(),
                ids: self.ports.ids.as_ref(),
                config: &config,
                prompt: &prompt,
                mode: &mode,
                existing_session_id: session_id.as_deref(),
                transcript: &transcript,
                evaluation: &evaluation,
                recording: &recording,
                now: &now,
            };

            match persist::persist_take(take).await {
                Ok(persisted) => persisted,
                Err(error) => {
                    if !token.is_cancelled() {
                        self.fail_with(&error.code, error.message);
                    }
                    return Ok(());
                }
            }
        };

        if token.is_cancelled() {
            return Ok(());
        }

        {
            let mut inner = self.lock();
            inner.snapshot.session_id = Some(persisted.session_id.clone());
            inner.snapshot.attempts.push(AttemptView {
                attempt: persisted.attempt.clone(),
                corrections: persisted.corrections,
            });
            inner.snapshot.active_attempt_id = Some(persisted.attempt.id.clone());
            inner.snapshot.phase = PracticePhase::Idle;
            inner.snapshot.status_text.clear();
            inner.snapshot.error = None;
            inner.snapshot.elapsed_seconds = 0.0;
            inner.snapshot.level = 0.0;
            inner.snapshot.progress = None;
            inner.take_token = None;
            inner.recording_started_ms = None;
        }
        self.ports.events.emit(&UiEvent::AttemptPersisted {
            attempt_id: persisted.attempt.id.clone(),
        });
        self.emit_state();
        let kind = if config.explanation_audio_available
            && persisted
                .attempt
                .explanation
                .as_ref()
                .is_some_and(|text| !text.trim().is_empty())
        {
            "explanation"
        } else {
            "corrected"
        };
        self.ports.events.emit(&UiEvent::SpeakTrack {
            attempt_id: persisted.attempt.id.clone(),
            kind: String::from(kind),
        });
        Ok(())
    }

    /// Marks one stored take as active.
    pub fn set_active_attempt(&self, attempt_id: Option<&str>) {
        let mut inner = self.lock();
        let found = attempt_id
            .filter(|id| {
                inner
                    .snapshot
                    .attempts
                    .iter()
                    .any(|view| view.attempt.id == *id)
            })
            .map(String::from);
        inner.snapshot.active_attempt_id = found;
        drop(inner);
        self.emit_state();
    }

    /// Dismisses an error without disturbing a live phase.
    pub fn clear_error(&self) {
        let mut inner = self.lock();
        inner.snapshot.error = None;
        if inner.snapshot.phase == PracticePhase::Error {
            inner.snapshot.phase = PracticePhase::Idle;
        }
    }

    /// Speaks one track of a stored take.
    pub async fn speak_attempt_track(
        &self,
        attempt_id: &str,
        track: SpeechTrack,
    ) -> Result<(), CoreError> {
        let (attempt, config) = {
            let inner = self.lock();
            let attempt = inner
                .snapshot
                .attempts
                .iter()
                .find(|view| view.attempt.id == attempt_id)
                .map(|view| view.attempt.clone());
            (attempt, inner.config.clone())
        };

        let Some(attempt) = attempt else {
            return Err(CoreError::new(
                "practice.attempt_not_found",
                "the attempt is not in the open session",
            ));
        };
        let text = match track {
            SpeechTrack::Said => attempt.transcript.clone(),
            SpeechTrack::Corrected => attempt
                .corrected_text
                .clone()
                .unwrap_or_else(|| attempt.transcript.clone()),
            SpeechTrack::FollowUp => attempt
                .follow_up
                .as_ref()
                .map(|follow_up| follow_up.question.clone())
                .unwrap_or_default(),
            _ => attempt
                .corrected_text
                .clone()
                .unwrap_or_else(|| attempt.transcript.clone()),
        };
        if text.trim().is_empty() {
            return Ok(());
        }

        let clip = self
            .ports
            .tts
            .synthesize(
                &SpeechPiece {
                    text: text.clone(),
                    language_id: config.target_language_id.clone(),
                    voice: attempt
                        .tts_voice
                        .clone()
                        .unwrap_or_else(|| config.tts_voice.clone()),
                    mode: config.tts_mode,
                    pace: config.pace,
                    attempt_id: Some(attempt.id.clone()),
                    force: false,
                },
                &CancelToken::new(),
            )
            .await?;

        self.ports
            .playback
            .play(PlaybackRequest {
                attempt_id: attempt.id.clone(),
                track,
                label: text,
                segment_index: None,
                clip,
            })
            .await
    }

    fn fail_with(&self, code: &str, message: impl Into<String>) {
        let message = message.into();
        let mut inner = self.lock();
        inner.snapshot.phase = PracticePhase::Error;
        inner.snapshot.status_text.clear();
        inner.snapshot.progress = None;
        inner.snapshot.error = Some(ErrorView {
            code: String::from(code),
            message: message.clone(),
        });
        inner.snapshot.elapsed_seconds = 0.0;
        inner.snapshot.level = 0.0;
        inner.take_token = None;
        inner.recording_started_ms = None;
        drop(inner);
        self.emit_state();
        self.ports.events.emit(&UiEvent::Error {
            code: String::from(code),
            message,
        });
    }

    fn update_status(&self, phase: PracticePhase, status: String) {
        let mut inner = self.lock();
        inner.snapshot.phase = phase;
        inner.snapshot.status_text = status;
        inner.snapshot.progress = None;
        drop(inner);
        self.emit_state();
    }

    async fn abandon_take(&self) {
        let (token, capture, playback) = {
            let mut inner = self.lock();
            inner.run += 1;
            let token = inner.take_token.take();
            inner.starting = false;
            inner.recording_started_ms = None;
            (
                token,
                Arc::clone(&self.ports.capture),
                Arc::clone(&self.ports.playback),
            )
        };

        if let Some(token) = token {
            token.cancel();
        }
        playback.stop();
        let _ = capture.cancel().await;
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().expect("practice state lock")
    }
}

struct LevelSink {
    inner: Arc<Mutex<Inner>>,
    events: Arc<dyn EventSink>,
}

impl AudioLevelSink for LevelSink {
    fn level(&self, level: f32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.snapshot.level = level;
            drop(inner);
            self.events.emit(&UiEvent::AudioLevel { level });
        }
    }
}

struct ProgressSink {
    inner: Arc<Mutex<Inner>>,
    events: Arc<dyn EventSink>,
}

impl SttProgressSink for ProgressSink {
    fn progress(&self, progress: &ModelProgress) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.snapshot.progress = Some(progress.clone().into());
            inner.snapshot.status_text = progress.status.clone();
            drop(inner);
            self.events.emit(&UiEvent::TranscriptionProgress {
                progress: progress.progress,
                status: progress.status.clone(),
            });
        }
    }
}

fn now_rfc3339(now_ms: u64) -> String {
    let seconds = (now_ms / 1000).min(i64::MAX as u64) as i64;
    let millis = (now_ms % 1000) as u32;
    OffsetDateTime::from_unix_timestamp(seconds)
        .ok()
        .map(|datetime| {
            datetime
                .replace_nanosecond(millis * 1_000_000)
                .unwrap_or(datetime)
        })
        .and_then(|datetime| datetime.format(&Rfc3339).ok())
        .unwrap_or_else(|| String::from("1970-01-01T00:00:00Z"))
}

#[cfg(test)]
mod tests;
