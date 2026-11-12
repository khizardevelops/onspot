// SPDX-License-Identifier: AGPL-3.0-or-later

//! The narrow repairs for the JSON slips models make, ported byte-for-byte
//! from `src/lib/adapters/llm/jsonRepair.ts`.

use fancy_regex::Regex;
use once_cell::sync::Lazy;

static STRAY_QUOTE_BETWEEN_CLOSERS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"([\]}])\s*"(?=\s*[\]}])"#).expect("stray quote regex"));
static TRAILING_COMMA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r",(?=\s*[\]}])").expect("trailing comma regex"));
static COLON_INSIDE_KEY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"([{,]\s*)"(\w+):""#).expect("colon-in-key regex"));
static UNCLOSED_MARK_VALUE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#":"([^\w\s"\\])(?=[}\]])"#).expect("unclosed mark regex"));

/// Returns the text unchanged when it already parses, the known slips fixed
/// when that makes it parse, or `None`.
pub fn repair_json(text: &str) -> Option<String> {
    if serde_json::from_str::<serde_json::Value>(text).is_ok() {
        return Some(String::from(text));
    }

    let repaired = STRAY_QUOTE_BETWEEN_CLOSERS.replace_all(text, "$1");
    let repaired = TRAILING_COMMA.replace_all(&repaired, "");
    let repaired = COLON_INSIDE_KEY.replace_all(&repaired, "$1\"$2\":\"");
    let repaired = UNCLOSED_MARK_VALUE.replace_all(&repaired, ":\"$1\"");
    let repaired = repaired.into_owned();

    serde_json::from_str::<serde_json::Value>(&repaired)
        .is_ok()
        .then_some(repaired)
}
