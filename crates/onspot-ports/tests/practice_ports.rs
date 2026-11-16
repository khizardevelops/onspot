// SPDX-License-Identifier: AGPL-3.0-or-later

//! Contract shape for the P3 practice ports: each trait is object-safe, calls
//! cross through `dyn`, cancellation is visible, and requests carry no secret.

#![cfg(not(target_arch = "wasm32"))]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::executor::block_on;

use onspot_domain::{
    ConnectorSuggestion, EvaluationCorrection, EvaluationRequest, EvaluationResult, FollowUp,
    VocabularySuggestion,
};
use onspot_ports::{
    AudioCapture, AudioClip, AudioFrame, AudioLevelSink, AudioPlayback, BlobHandle, CancelToken,
    CaptureOptions, Clock, CoreError, EngineMode, EvaluationPort, GeneratedPrompt, ModelProgress,
    PlaybackRequest, PromptRequest, PromptSource, SpeechPiece, SpeechTrack, SttEngine, SttOptions,
    SttProgressSink, Transcript, TtsEngine,
};

struct FakeCapture {
    started: AtomicUsize,
    cancelled: AtomicUsize,
}

#[async_trait]
impl AudioCapture for FakeCapture {
    async fn start(
        &self,
        _options: &CaptureOptions,
        levels: Arc<dyn AudioLevelSink>,
    ) -> Result<(), CoreError> {
        self.started.fetch_add(1, Ordering::SeqCst);
        levels.level(0.5);
        Ok(())
    }

    async fn stop(&self) -> Result<AudioFrame, CoreError> {
        Ok(AudioFrame {
            pcm: vec![0.1, 0.2],
            sample_rate: 16_000,
            blob: BlobHandle {
                mime: String::from("audio/webm"),
                bytes: vec![1, 2, 3],
            },
            duration_sec: 1.5,
        })
    }

    async fn cancel(&self) -> Result<(), CoreError> {
        self.cancelled.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct RecordingLevels(Mutex<Vec<f32>>);

impl AudioLevelSink for RecordingLevels {
    fn level(&self, level: f32) {
        self.0.lock().expect("levels").push(level);
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
        token: &CancelToken,
    ) -> Result<Transcript, CoreError> {
        if token.is_cancelled() {
            return Err(token.error());
        }
        progress.progress(&ModelProgress {
            progress: 100.0,
            status: String::from("ready"),
        });
        Ok(Transcript {
            text: String::from("bonjour"),
        })
    }
}

struct FakeProgress(Mutex<Vec<f32>>);

impl SttProgressSink for FakeProgress {
    fn progress(&self, progress: &ModelProgress) {
        self.0.lock().expect("progress").push(progress.progress);
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
    primed: AtomicUsize,
    played: Mutex<Vec<PlaybackRequest>>,
    stopped: AtomicUsize,
}

#[async_trait]
impl AudioPlayback for FakePlayback {
    fn prime(&self) {
        self.primed.fetch_add(1, Ordering::SeqCst);
    }

    async fn play(&self, request: PlaybackRequest) -> Result<(), CoreError> {
        self.played.lock().expect("played").push(request);
        Ok(())
    }

    fn stop(&self) {
        self.stopped.fetch_add(1, Ordering::SeqCst);
    }
}

struct FakeClock;

#[async_trait]
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        42
    }

    async fn sleep(&self, _milliseconds: u64, token: &CancelToken) -> bool {
        !token.is_cancelled()
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
        Ok(Some(GeneratedPrompt {
            title: String::from("Le marché"),
            text: String::from("Racontez votre matinée au marché."),
        }))
    }
}

struct FakeEvaluation;

#[async_trait]
impl EvaluationPort for FakeEvaluation {
    async fn evaluate(
        &self,
        request: &EvaluationRequest,
        _token: &CancelToken,
    ) -> Result<EvaluationResult, CoreError> {
        Ok(EvaluationResult {
            corrected_text: request.transcript.clone(),
            explanation: String::from("Bien."),
            follow_up: Some(FollowUp {
                question: String::from("Et ensuite ?"),
                translation: String::from("And then?"),
            }),
            corrections: vec![EvaluationCorrection {
                category: String::from("grammar"),
                severity: String::from("error"),
                label: String::from("Article"),
                original: String::from("le"),
                replacement: String::from("la"),
                replacement_translation: Some(String::from("the")),
                explanation: String::from("Feminine noun."),
                speak_text: None,
                exam_status: None,
                formal_alternatives: Vec::new(),
            }],
            vocabulary: vec![VocabularySuggestion {
                original: String::from("bon"),
                suggestion: String::from("excellent"),
                why: String::from("stronger"),
            }],
            connectors: vec![ConnectorSuggestion {
                connector: String::from("ensuite"),
                instead_of: Some(String::from("et")),
                why: String::from("flow"),
            }],
        })
    }
}

#[test]
fn every_practice_port_is_object_safe() {
    let capture: Arc<dyn AudioCapture> = Arc::new(FakeCapture {
        started: AtomicUsize::new(0),
        cancelled: AtomicUsize::new(0),
    });
    let stt: Arc<dyn SttEngine> = Arc::new(FakeStt);
    let tts: Arc<dyn TtsEngine> = Arc::new(FakeTts);
    let playback = Arc::new(FakePlayback::default());
    let playback_port: Arc<dyn AudioPlayback> = playback.clone();
    let clock: Arc<dyn Clock> = Arc::new(FakeClock);
    let prompt: Arc<dyn PromptSource> = Arc::new(FakePrompt);
    let evaluation: Arc<dyn EvaluationPort> = Arc::new(FakeEvaluation);

    let levels = Arc::new(RecordingLevels(Mutex::new(Vec::new())));
    block_on(capture.start(&CaptureOptions { max_seconds: 60 }, levels.clone()))
        .expect("capture starts");
    assert_eq!(*levels.0.lock().expect("levels"), vec![0.5]);

    let frame = block_on(capture.stop()).expect("capture stops");
    let progress = FakeProgress(Mutex::new(Vec::new()));
    let token = CancelToken::new();
    let heard = block_on(stt.transcribe(
        &frame,
        &SttOptions {
            language_id: String::from("fr"),
            mode: EngineMode::Local,
        },
        &progress,
        &token,
    ))
    .expect("stt runs");
    assert_eq!(heard.text, "bonjour");
    assert_eq!(*progress.0.lock().expect("progress"), vec![100.0]);

    let clip = block_on(tts.synthesize(
        &SpeechPiece {
            text: String::from("bonjour"),
            language_id: String::from("fr"),
            voice: String::from("fr_FR-siwis"),
            mode: EngineMode::Local,
            pace: 1.0,
            attempt_id: None,
            force: false,
        },
        &token,
    ))
    .expect("tts runs");
    assert_eq!(clip.bytes, b"bonjour");

    playback_port.prime();
    block_on(playback_port.play(PlaybackRequest {
        attempt_id: String::from("a-1"),
        track: SpeechTrack::Corrected,
        label: String::from("Correct version"),
        segment_index: None,
        clip,
    }))
    .expect("playback starts");
    assert_eq!(playback.primed.load(Ordering::SeqCst), 1);
    assert_eq!(playback.played.lock().expect("played").len(), 1);

    assert_eq!(clock.now_ms(), 42);
    assert!(block_on(clock.sleep(10, &token)));
    token.cancel();
    assert!(!block_on(clock.sleep(10, &token)));

    let written = block_on(prompt.write(
        &PromptRequest {
            target_language_id: String::from("fr"),
            target_language: String::from("French"),
            instruction_language_id: String::from("en"),
            instruction_language: String::from("English"),
            instruction_scripts: vec![String::from("Latin")],
            level: String::from("b1"),
            mode: String::from("exam"),
            avoid_topics: Vec::new(),
            endpoint: onspot_domain::LlmEndpoint {
                key_id: String::new(),
                base_url: String::from("http://localhost:1234/v1"),
                provider: String::from("custom"),
                model: String::from("stub"),
                fallback_models: Vec::new(),
            },
        },
        &token,
    ))
    .expect("prompt writes")
    .expect("a prompt");
    assert_eq!(written.title, "Le marché");

    let evaluated = block_on(evaluation.evaluate(
        &EvaluationRequest {
            transcript: String::from("bonjour"),
            prompt: String::from("Décrivez votre matinée."),
            mode: String::from("exam"),
            level: String::from("b1"),
            language: String::from("French"),
            translation_target: String::from("English"),
            endpoint: onspot_domain::LlmEndpoint {
                key_id: String::new(),
                base_url: String::from("http://localhost:1234/v1"),
                provider: String::from("custom"),
                model: String::from("stub"),
                fallback_models: Vec::new(),
            },
        },
        &token,
    ))
    .expect("evaluation runs");
    assert_eq!(evaluated.corrections.len(), 1);
}

#[test]
fn cancellation_is_visible_to_an_engine() {
    let stt: Arc<dyn SttEngine> = Arc::new(FakeStt);
    let frame = AudioFrame {
        pcm: Vec::new(),
        sample_rate: 16_000,
        blob: BlobHandle {
            mime: String::from("audio/webm"),
            bytes: Vec::new(),
        },
        duration_sec: 0.0,
    };
    let token = CancelToken::new();
    token.cancel();

    let error = block_on(stt.transcribe(
        &frame,
        &SttOptions {
            language_id: String::from("fr"),
            mode: EngineMode::Local,
        },
        &FakeProgress(Mutex::new(Vec::new())),
        &token,
    ))
    .expect_err("cancelled");
    assert_eq!(error.code, onspot_ports::CANCELLED_CODE);
}
