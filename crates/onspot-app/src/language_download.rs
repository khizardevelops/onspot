// SPDX-License-Identifier: AGPL-3.0-or-later

//! One language-data download, driven by the core.
//!
//! The planner says which parts are missing; this session fetches them in the
//! order the learner needs them and folds the worker's per-part progress into
//! one figure. The bytes still come from the driver: a cache and a worker are
//! host capabilities, so `LanguageDataInstaller` is a port.

use std::sync::{Arc, Mutex};

use onspot_ports::{
    CancelToken, CoreError, DownloadProgressSink, LanguageDataInstaller, ModelProgress,
};

use crate::events::{EventSink, UiEvent};
use crate::language::{plan_language_data, LanguagePlan, LanguagePlanInput, PendingBytes};

/// What the driver shows while a download runs, and once it ends.
#[derive(Debug, Clone, PartialEq)]
pub struct LanguageDownloadSnapshot {
    /// `downloading`, `ready`, `cancelled` or `error`.
    pub status: String,
    /// Combined 0–100 progress across the required parts.
    pub progress: f32,
    /// What the planner still counted as missing when the download started.
    pub pending: PendingBytes,
    /// True only after every required part finished.
    pub ready: bool,
    /// The worker's latest status line, for the progress bar.
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadPart {
    Stt,
    Voice,
    ExplanationVoice,
}

impl DownloadPart {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stt => "stt",
            Self::Voice => "voice",
            Self::ExplanationVoice => "explanation_voice",
        }
    }

    fn missing_bytes(self, plan: &LanguagePlan) -> u32 {
        match self {
            Self::Stt => plan.pending.stt,
            Self::Voice => plan.pending.voice,
            Self::ExplanationVoice => plan.pending.explanation_voice,
        }
    }
}

struct ProgressState {
    status: String,
    progress: f32,
    label: String,
    completed: f64,
    part: Option<DownloadPart>,
    part_bytes: u32,
    part_share: f64,
    total_bytes: u32,
}

impl ProgressState {
    fn new(total_bytes: u32) -> Self {
        Self {
            status: String::from("downloading"),
            progress: 0.0,
            label: String::new(),
            completed: 0.0,
            part: None,
            part_bytes: 0,
            part_share: 0.0,
            total_bytes,
        }
    }
}

/// One download for one language selection.
pub struct RunLanguageDownload {
    input: LanguagePlanInput,
    installer: Arc<dyn LanguageDataInstaller>,
    events: Arc<dyn EventSink>,
    token: CancelToken,
    state: Mutex<ProgressState>,
}

impl RunLanguageDownload {
    /// Creates the session from the driver's cache state and processing choices.
    pub fn new(
        input: LanguagePlanInput,
        installer: Arc<dyn LanguageDataInstaller>,
        events: Arc<dyn EventSink>,
    ) -> Self {
        let plan = plan_language_data(&input);
        Self {
            input,
            installer,
            events,
            token: CancelToken::new(),
            state: Mutex::new(ProgressState::new(plan.pending.storage)),
        }
    }

    /// The current view of the download.
    pub fn snapshot(&self) -> LanguageDownloadSnapshot {
        let plan = plan_language_data(&self.input);
        let state = self.state.lock().expect("download state");
        LanguageDownloadSnapshot {
            status: state.status.clone(),
            progress: state.progress,
            pending: plan.pending,
            ready: state.status == "ready",
            label: state.label.clone(),
        }
    }

    /// Requests cancellation. The bridge also asks the driver to stop its worker.
    pub fn cancel(&self) {
        self.token.cancel();
        if let Ok(mut state) = self.state.lock() {
            state.status = String::from("cancelled");
        }
    }

    /// Applies progress forwarded by the driver while a host download runs.
    pub fn report_from_host(&self, progress: &ModelProgress) {
        let part = self.state.lock().ok().and_then(|state| state.part);
        if let Some(part) = part {
            self.report(part, progress);
        }
    }

    /// Fetches every missing part and folds the per-part progress together.
    pub async fn run(&self) -> Result<LanguageDownloadSnapshot, CoreError> {
        let plan = plan_language_data(&self.input);
        self.set_status("downloading");

        for part in [
            DownloadPart::Stt,
            DownloadPart::Voice,
            DownloadPart::ExplanationVoice,
        ] {
            let bytes = part.missing_bytes(&plan);
            if bytes == 0 {
                continue;
            }
            if self.token.is_cancelled() {
                return Ok(self.snapshot());
            }
            self.begin_part(part, bytes, plan.pending.storage);

            let sink = SessionSink {
                session: self,
                part,
            };
            let result = match part {
                DownloadPart::Stt => {
                    self.installer
                        .download_stt(&self.input.language_id, &sink, &self.token)
                        .await
                }
                DownloadPart::Voice => {
                    let voice_id = self.input.voice_id.as_deref().ok_or_else(|| {
                        CoreError::new(
                            "language.no_voice",
                            "the planner chose a voice download without a voice id",
                        )
                    })?;
                    self.installer
                        .download_voice(voice_id, &sink, &self.token)
                        .await
                }
                DownloadPart::ExplanationVoice => {
                    let voice_id = self.input.explanation_voice_id.as_deref().ok_or_else(|| {
                        CoreError::new(
                            "language.no_explanation_voice",
                            "the planner chose an explanation-voice download without a voice id",
                        )
                    })?;
                    self.installer
                        .download_voice(voice_id, &sink, &self.token)
                        .await
                }
            };

            match result {
                Ok(()) => self.finish_part(),
                Err(_) if self.token.is_cancelled() => return Ok(self.snapshot()),
                Err(error) => {
                    self.set_error(&error);
                    return Err(error);
                }
            }
        }

        if self.token.is_cancelled() {
            return Ok(self.snapshot());
        }
        self.finish();
        Ok(self.snapshot())
    }

    fn set_status(&self, status: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.status = status.to_owned();
        }
    }

    fn set_error(&self, error: &CoreError) {
        if let Ok(mut state) = self.state.lock() {
            state.status = String::from("error");
            state.label = error.message.clone();
        }
    }

    fn begin_part(&self, part: DownloadPart, bytes: u32, total: u32) {
        if let Ok(mut state) = self.state.lock() {
            state.part = Some(part);
            state.part_bytes = bytes;
            state.part_share = if total == 0 {
                0.0
            } else {
                (bytes as f64 / total as f64) * 100.0
            };
        }
        self.emit(part, 0, bytes, "", self.completed_progress());
    }

    fn report(&self, part: DownloadPart, progress: &ModelProgress) {
        let clamped = progress.progress.clamp(0.0, 100.0);
        let (overall, loaded, total) = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.part != Some(part) {
                return;
            }
            let overall = state.completed + (clamped as f64 / 100.0) * state.part_share;
            let loaded = (clamped as f64 / 100.0 * state.part_bytes as f64) as u32;
            state.progress = overall as f32;
            state.label = progress.status.clone();
            (overall as f32, loaded, state.part_bytes)
        };
        self.emit(part, loaded, total, &progress.status, overall);
    }

    fn finish_part(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.completed += state.part_share;
            state.progress = state.completed as f32;
            state.part = None;
        }
    }

    fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.status = String::from("ready");
            state.progress = 100.0;
            state.part = None;
            state.label = String::from("Language data installed.");
        }
        self.events.emit(&UiEvent::DownloadProgress {
            target: String::from("ready"),
            loaded_bytes: self.total_bytes(),
            total_bytes: self.total_bytes(),
            label: String::from("Language data installed."),
            progress: 100.0,
        });
    }

    fn completed_progress(&self) -> f32 {
        self.state
            .lock()
            .map(|state| state.progress)
            .unwrap_or_default()
    }

    fn total_bytes(&self) -> u32 {
        self.state
            .lock()
            .map(|state| state.total_bytes)
            .unwrap_or_default()
    }

    fn emit(&self, part: DownloadPart, loaded: u32, total: u32, label: &str, progress: f32) {
        self.events.emit(&UiEvent::DownloadProgress {
            target: part.as_str().to_owned(),
            loaded_bytes: loaded,
            total_bytes: total,
            label: label.to_owned(),
            progress,
        });
    }
}

struct SessionSink<'a> {
    session: &'a RunLanguageDownload,
    part: DownloadPart,
}

#[cfg(not(target_arch = "wasm32"))]
impl DownloadProgressSink for SessionSink<'_> {
    fn progress(&self, progress: &ModelProgress) {
        self.session.report(self.part, progress);
    }
}

#[cfg(target_arch = "wasm32")]
impl DownloadProgressSink for SessionSink<'_> {
    fn progress(&self, progress: &ModelProgress) {
        self.session.report(self.part, progress);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use futures::executor::block_on;

    use super::*;
    use crate::language::LanguageParts;

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<UiEvent>>);

    impl EventSink for RecordingSink {
        fn emit(&self, event: &UiEvent) {
            self.0.lock().expect("events").push(event.clone());
        }
    }

    struct FakeInstaller {
        calls: Mutex<Vec<String>>,
        fail_voice: bool,
    }

    impl FakeInstaller {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail_voice: false,
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait::async_trait]
    impl LanguageDataInstaller for FakeInstaller {
        async fn download_stt(
            &self,
            language_id: &str,
            progress: &dyn DownloadProgressSink,
            _token: &CancelToken,
        ) -> Result<(), CoreError> {
            self.calls
                .lock()
                .expect("calls")
                .push(format!("stt:{language_id}"));
            progress.progress(&ModelProgress {
                progress: 50.0,
                status: String::from("half"),
            });
            progress.progress(&ModelProgress {
                progress: 100.0,
                status: String::from("done"),
            });
            Ok(())
        }

        async fn download_voice(
            &self,
            voice_id: &str,
            progress: &dyn DownloadProgressSink,
            _token: &CancelToken,
        ) -> Result<(), CoreError> {
            self.calls
                .lock()
                .expect("calls")
                .push(format!("voice:{voice_id}"));
            if self.fail_voice {
                return Err(CoreError::new("language.download_failed", "voice failed"));
            }
            progress.progress(&ModelProgress {
                progress: 100.0,
                status: String::from("done"),
            });
            Ok(())
        }

        async fn cancel(&self) -> Result<(), CoreError> {
            Ok(())
        }
    }

    #[cfg(target_arch = "wasm32")]
    impl LanguageDataInstaller for FakeInstaller {
        async fn download_stt(
            &self,
            _language_id: &str,
            _progress: &dyn DownloadProgressSink,
            _token: &CancelToken,
        ) -> Result<(), CoreError> {
            Ok(())
        }

        async fn download_voice(
            &self,
            _voice_id: &str,
            _progress: &dyn DownloadProgressSink,
            _token: &CancelToken,
        ) -> Result<(), CoreError> {
            Ok(())
        }

        async fn cancel(&self) -> Result<(), CoreError> {
            Ok(())
        }
    }

    fn input(required_voice: bool) -> LanguagePlanInput {
        LanguagePlanInput {
            language_id: String::from("fr"),
            instruction_language_id: String::from("en"),
            native: true,
            required: LanguageParts {
                stt: true,
                voice: required_voice,
                explanation_voice: false,
            },
            installed: LanguageParts {
                stt: false,
                voice: false,
                explanation_voice: true,
            },
            voice_id: required_voice.then(|| String::from("piper-tom-medium")),
            explanation_voice_id: None,
            cached_assets: Vec::new(),
        }
    }

    #[test]
    fn downloads_missing_parts_in_order_and_folds_progress() {
        let installer = Arc::new(FakeInstaller::new());
        let events = Arc::new(RecordingSink::default());
        let session = RunLanguageDownload::new(
            input(true),
            installer.clone(),
            events.clone() as Arc<dyn EventSink>,
        );

        let snapshot = block_on(session.run()).expect("download");

        assert_eq!(snapshot.status, "ready");
        assert!(snapshot.ready);
        assert_eq!(snapshot.progress, 100.0);
        assert_eq!(
            *installer.calls.lock().expect("calls"),
            vec![
                String::from("stt:fr"),
                String::from("voice:piper-tom-medium")
            ]
        );

        let recorded = events.0.lock().expect("events");
        let progress_events: Vec<&UiEvent> = recorded
            .iter()
            .filter(|event| matches!(event, UiEvent::DownloadProgress { .. }))
            .collect();
        assert!(!progress_events.is_empty());
        let last = progress_events.last().expect("last event");
        assert!(matches!(
            last,
            UiEvent::DownloadProgress { progress, .. } if *progress == 100.0
        ));
    }

    #[test]
    fn an_installed_part_is_skipped() {
        let installer = Arc::new(FakeInstaller::new());
        let events = Arc::new(RecordingSink::default());
        let session = RunLanguageDownload::new(
            input(false),
            installer.clone(),
            events as Arc<dyn EventSink>,
        );

        let snapshot = block_on(session.run()).expect("download");

        assert_eq!(snapshot.status, "ready");
        assert_eq!(
            *installer.calls.lock().expect("calls"),
            vec![String::from("stt:fr")]
        );
    }

    #[test]
    fn a_failed_part_sets_the_error_state() {
        let installer = Arc::new(FakeInstaller {
            fail_voice: true,
            ..FakeInstaller::new()
        });
        let events = Arc::new(RecordingSink::default());
        let session =
            RunLanguageDownload::new(input(true), installer, events as Arc<dyn EventSink>);

        let error = block_on(session.run()).expect_err("voice fails");

        assert_eq!(error.code, "language.download_failed");
        assert_eq!(session.snapshot().status, "error");
    }
}
