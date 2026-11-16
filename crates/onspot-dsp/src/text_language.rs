// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whether text could be written in a language, judged from its letters alone.
//!
//! Ported from `src/lib/languages/textLanguage.ts`. The caller supplies the
//! language's Unicode scripts from the checked-in registry; this module owns
//! the script-share rule and the letters that prove another language.

use once_cell::sync::Lazy;
use regex::Regex;

/// At least this share of a text's letters must be in the language's script.
const MIN_SHARE_IN_SCRIPT: f64 = 0.5;

/// A Japanese text this long with no kana at all is Chinese.
const MIN_HAN_FOR_KANA_CHECK: usize = 4;

static LETTER: Lazy<Regex> = Lazy::new(|| Regex::new(r"\p{L}").expect("letter regex"));
static HAN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\p{Script=Han}").expect("Han regex"));
static KANA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\p{Script=Hiragana}|\p{Script=Katakana}").expect("kana regex"));
static URDU_ONLY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\u{0679}\u{0688}\u{0691}\u{06ba}\u{06c1}\u{06d2}\u{06d3}]").expect("Urdu letters")
});
static UKRAINIAN_ONLY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\u{0456}\u{0457}\u{0454}\u{0491}\u{0406}\u{0407}\u{0404}\u{0490}]")
        .expect("Ukrainian letters")
});
static RUSSIAN_ONLY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\u{044b}\u{044d}\u{0451}\u{044a}\u{042b}\u{042d}\u{0401}\u{042a}]")
        .expect("Russian letters")
});

fn other_language_letters(language_id: &str) -> Option<&'static Regex> {
    match language_id {
        "fa" | "ar" => Some(&URDU_ONLY),
        "zh" => Some(&KANA),
        "ru" | "bg" => Some(&UKRAINIAN_ONLY),
        "uk" => Some(&RUSSIAN_ONLY),
        _ => None,
    }
}

/// Whether a text could be in a language: most of its letters are in the
/// language's script, and none is a letter only another language uses.
///
/// Unknown languages and texts without letters answer `true`; same-script
/// languages (Spanish and Portuguese) cannot be told apart this way.
pub fn could_be_written_in(text: &str, language_id: &str, scripts: &[String]) -> bool {
    if scripts.is_empty() {
        return true;
    }
    let letters: Vec<&str> = LETTER.find_iter(text).map(|m| m.as_str()).collect();
    if letters.is_empty() {
        return true;
    }

    let pattern = scripts
        .iter()
        .map(|script| format!(r"\p{{Script={script}}}"))
        .collect::<Vec<_>>()
        .join("|");
    let Ok(in_script) = Regex::new(&pattern) else {
        return true;
    };
    let in_script_count = letters
        .iter()
        .filter(|letter| in_script.is_match(letter))
        .count();
    if (in_script_count as f64) / (letters.len() as f64) < MIN_SHARE_IN_SCRIPT {
        return false;
    }

    if other_language_letters(language_id).is_some_and(|letters| letters.is_match(text)) {
        return false;
    }

    if language_id == "ja" {
        let han = HAN.find_iter(text).count();
        if han >= MIN_HAN_FOR_KANA_CHECK && !KANA.is_match(text) {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scripts(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn unknown_languages_and_empty_scripts_are_permissive() {
        assert!(could_be_written_in("bonjour", "xx", &[]));
        assert!(could_be_written_in("123 !", "fr", &scripts(&["Latin"])));
    }

    #[test]
    fn the_wrong_script_is_rejected() {
        assert!(could_be_written_in("bonjour", "fr", &scripts(&["Latin"])));
        assert!(!could_be_written_in("привет", "fr", &scripts(&["Latin"])));
        assert!(could_be_written_in(
            "Bonjour, 東京",
            "fr",
            &scripts(&["Latin"])
        ));
    }

    #[test]
    fn language_specific_letters_are_rejected() {
        assert!(!could_be_written_in("ٹھیک ہے", "fa", &scripts(&["Arabic"])));
        assert!(!could_be_written_in(
            "Привіт",
            "ru",
            &scripts(&["Cyrillic"])
        ));
        assert!(!could_be_written_in(
            "Это ёж",
            "uk",
            &scripts(&["Cyrillic"])
        ));
    }

    #[test]
    fn japanese_without_kana_reads_as_chinese() {
        assert!(!could_be_written_in(
            "你好世界",
            "ja",
            &scripts(&["Han", "Hiragana", "Katakana"])
        ));
        assert!(could_be_written_in(
            "こんにちは世界",
            "ja",
            &scripts(&["Han", "Hiragana", "Katakana"])
        ));
        assert!(could_be_written_in(
            "你好",
            "ja",
            &scripts(&["Han", "Hiragana", "Katakana"])
        ));
    }
}
