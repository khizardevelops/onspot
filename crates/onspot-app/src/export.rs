// SPDX-License-Identifier: AGPL-3.0-or-later

//! One session as Markdown, ported from `src/lib/utils/sessionTranscript.ts`.

use std::collections::HashMap;

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use once_cell::sync::Lazy;
use onspot_domain::{Attempt, Correction, Session, TranslationSet};
use regex::Regex;
use unicode_normalization::UnicodeNormalization;

static TAG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"</?(?:wrong|right|key|ask)>").expect("explanation tag regex"));
static SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("space regex"));
static ALNUM: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{L}\p{N}]").expect("letter or number regex"));

/// The explanation as text-to-speech reads it: tags gone, whitespace collapsed.
pub fn speakable_explanation(markup: &str) -> String {
    let without_tags = TAG.replace_all(markup, "");
    SPACE.replace_all(&without_tags, " ").trim().to_owned()
}

/// A stored ISO time in the app's British-English long format.
fn format_date(iso: &str) -> String {
    let parsed = DateTime::parse_from_rfc3339(iso)
        .map(|date| date.with_timezone(&Local))
        .or_else(|_| {
            NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S%.f").map(|date| {
                Local
                    .from_local_datetime(&date)
                    .earliest()
                    .unwrap_or_else(|| Local.from_utc_datetime(&date))
            })
        });
    match parsed {
        Ok(date) => date.format("%-d %B %Y at %H:%M").to_string(),
        Err(_) => iso.to_owned(),
    }
}

/// `m:ss` from whole seconds, so 59.6 s reads 1:00 rather than 0:60.
fn format_duration(seconds: f64) -> String {
    let total = seconds.round() as i64;
    format!("{}:{:02}", total / 60, total.rem_euclid(60))
}

/// A quote whose line breaks stay readable Markdown.
fn quote(text: &str) -> String {
    text.trim()
        .split('\n')
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn capitalized(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn correction_line(correction: &Correction) -> String {
    let category = capitalized(&correction.category);
    let target = if correction.replacement.is_empty() {
        format!("Remove \"{}\"", correction.original)
    } else {
        format!(
            "\"{}\" → \"{}\"",
            correction.original, correction.replacement
        )
    };
    let meaning = correction
        .replacement_translation
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| format!(" ({value})"))
        .unwrap_or_default();
    let detail = if correction.explanation.is_empty() {
        String::new()
    } else {
        format!("\n  - {}", correction.explanation)
    };
    format!(
        "- **{category} · {}** — {target}{meaning}{detail}",
        correction.severity
    )
}

fn translation_section(translations: Option<&TranslationSet>) -> Vec<String> {
    let Some(translations) = translations else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    if !translations.idiomatic.is_empty() {
        lines.push(format!("- **Idiomatic:** {}", translations.idiomatic));
    }
    if !translations.literal.is_empty() {
        lines.push(format!("- **Literal:** {}", translations.literal));
    }
    if !translations.word_for_word.is_empty() {
        lines.push(format!(
            "- **Word-for-word:** {}",
            translations.word_for_word
        ));
    }
    for alternative in &translations.idiomatic_variants {
        lines.push(format!("- **Also:** {alternative}"));
    }
    let words: Vec<String> = translations
        .word_breakdown
        .iter()
        .filter(|item| ALNUM.is_match(&item.source))
        .map(|item| format!("{} — {}", item.source, item.target))
        .collect();
    if !words.is_empty() {
        lines.push(format!("- **Each word:** {}", words.join("; ")));
    }
    if lines.is_empty() {
        return Vec::new();
    }

    let mut section = vec![String::from("**Translation**"), String::new()];
    section.extend(lines);
    section.push(String::new());
    section
}

fn attempt_section(attempt: &Attempt, index: usize, corrections: &[Correction]) -> String {
    let mut lines = vec![
        format!("## Take {index}"),
        String::new(),
        format!(
            "{} · {} words · {}",
            format_duration(attempt.duration_sec),
            attempt.word_count,
            format_date(&attempt.created_at)
        ),
        String::new(),
    ];

    if !attempt.prompt_text.is_empty() {
        lines.push(format!("**Prompt:** {}", attempt.prompt_text));
        lines.push(String::new());
    }

    lines.push(String::from("**You said**"));
    lines.push(String::new());
    lines.push(quote(&attempt.transcript));
    lines.push(String::new());

    let corrected = attempt.corrected_text.as_deref().unwrap_or_default().trim();
    if !corrected.is_empty() && corrected != attempt.transcript.trim() {
        lines.push(String::from("**Did you mean to say?**"));
        lines.push(String::new());
        lines.push(quote(corrected));
        lines.push(String::new());
    }

    let explanation = speakable_explanation(attempt.explanation.as_deref().unwrap_or_default());
    if !explanation.is_empty() {
        lines.push(String::from("**Explanation**"));
        lines.push(String::new());
        lines.push(explanation);
        lines.push(String::new());
    }

    if let Some(follow_up) = &attempt.follow_up {
        if !follow_up.question.is_empty() {
            lines.push(format!("**Follow-up:** {}", follow_up.question));
            if !follow_up.translation.is_empty() {
                lines.push(format!("*{}*", follow_up.translation));
            }
            lines.push(String::new());
        }
    }

    lines.extend(translation_section(attempt.translations.as_ref()));

    if !corrections.is_empty() {
        lines.push(String::from("**Corrections**"));
        lines.push(String::new());
        lines.extend(corrections.iter().map(correction_line));
        lines.push(String::new());
    }

    lines.join("\n")
}

/// Builds the Markdown document for one session without touching the database.
///
/// `exported_at` is an ISO timestamp supplied by the driver so the document is
/// deterministic in tests and shows the learner's current clock in the app.
pub fn build_session_markdown(
    session: &Session,
    attempts: &[Attempt],
    corrections_by_attempt: &HashMap<String, Vec<Correction>>,
    exported_at: &str,
) -> String {
    let spoken: f64 = attempts.iter().map(|attempt| attempt.duration_sec).sum();
    let mode = if session.mode == "exam" {
        "Exam"
    } else {
        "Casual"
    };
    let mut lines = vec![
        format!("# {}", session.title),
        String::new(),
        format!("- **Date:** {}", format_date(&session.created_at)),
        format!("- **Mode:** {mode}"),
        format!(
            "- **Takes:** {} · {} spoken",
            attempts.len(),
            format_duration(spoken)
        ),
        String::new(),
        format!("_Exported from onspot on {}._", format_date(exported_at)),
        String::new(),
    ];

    if attempts.is_empty() {
        lines.push(String::from("_This session has no takes yet._"));
        lines.push(String::new());
        return lines.join("\n");
    }

    for (index, attempt) in attempts.iter().enumerate() {
        let corrections = corrections_by_attempt
            .get(&attempt.id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        lines.push(attempt_section(attempt, index + 1, corrections));
    }

    let document = lines.join("\n");
    format!("{}\n", document.trim_end())
}

/// A short, filesystem-friendly name from the session title.
pub fn session_file_stem(title: &str) -> String {
    let normalized: String = title.nfkd().collect();
    let without_marks: String = normalized
        .chars()
        .filter(|character| !matches!(*character, '\u{0300}'..='\u{036f}'))
        .collect();
    let slug: String = without_marks
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').chars().take(60).collect::<String>();
    if slug.is_empty() {
        String::from("session")
    } else {
        slug
    }
}

/// The UTC export stamp the bridge passes for the footer.
pub fn export_timestamp() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
