// SPDX-License-Identifier: AGPL-3.0-or-later

//! Word comparison shared by the evaluation parser and explanation composer.
//!
//! The TypeScript version segments Japanese with `Intl.Segmenter`; the core
//! only needs the comparison rules, so it keeps letter/number runs and treats
//! an unspaced script as one run. Punctuation, case and apostrophe style never
//! count as a difference.

use once_cell::sync::Lazy;
use regex::Regex;

static WORD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{L}\p{N}]+(?:['’\-\u{200c}][\p{L}\p{N}]+)*").expect("word regex"));

static SENTENCE_END: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"[.!?…。！？؟۔।॥\u{037e}]["»”'」』)]?$"#).expect("sentence-end regex")
});

fn comparable_words(text: &str) -> Vec<String> {
    WORD.find_iter(text)
        .map(|word| word.as_str().to_lowercase().replace('’', "'"))
        .collect()
}

/// Whether two texts say the same words, ignoring case, punctuation and
/// apostrophe style.
pub fn same_words(first: &str, second: &str) -> bool {
    comparable_words(first) == comparable_words(second)
}

/// Whether the shorter text's word run appears in order inside the other.
/// Two empty texts do not overlap.
pub fn overlapping_words(first: &str, second: &str) -> bool {
    let first = comparable_words(first);
    let second = comparable_words(second);
    let (shorter, longer) = if first.len() <= second.len() {
        (&first, &second)
    } else {
        (&second, &first)
    };
    if shorter.is_empty() {
        return false;
    }

    longer
        .windows(shorter.len())
        .any(|window| window == shorter.as_slice())
}

/// Whether a text ends with a sentence mark, allowing one closing quote.
pub fn ends_sentence(text: &str) -> bool {
    SENTENCE_END.is_match(text.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn punctuation_and_case_are_ignored() {
        assert!(same_words("Je vais bien merci", "je vais bien, merci."));
        assert!(same_words("j'ai préféré", "J’ai préféré."));
        assert!(!same_words("je vais bien", "je vais très bien"));
    }

    #[test]
    fn overlap_finds_a_word_run() {
        assert!(overlapping_words("en tarp", "détruit en tarp"));
        assert!(!overlapping_words("", ""));
    }

    #[test]
    fn sentence_marks_work_in_every_script() {
        assert!(ends_sentence("Bonjour."));
        assert!(ends_sentence("你好。"));
        assert!(ends_sentence("بتایا۔"));
        assert!(!ends_sentence("Bonjour"));
    }
}
