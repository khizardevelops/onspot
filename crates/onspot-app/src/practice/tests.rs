// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::events::{EventSink, UiEvent};
use async_trait::async_trait;
use futures::executor::block_on;
use onspot_adapter_repo_sql::{migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore};
use onspot_domain::{
    ConnectorSuggestion, EvaluationRequest, EvaluationResult, FollowUp, VocabularySuggestion,
};
use onspot_ports::{
    AudioCapture, AudioClip, AudioFrame, AudioLevelSink, AudioPlayback, BlobHandle, CancelToken,
    CaptureOptions, Clock, CoreError, EngineMode, EvaluationPort, GeneratedPrompt, IdSource,
    ModelProgress, PlaybackRequest, PromptRequest, PromptSource, RecordsStore, SpeechPiece,
    SttEngine, SttOptions, SttProgressSink, Transcript, TtsEngine,
};

use super::{
    persist::build_corrections, PracticeConfig, PracticePhase, PracticePorts, RunPracticeSession,
};

#[derive(Default)]
struct RecordingSink(Mutex<Vec<UiEvent>>);

impl EventSink for RecordingSink {
    fn emit(&self, event: &UiEvent) {
        self.0.lock().expect("events").push(event.clone());
    }
}

struct FakeCapture {
    silent: bool,
    starts: AtomicUsize,
    stops: AtomicUsize,
    cancels: AtomicUsize,
}

#[async_trait]
impl AudioCapture for FakeCapture {
    async fn start(
        &self,
        _options: &CaptureOptions,
        levels: Arc<dyn AudioLevelSink>,
    ) -> Result<(), CoreError> {
        self.starts.fetch_add(1, Ordering::SeqCst);
        levels.level(0.4);
        Ok(())
    }

    async fn stop(&self) -> Result<AudioFrame, CoreError> {
        self.stops.fetch_add(1, Ordering::SeqCst);
        let level = if self.silent { 0.0 } else { 0.1 };
        Ok(AudioFrame {
            pcm: vec![level; 3_200],
            sample_rate: 16_000,
            blob: BlobHandle {
                mime: String::from("audio/webm"),
                bytes: vec![1, 2, 3],
            },
            duration_sec: 2.5,
        })
    }

    async fn cancel(&self) -> Result<(), CoreError> {
        self.cancels.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct FakeStt;

#[async_trait]
impl SttEngine for FakeStt {
    async fn transcribe(
        &self,
        _frame: &AudioFrame,
        _options: &SttOptions,
        progress: &dyn SttProgressSink,
        _token: &CancelToken,
    ) -> Result<Transcript, CoreError> {
        progress.progress(&ModelProgress {
            progress: 90.0,
            status: String::from("loading"),
        });
        Ok(Transcript {
            text: String::from("bonjour le monde"),
        })
    }
}

struct FakeTts;

#[async_trait]
impl TtsEngine for FakeTts {
    async fn synthesize(
        &self,
        piece: &SpeechPiece,
        _token: &CancelToken,
    ) -> Result<AudioClip, CoreError> {
        Ok(AudioClip {
            mime: String::from("audio/ogg"),
            bytes: piece.text.as_bytes().to_vec(),
        })
    }
}

#[derive(Default)]
struct FakePlayback {
    played: Mutex<Vec<PlaybackRequest>>,
    stops: AtomicUsize,
    primes: AtomicUsize,
}

#[async_trait]
impl AudioPlayback for FakePlayback {
    fn prime(&self) {
        self.primes.fetch_add(1, Ordering::SeqCst);
    }

    async fn play(&self, request: PlaybackRequest) -> Result<(), CoreError> {
        self.played.lock().expect("played").push(request);
        Ok(())
    }

    fn stop(&self) {
        self.stops.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeClock {
    now: AtomicU64,
}

impl FakeClock {
    fn new(now: u64) -> Self {
        Self {
            now: AtomicU64::new(now),
        }
    }

    fn set(&self, now: u64) {
        self.now.store(now, Ordering::SeqCst);
    }
}

#[async_trait]
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }

    async fn sleep(&self, _milliseconds: u64, token: &CancelToken) -> bool {
        !token.is_cancelled()
    }
}

struct FakeEvaluation {
    called: AtomicBool,
}

#[async_trait]
impl EvaluationPort for FakeEvaluation {
    async fn evaluate(
        &self,
        _request: &EvaluationRequest,
        _token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        self.called.store(true, Ordering::SeqCst);
        Ok(EvaluationResult {
            corrected_text: String::from("Bonjour le monde."),
            explanation: String::from("Bien."),
            follow_up: Some(FollowUp {
                question: String::from("Et ensuite ?"),
                translation: String::from("And then?"),
            }),
            corrections: Vec::new(),
            vocabulary: vec![VocabularySuggestion {
                original: String::from("bonjour"),
                suggestion: String::from("salut"),
                why: String::from("casual"),
            }],
            connectors: vec![ConnectorSuggestion {
                connector: String::from("ensuite"),
                instead_of: Some(String::from("et")),
                why: String::from("flow"),
            }],
        })
    }
}

struct GatedStt {
    started: Mutex<Option<futures::channel::oneshot::Sender<()>>>,
    gate: Mutex<Option<futures::channel::oneshot::Receiver<()>>>,
}

#[async_trait]
impl SttEngine for GatedStt {
    async fn transcribe(
        &self,
        _frame: &AudioFrame,
        _options: &SttOptions,
        _progress: &dyn SttProgressSink,
        _token: &CancelToken,
    ) -> Result<Transcript, CoreError> {
        if let Some(started) = self.started.lock().expect("started").take() {
            let _ = started.send(());
        }
        let gate = self.gate.lock().expect("gate").take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        Ok(Transcript {
            text: String::from("bonjour"),
        })
    }
}

struct GatedEvaluation {
    started: Mutex<Option<futures::channel::oneshot::Sender<()>>>,
    gate: Mutex<Option<futures::channel::oneshot::Receiver<()>>>,
}

#[async_trait]
impl EvaluationPort for GatedEvaluation {
    async fn evaluate(
        &self,
        _request: &EvaluationRequest,
        _token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        if let Some(started) = self.started.lock().expect("started").take() {
            let _ = started.send(());
        }
        let gate = self.gate.lock().expect("gate").take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        Ok(EvaluationResult {
            corrected_text: String::from("Bonjour."),
            explanation: String::from("Bien."),
            follow_up: None,
            corrections: Vec::new(),
            vocabulary: Vec::new(),
            connectors: Vec::new(),
        })
    }
}

struct FakePrompt;

#[async_trait]
impl PromptSource for FakePrompt {
    async fn write(
        &self,
        _request: &PromptRequest,
        _token: &CancelToken,
    ) -> Result<Option<GeneratedPrompt>, CoreError> {
        Ok(None)
    }
}

struct FakeIds {
    next: AtomicU64,
}

impl IdSource for FakeIds {
    fn new_id(&self, prefix: &str) -> String {
        let number = self.next.fetch_add(1, Ordering::SeqCst);
        format!("{prefix}-{number}")
    }

    fn random_index(&self, _upper: usize) -> usize {
        0
    }
}

fn config() -> PracticeConfig {
    PracticeConfig {
        target_language_id: String::from("fr"),
        target_language_name: String::from("French"),
        instruction_language_id: String::from("en"),
        instruction_language_name: String::from("English"),
        level: String::from("b1"),
        mode: String::from("exam"),
        tts_mode: EngineMode::Local,
        stt_mode: EngineMode::Local,
        tts_voice: String::from("fr_FR-siwis"),
        explanation_voice: String::from("en_US-amy"),
        pace: 1.0,
        explanation_audio_available: true,
        max_seconds: 60,
    }
}

struct Harness {
    session: RunPracticeSession,
    capture: Arc<FakeCapture>,
    playback: Arc<FakePlayback>,
    clock: Arc<FakeClock>,
    records: Arc<SqlRecordsStore>,
    events: Arc<RecordingSink>,
}

fn harness(silent: bool) -> Harness {
    harness_with(
        silent,
        Arc::new(FakeStt),
        Arc::new(FakeEvaluation {
            called: AtomicBool::new(false),
        }),
    )
}

fn harness_with(
    silent: bool,
    stt: Arc<dyn SttEngine>,
    evaluation: Arc<dyn EvaluationPort>,
) -> Harness {
    let driver = Arc::new(RusqliteDriver::open_in_memory().expect("in-memory database"));
    block_on(migrate(driver.as_ref())).expect("schema migrates");
    let history = Arc::new(SqlHistoryStore::new(driver.clone()));
    let records = Arc::new(SqlRecordsStore::new(driver));
    let capture = Arc::new(FakeCapture {
        silent,
        starts: AtomicUsize::new(0),
        stops: AtomicUsize::new(0),
        cancels: AtomicUsize::new(0),
    });
    let playback = Arc::new(FakePlayback::default());
    let clock = Arc::new(FakeClock::new(1_700_000_000_000));
    let events = Arc::new(RecordingSink::default());

    let ports = PracticePorts {
        events: events.clone() as Arc<dyn EventSink>,
        records: records.clone(),
        history: history.clone(),
        capture: capture.clone(),
        stt,
        tts: Arc::new(FakeTts),
        playback: playback.clone(),
        clock: clock.clone(),
        evaluation,
        prompts: Arc::new(FakePrompt),
        ids: Arc::new(FakeIds {
            next: AtomicU64::new(1),
        }),
    };
    let session = RunPracticeSession::new(ports, config());
    session.set_prompt(super::PromptView {
        id: String::from("p-1"),
        title: String::from("Le marché"),
        text: String::from("Racontez votre matinée au marché."),
        english_fallback: false,
    });

    Harness {
        session,
        capture,
        playback,
        clock,
        records,
        events,
    }
}

#[test]
fn stop_without_a_recording_is_a_noop() {
    let harness = harness(false);
    block_on(harness.session.stop_and_analyze()).expect("no-op");
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Idle);
    assert_eq!(harness.capture.stops.load(Ordering::SeqCst), 0);
}

#[test]
fn a_finished_take_is_persisted_with_corrections_audio_and_playback() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Recording);
    assert_eq!(harness.session.snapshot().level, 0.4);

    block_on(harness.session.stop_and_analyze()).expect("stops");

    let snapshot = harness.session.snapshot();
    assert_eq!(snapshot.phase, PracticePhase::Idle);
    assert_eq!(snapshot.attempts.len(), 1);
    assert_eq!(snapshot.attempts[0].attempt.transcript, "bonjour le monde");
    assert_eq!(
        snapshot.attempts[0].attempt.corrected_text.as_deref(),
        Some("Bonjour le monde.")
    );
    assert_eq!(snapshot.attempts[0].corrections.len(), 2);
    assert_eq!(snapshot.active_attempt_id.as_deref(), Some("attempt-2"));
    assert!(snapshot.session_id.is_some());
    assert_eq!(harness.playback.played.lock().expect("played").len(), 0);
    let events = harness.events.0.lock().expect("events");
    assert!(events.iter().any(|event| matches!(
        event,
        UiEvent::PracticeStateChanged { snapshot }
            if snapshot.phase == PracticePhase::Idle && snapshot.attempts.len() == 1
    )));
    assert!(events
        .iter()
        .any(|event| matches!(event, UiEvent::AttemptPersisted { .. })));
    assert!(events.iter().any(|event| matches!(
        event,
        UiEvent::SpeakTrack { kind, .. } if kind == "explanation"
    )));
    drop(events);

    let session_id = snapshot.session_id.expect("session id");
    let attempts = block_on(harness.records.list_attempts(&session_id)).expect("attempts");
    assert_eq!(attempts.len(), 1);
    let corrections =
        block_on(harness.records.list_corrections(&attempts[0].id)).expect("corrections");
    assert_eq!(corrections.len(), 2);
    let audio = block_on(
        harness
            .records
            .get_audio(&format!("attempt:{}", attempts[0].id)),
    )
    .expect("audio read")
    .expect("audio row");
    assert_eq!(audio.mime, "audio/webm");
    assert_eq!(audio.data_base64, "AQID");
}

#[test]
fn a_silent_take_is_rejected_before_transcription() {
    let harness = harness(true);
    block_on(harness.session.start_recording()).expect("starts");
    block_on(harness.session.stop_and_analyze()).expect("stops");

    let snapshot = harness.session.snapshot();
    assert_eq!(snapshot.phase, PracticePhase::Error);
    assert_eq!(
        snapshot.error.as_ref().map(|error| error.code.as_str()),
        Some("practice.take_silent")
    );
    assert!(snapshot.attempts.is_empty());
}

#[test]
fn the_take_is_claimed_before_the_first_await() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");

    block_on(async {
        let (first, second) = futures::join!(
            harness.session.stop_and_analyze(),
            harness.session.stop_and_analyze()
        );
        first.expect("first stop");
        second.expect("second stop");
    });

    assert_eq!(harness.capture.stops.load(Ordering::SeqCst), 1);
    assert_eq!(harness.session.snapshot().attempts.len(), 1);
}

#[test]
fn the_timer_stops_at_the_limit() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");

    harness.clock.set(1_700_000_000_000 + 59_000);
    block_on(harness.session.tick()).expect("ticks");
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Recording);

    harness.clock.set(1_700_000_000_000 + 60_000);
    block_on(harness.session.tick()).expect("ticks past the limit");
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Idle);
    assert_eq!(harness.session.snapshot().attempts.len(), 1);
}

#[test]
fn corrections_mark_utf16_ranges_and_claim_distinct_occurrences() {
    let ids = FakeIds {
        next: AtomicU64::new(1),
    };
    let mut evaluation = EvaluationResult {
        corrected_text: String::new(),
        explanation: String::new(),
        follow_up: None,
        corrections: Vec::new(),
        vocabulary: Vec::new(),
        connectors: Vec::new(),
    };
    evaluation.corrections = vec![
        onspot_domain::EvaluationCorrection {
            category: String::from("grammar"),
            severity: String::from("error"),
            label: String::from("x"),
            original: String::from("é"),
            replacement: String::from("e"),
            replacement_translation: None,
            explanation: String::new(),
            speak_text: None,
            exam_status: None,
            formal_alternatives: Vec::new(),
        },
        onspot_domain::EvaluationCorrection {
            category: String::from("grammar"),
            severity: String::from("error"),
            label: String::from("x"),
            original: String::from("é"),
            replacement: String::from("e"),
            replacement_translation: None,
            explanation: String::new(),
            speak_text: None,
            exam_status: None,
            formal_alternatives: Vec::new(),
        },
    ];

    let rows = build_corrections(&ids, "a-1", "éé", &evaluation, "now");
    assert_eq!((rows[0].start, rows[0].end), (Some(0), Some(1)));
    assert_eq!((rows[1].start, rows[1].end), (Some(1), Some(2)));
}

#[test]
fn next_prompt_avoids_the_current_prompt_and_waits_between_takes() {
    let harness = harness(false);
    let candidates = vec![
        super::PromptView {
            id: String::from("p-1"),
            title: String::from("Le marché"),
            text: String::from("Racontez votre matinée au marché."),
            english_fallback: false,
        },
        super::PromptView {
            id: String::from("p-2"),
            title: String::from("Le train"),
            text: String::from("Racontez un voyage en train."),
            english_fallback: false,
        },
    ];
    let chosen = harness
        .session
        .next_prompt(&candidates, true)
        .expect("a prompt is chosen");
    assert_eq!(chosen.id, "p-2");
    assert!(chosen.english_fallback);
    assert_eq!(harness.session.snapshot().prompt.id, "p-2");

    block_on(harness.session.start_recording()).expect("starts");
    assert!(harness.session.next_prompt(&candidates, false).is_none());
}

#[test]
fn resume_restores_the_last_session_with_corrections() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");
    block_on(harness.session.stop_and_analyze()).expect("stops");
    let session_id = harness.session.snapshot().session_id.expect("session id");

    block_on(harness.session.start_session());
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Idle);
    assert!(harness.session.snapshot().attempts.is_empty());

    let resumed = block_on(harness.session.resume_last_session()).expect("resumes");
    assert!(resumed);
    let snapshot = harness.session.snapshot();
    assert_eq!(snapshot.session_id.as_deref(), Some(session_id.as_str()));
    assert_eq!(snapshot.attempts.len(), 1);
    assert_eq!(snapshot.attempts[0].corrections.len(), 2);
    assert_eq!(snapshot.prompt.text, "Racontez votre matinée au marché.");
    assert_eq!(
        snapshot.active_attempt_id.as_deref(),
        Some(snapshot.attempts[0].attempt.id.as_str())
    );
}

#[test]
fn resume_without_stored_sessions_reports_false() {
    let harness = harness(false);
    let resumed = block_on(harness.session.resume_last_session()).expect("resumes");
    assert!(!resumed);
}

#[test]
fn cancelling_during_transcription_discards_the_take() {
    let (started_tx, started_rx) = futures::channel::oneshot::channel();
    let (gate_tx, gate_rx) = futures::channel::oneshot::channel();
    let harness = harness_with(
        false,
        Arc::new(GatedStt {
            started: Mutex::new(Some(started_tx)),
            gate: Mutex::new(Some(gate_rx)),
        }),
        Arc::new(FakeEvaluation {
            called: AtomicBool::new(false),
        }),
    );
    block_on(harness.session.start_recording()).expect("starts");

    block_on(async {
        let stop = harness.session.stop_and_analyze();
        let cancel = async {
            let _ = started_rx.await;
            harness.session.cancel_recording().await;
            let _ = gate_tx.send(());
        };
        let (stopped, ()) = futures::join!(stop, cancel);
        stopped.expect("stop returns");
    });

    let snapshot = harness.session.snapshot();
    assert_eq!(snapshot.phase, PracticePhase::Idle);
    assert!(snapshot.attempts.is_empty());
}

#[test]
fn cancelling_during_evaluation_discards_the_take() {
    let (started_tx, started_rx) = futures::channel::oneshot::channel();
    let (gate_tx, gate_rx) = futures::channel::oneshot::channel();
    let harness = harness_with(
        false,
        Arc::new(FakeStt),
        Arc::new(GatedEvaluation {
            started: Mutex::new(Some(started_tx)),
            gate: Mutex::new(Some(gate_rx)),
        }),
    );
    block_on(harness.session.start_recording()).expect("starts");

    block_on(async {
        let stop = harness.session.stop_and_analyze();
        let cancel = async {
            let _ = started_rx.await;
            harness.session.cancel_recording().await;
            let _ = gate_tx.send(());
        };
        let (stopped, ()) = futures::join!(stop, cancel);
        stopped.expect("stop returns");
    });

    let snapshot = harness.session.snapshot();
    assert_eq!(snapshot.phase, PracticePhase::Idle);
    assert!(snapshot.attempts.is_empty());
}

#[test]
fn a_new_take_cannot_start_while_evaluation_runs() {
    let (started_tx, started_rx) = futures::channel::oneshot::channel();
    let (gate_tx, gate_rx) = futures::channel::oneshot::channel();
    let harness = harness_with(
        false,
        Arc::new(FakeStt),
        Arc::new(GatedEvaluation {
            started: Mutex::new(Some(started_tx)),
            gate: Mutex::new(Some(gate_rx)),
        }),
    );
    block_on(harness.session.start_recording()).expect("starts");

    block_on(async {
        let stop = harness.session.stop_and_analyze();
        let restart = async {
            let _ = started_rx.await;
            harness.session.start_recording().await.expect("refused");
            assert_eq!(harness.capture.starts.load(Ordering::SeqCst), 1);
            let _ = gate_tx.send(());
        };
        let (stopped, ()) = futures::join!(stop, restart);
        stopped.expect("stop returns");
    });

    assert_eq!(harness.session.snapshot().attempts.len(), 1);
}

#[test]
fn the_timer_cannot_double_stop_a_click() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");
    harness.clock.set(1_700_000_000_000 + 60_000);

    block_on(async {
        let (click, timer) =
            futures::join!(harness.session.stop_and_analyze(), harness.session.tick());
        click.expect("click");
        timer.expect("timer");
    });

    assert_eq!(harness.capture.stops.load(Ordering::SeqCst), 1);
    assert_eq!(harness.session.snapshot().attempts.len(), 1);
}

#[test]
fn the_event_stream_names_every_phase_of_a_take() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");
    block_on(harness.session.stop_and_analyze()).expect("stops");

    let events = harness.events.0.lock().expect("events");
    let names: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            UiEvent::PracticeStateChanged { snapshot } => Some(snapshot.phase),
            _ => None,
        })
        .map(|phase| match phase {
            PracticePhase::Idle => "idle",
            PracticePhase::Recording => "recording",
            PracticePhase::Transcribing => "transcribing",
            PracticePhase::Evaluating => "evaluating",
            PracticePhase::Error => "error",
        })
        .collect();
    assert_eq!(
        names,
        vec!["idle", "recording", "transcribing", "evaluating", "idle"]
    );
    assert!(events
        .iter()
        .any(|event| matches!(event, UiEvent::EvaluationStarted)));
    assert!(events
        .iter()
        .any(|event| matches!(event, UiEvent::AttemptPersisted { .. })));
}

#[test]
fn set_active_attempt_ignores_unknown_ids() {
    let harness = harness(false);
    block_on(harness.session.start_recording()).expect("starts");
    block_on(harness.session.stop_and_analyze()).expect("stops");

    harness.session.set_active_attempt(Some("missing"));
    assert_eq!(harness.session.snapshot().active_attempt_id, None);

    harness.session.clear_error();
    assert_eq!(harness.session.snapshot().phase, PracticePhase::Idle);
}
