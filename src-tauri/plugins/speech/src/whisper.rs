//! whisper.cpp speech-to-text (through whisper-rs).
//!
//! One model is loaded at a time and kept until it has been idle for
//! `IDLE_RELEASE`, so consecutive takes skip the load, but memory is given back
//! when the user stops practising.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::Result;

pub const IDLE_RELEASE: Duration = Duration::from_secs(90);

struct Loaded {
    path: String,
    context: WhisperContext,
}

#[derive(Default)]
pub struct Engine {
    loaded: Mutex<Option<Loaded>>,
    /// Bumped on every use; an idle release only fires if nothing used the
    /// engine since it was scheduled.
    uses: AtomicU64,
}

impl Engine {
    /// Loads `model` unless it is already the loaded one.
    pub fn load(&self, model: &Path) -> Result<()> {
        let mut loaded = self.loaded.lock().unwrap();
        let key = model.to_string_lossy().into_owned();
        if loaded.as_ref().is_some_and(|current| current.path == key) {
            return Ok(());
        }
        // Drop the old model before loading the new one, so two never coexist.
        *loaded = None;
        let context = WhisperContext::new_with_params(&key, WhisperContextParameters::default())?;
        *loaded = Some(Loaded { path: key, context });
        Ok(())
    }

    /// 16 kHz mono PCM in, text out. `language` is Whisper's code, e.g. `fr`.
    pub fn transcribe(&self, model: &Path, pcm: &[f32], language: &str) -> Result<String> {
        self.load(model)?;
        let loaded = self.loaded.lock().unwrap();
        let context = &loaded.as_ref().expect("loaded above").context;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some(language));
        params.set_n_threads(inference_threads());
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);

        let mut state = context.create_state()?;
        state.full(params, pcm)?;
        let text: Vec<String> = state
            .as_iter()
            .map(|segment| segment.to_str_lossy().map(|text| text.trim().to_owned()))
            .collect::<std::result::Result<_, _>>()?;
        Ok(text.join(" "))
    }

    pub fn release(&self) {
        *self.loaded.lock().unwrap() = None;
    }

    /// Records a use and returns its number, for `release_if_unused_since`.
    pub fn touch(&self) -> u64 {
        self.uses.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn release_if_unused_since(&self, use_number: u64) {
        if self.uses.load(Ordering::Relaxed) == use_number {
            self.release();
        }
    }
}

/// All cores but one (the UI and audio keep one), capped at 8: whisper.cpp
/// stops getting faster beyond that, and phones mix fast and slow cores.
fn inference_threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(2, |n| n.get());
    cores.saturating_sub(1).clamp(1, 8) as i32
}
