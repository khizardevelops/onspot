// SPDX-License-Identifier: AGPL-3.0-or-later

//! The spoken explanation's validated markup, ported from
//! `src/lib/adapters/llm/explanation.ts`. The tags carry highlights in the UI
//! and tell a future voice which spans are in the target language.

use fancy_regex::Regex as FancyRegex;
use once_cell::sync::Lazy;
use onspot_dsp::words::{ends_sentence, overlapping_words, same_words};
use regex::Regex;
use serde_json::Value;

/// Tags the explanation understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Highlight {
    Wrong,
    Right,
    Key,
    Ask,
}

impl Highlight {
    fn name(self) -> &'static str {
        match self {
            Self::Wrong => "wrong",
            Self::Right => "right",
            Self::Key => "key",
            Self::Ask => "ask",
        }
    }
}

/// One run of explanation text: plain copy or one highlight.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplanationPart {
    pub text: String,
    pub highlight: Option<Highlight>,
}

static HIGHLIGHT_TAG: Lazy<FancyRegex> = Lazy::new(|| {
    FancyRegex::new(r"<(wrong|right|key|ask)>([\s\S]*?)</\1>").expect("highlight regex")
});
static STRAY_TAG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)</?[a-z]+>").expect("stray tag regex"));
static MARKDOWN_EMPHASIS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\*\*|__").expect("markdown regex"));
static WHITESPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("whitespace regex"));

fn clean_text(text: &str) -> String {
    let without_tags = STRAY_TAG.replace_all(text, "");
    MARKDOWN_EMPHASIS
        .replace_all(&without_tags, "")
        .into_owned()
}

/// Splits explanation markup into plain and highlighted parts.
pub fn parse_explanation(markup: &str) -> Vec<ExplanationPart> {
    let mut parts = Vec::new();
    let mut read_from = 0;

    for captures in HIGHLIGHT_TAG.captures_iter(markup).flatten() {
        let whole = captures.get(0).expect("whole match");
        let highlight = match &captures[1] {
            "wrong" => Highlight::Wrong,
            "right" => Highlight::Right,
            "key" => Highlight::Key,
            "ask" => Highlight::Ask,
            _ => unreachable!("regex only names known tags"),
        };
        let content = captures.get(2).expect("content").as_str();

        push_part(&mut parts, &markup[read_from..whole.start()], None);
        push_part(&mut parts, content, Some(highlight));
        read_from = whole.end();
    }

    push_part(&mut parts, &markup[read_from..], None);
    parts
}

fn push_part(parts: &mut Vec<ExplanationPart>, raw: &str, highlight: Option<Highlight>) {
    let text = clean_text(raw);
    if !text.is_empty() {
        parts.push(ExplanationPart { text, highlight });
    }
}

/// Writes parts back as canonical markup with only known, balanced tags.
pub fn format_explanation(parts: &[ExplanationPart]) -> String {
    parts
        .iter()
        .map(|part| match part.highlight {
            Some(highlight) => {
                format!("<{}>{}</{}>", highlight.name(), part.text, highlight.name())
            }
            None => part.text.clone(),
        })
        .collect()
}

/// Validates an LLM explanation at the boundary.
pub fn normalize_explanation(raw: &str) -> String {
    let collapsed = WHITESPACE.replace_all(raw, " ").trim().to_owned();
    format_explanation(&parse_explanation(&collapsed))
        .trim()
        .to_owned()
}

/// The explanation as text-to-speech reads it, without tags.
pub fn speakable_explanation(markup: &str) -> String {
    let spoken: String = parse_explanation(markup)
        .iter()
        .map(|part| part.text.as_str())
        .collect();
    WHITESPACE.replace_all(&spoken, " ").trim().to_owned()
}

/// Validates the model's follow-up, plain text only.
pub fn normalize_follow_up(raw: &Value) -> Option<(String, String)> {
    let fields = raw.as_object()?;
    let question = fields
        .get("question")
        .and_then(Value::as_str)
        .map(speakable_explanation)
        .unwrap_or_default();
    let translation = fields
        .get("translation")
        .and_then(Value::as_str)
        .map(speakable_explanation)
        .unwrap_or_default();
    (!question.is_empty()).then_some((question, translation))
}

/// Splits an explanation into its parts and a legacy `<ask>` follow-up.
pub fn separate_follow_up(markup: &str) -> (Vec<ExplanationPart>, Option<String>) {
    let parts = parse_explanation(markup);
    let asked = parts
        .iter()
        .find(|part| part.highlight == Some(Highlight::Ask))
        .map(|part| part.text.trim().to_owned())
        .filter(|text| !text.is_empty());
    let kept = parts
        .into_iter()
        .filter(|part| part.highlight != Some(Highlight::Ask))
        .collect();
    (kept, asked)
}

/// The explanation names only the most important mistakes.
pub const EXPLANATION_MAX_MISTAKES: usize = 3;

const MAX_LINE_WORDS: usize = 40;

fn as_text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn plain_text(value: &Value) -> String {
    speakable_explanation(as_text(value))
}

fn text_with_keywords(value: &Value) -> String {
    let collapsed = WHITESPACE
        .replace_all(as_text(value), " ")
        .trim()
        .to_owned();
    let parts: Vec<ExplanationPart> = parse_explanation(&collapsed)
        .into_iter()
        .map(|part| ExplanationPart {
            text: part.text,
            highlight: (part.highlight == Some(Highlight::Key)).then_some(Highlight::Key),
        })
        .collect();
    format_explanation(&parts).trim().to_owned()
}

fn as_sentence(text: &str) -> String {
    if ends_sentence(text) {
        text.to_owned()
    } else {
        format!("{text}.")
    }
}

fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn highlight_phrase(
    parts: Vec<ExplanationPart>,
    phrase: &str,
    highlight: Highlight,
) -> Vec<ExplanationPart> {
    if phrase.is_empty() || parts.iter().any(|part| part.highlight == Some(highlight)) {
        return parts;
    }

    let wanted = phrase.to_lowercase();
    for (position, part) in parts.iter().enumerate() {
        if part.highlight.is_some() {
            continue;
        }
        let lowered = part.text.to_lowercase();
        let Some(at) = lowered.find(&wanted) else {
            continue;
        };
        let end = at + phrase.len();
        if !part.text.is_char_boundary(end) {
            continue;
        }

        let before = &part.text[..at];
        let quoted = &part.text[at..end];
        let after = &part.text[end..];
        let mut replacement = Vec::new();
        if !before.is_empty() {
            replacement.push(ExplanationPart {
                text: before.to_owned(),
                highlight: None,
            });
        }
        replacement.push(ExplanationPart {
            text: quoted.to_owned(),
            highlight: Some(highlight),
        });
        if !after.is_empty() {
            replacement.push(ExplanationPart {
                text: after.to_owned(),
                highlight: None,
            });
        }

        let mut output = parts[..position].to_vec();
        output.extend(replacement);
        output.extend_from_slice(&parts[position + 1..]);
        return output;
    }

    parts
}

fn spoken_line(said: &str, say: &str, raw_line: &Value) -> String {
    let fallback = if say.is_empty() {
        format!("You can leave out <wrong>{said}</wrong>.")
    } else {
        format!("You said <wrong>{said}</wrong>; say <right>{say}</right> instead.")
    };

    let markup = normalize_explanation(as_text(raw_line));
    let line_text = speakable_explanation(&markup);
    let names_the_fix = say.is_empty() || overlapping_words(say, &line_text);
    if line_text.is_empty() || !names_the_fix || word_count(&line_text) > MAX_LINE_WORDS {
        return fallback;
    }

    let with_mistake = highlight_phrase(parse_explanation(&markup), said, Highlight::Wrong);
    let with_fix = highlight_phrase(with_mistake, say, Highlight::Right);
    as_sentence(format_explanation(&with_fix).trim())
}

/// Validates the model's mistakes, keeping at most three.
pub fn valid_mistakes(raw: &Value) -> Vec<(String, String, String)> {
    let Some(entries) = raw.as_array() else {
        return Vec::new();
    };

    let mut mistakes: Vec<(String, String, String)> = Vec::new();
    for entry in entries {
        let Some(fields) = entry.as_object() else {
            continue;
        };
        let said = fields.get("said").map(plain_text).unwrap_or_default();
        let say = fields.get("say").map(plain_text).unwrap_or_default();
        let changes_something = say.is_empty() || !same_words(&said, &say);
        let already_named = mistakes
            .iter()
            .any(|(named, _, _)| overlapping_words(named, &said));
        if said.is_empty() || !changes_something || already_named {
            continue;
        }

        let line = spoken_line(&said, &say, fields.get("line").unwrap_or(&Value::Null));
        mistakes.push((said, say, line));
    }

    mistakes.truncate(EXPLANATION_MAX_MISTAKES);
    mistakes
}

/// Writes the spoken explanation from the model's structured reply.
pub fn compose_explanation(raw: &Value) -> String {
    if let Some(text) = raw.as_str() {
        return normalize_explanation(text);
    }
    let Some(fields) = raw.as_object() else {
        return String::new();
    };

    let mut sentences = Vec::new();
    let note = fields
        .get("note")
        .map(text_with_keywords)
        .unwrap_or_default();
    if !note.is_empty() {
        sentences.push(as_sentence(&note));
    }
    if let Some(mistakes) = fields.get("mistakes") {
        sentences.extend(
            valid_mistakes(mistakes)
                .into_iter()
                .map(|(_, _, line)| line),
        );
    }
    if sentences.is_empty() {
        sentences.push(String::from("Nice, that was all correct."));
    }

    normalize_explanation(&sentences.join(" "))
}
