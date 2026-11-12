// SPDX-License-Identifier: AGPL-3.0-or-later

//! Speech-take checks ported from the legacy practice store.
//!
//! `is_silent` rejects a take with no audible signal before transcription: the
//! loudest 100 ms window must rise above about -46 dBFS RMS. `cap_words` holds
//! a runaway transcript under the evaluation budget.

/// The liberal 60 s transcript cap: 200 words per minute plus 20% headroom.
pub const MAX_ATTEMPT_WORDS: usize = 240;

/// The RMS floor of an audible 100 ms window (about -46 dBFS).
const SILENCE_RMS: f64 = 0.005;

/// Whether every 100 ms window of the take is below the silence floor.
///
/// The window length follows the legacy `Math.round(sampleRate / 10)`. Samples
/// are widened to `f64` before squaring so the decision matches the JavaScript
/// arithmetic rather than `f32` rounding.
pub fn is_silent(pcm: &[f32], sample_rate: u32) -> bool {
    let window = ((f64::from(sample_rate) / 10.0).round()) as usize;
    if window == 0 {
        return true;
    }

    for start in (0..pcm.len()).step_by(window) {
        let end = (start + window).min(pcm.len());
        let mut sum = 0.0;
        for &sample in &pcm[start..end] {
            let sample = f64::from(sample);
            sum += sample * sample;
        }
        if (sum / end.saturating_sub(start).max(1) as f64).sqrt() > SILENCE_RMS {
            return false;
        }
    }
    true
}

/// Counts words the way the UI does: letters and digits form one word, and an
/// apostrophe or hyphen keeps its parts together (`aujourd'hui`, `peut-être`).
pub fn count_words(text: &str) -> usize {
    let word = regex::Regex::new(r"[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*")
        .expect("the word pattern is valid");
    word.find_iter(text).count()
}

/// Truncates `text` to at most `max_words` whitespace-separated tokens.
///
/// Text already within the cap is returned unchanged. A cut joins the kept
/// tokens with single spaces, as the legacy `\S+` slice and `join(' ')` do.
pub fn cap_words(text: &str, max_words: usize) -> String {
    let tokens: Vec<&str> = text.split_whitespace().collect();
    if tokens.len() <= max_words {
        return text.to_owned();
    }
    tokens[..max_words].join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_floor_uses_hundred_millisecond_windows() {
        assert!(is_silent(&vec![0.0; 160], 16_000));
    }

    #[test]
    fn one_loud_window_is_not_silent() {
        let mut pcm = vec![0.0; 320];
        pcm[100] = 0.1;
        assert!(!is_silent(&pcm, 16_000));
    }

    #[test]
    fn count_words_keeps_apostrophes_and_hyphens_together() {
        assert_eq!(count_words("J'ai vingt-deux ans."), 3);
        assert_eq!(count_words("  "), 0);
        assert_eq!(count_words("un, deux; trois!"), 3);
    }

    #[test]
    fn text_within_the_cap_is_untouched() {
        assert_eq!(cap_words("un  deux\ntrois", 4), "un  deux\ntrois");
    }

    #[test]
    fn a_cut_collapses_whitespace_between_kept_tokens() {
        assert_eq!(cap_words("un  deux\ntrois\tquatre", 2), "un deux");
    }
}
