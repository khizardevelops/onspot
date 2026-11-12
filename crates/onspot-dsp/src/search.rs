// SPDX-License-Identifier: AGPL-3.0-or-later

//! The history search matcher, ported from the legacy page's derived
//! `matcher`.
//!
//! Literal mode escapes the JavaScript metacharacters and matches anywhere;
//! regex mode uses the expression as written. Both are case-insensitive unless
//! asked otherwise. The Rust `regex` engine has no lookaround or
//! backreferences, so those expressions are reported invalid here although
//! JavaScript accepts them; ADR-006 records the difference and the fixtures
//! cover both engines' common ground.

use regex::{Regex, RegexBuilder};

/// The characters JavaScript's `RegExp` treats specially, escaped the same way
/// as the legacy `raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
const META: &[char] = &[
    '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\',
];

/// A compiled search pattern.
#[derive(Debug, Clone)]
pub struct Matcher {
    regex: Regex,
}

impl Matcher {
    /// Whether the text contains a match.
    pub fn is_match(&self, text: &str) -> bool {
        self.regex.is_match(text)
    }
}

/// A search pattern that could not be compiled.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct SearchError {
    pub message: String,
}

/// Escapes literal search text exactly like the page's literal mode.
pub fn escape_literal(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len());
    for character in query.chars() {
        if META.contains(&character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// Compiles a query. An empty (or whitespace-only) query has no matcher.
pub fn compile(
    query: &str,
    regex_mode: bool,
    case_sensitive: bool,
) -> Result<Option<Matcher>, SearchError> {
    let raw = query.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let source = if regex_mode {
        raw.to_owned()
    } else {
        escape_literal(raw)
    };
    let regex = RegexBuilder::new(&source)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|error| SearchError {
            message: error.to_string(),
        })?;
    Ok(Some(Matcher { regex }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matcher(query: &str, regex: bool, case_sensitive: bool) -> Matcher {
        compile(query, regex, case_sensitive)
            .expect("pattern compiles")
            .expect("pattern is not empty")
    }

    #[test]
    fn literal_text_escapes_metacharacters() {
        let matcher = matcher("what?", false, false);
        assert!(matcher.is_match("what?"));
        assert!(!matcher.is_match("what"));
    }

    #[test]
    fn empty_query_has_no_matcher() {
        assert!(compile("   ", false, false).expect("valid").is_none());
    }

    #[test]
    fn a_broken_regex_is_an_error() {
        assert!(compile("[", true, false).is_err());
    }

    #[test]
    fn case_sensitivity_follows_the_flag() {
        assert!(matcher("bonjour", false, false).is_match("Bonjour"));
        assert!(!matcher("bonjour", false, true).is_match("Bonjour"));
    }
}
