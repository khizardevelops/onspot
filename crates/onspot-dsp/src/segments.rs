// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sentence and clause boundaries, and a long text cut into even parts of
//! whole sentences. Ported from `src/lib/utils/segments.ts` and
//! `src/lib/utils/textChunks.ts`; pinned by `tests/golden/sentenceChunks.json`.
//!
//! Rules are intentionally simple and language-agnostic: a sentence ends after
//! one of the sentence marks (and repetitions, e.g. `!?`), keeping the
//! punctuation; a clause ends after one of the clause marks inside a sentence.
//!
//! Words are runs of letters and numbers, as in [`crate::words`]. An unspaced
//! script (Japanese, Chinese) therefore counts a run as one word, where the
//! driver's `Intl.Segmenter` would count each word: such a text is cut at its
//! sentences only, which keeps the same parts for any take onspot records.

use once_cell::sync::Lazy;
use regex::Regex;

/// Punctuation that ends a sentence, in every script onspot shows (see
/// `SENTENCE_END_MARKS` in the driver), as a regex character class body.
const SENTENCE_END_MARKS: &str = ".!?…。！？؟۔।॥\u{037e}";

/// Punctuation that ends a clause: commas, semicolons, colons and dashes, with
/// the Japanese `、` and the Arabic-script comma and semicolon.
const CLAUSE_END_MARKS: &str = ",;:—–、،؛";

static SENTENCE: Lazy<Regex> = Lazy::new(|| {
    let marks = SENTENCE_END_MARKS;
    Regex::new(&format!("[^{marks}]+[{marks}]+|[^{marks}]+$")).expect("sentence regex")
});

static CLAUSE_END: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[{CLAUSE_END_MARKS}]+")).expect("clause regex"));

static WORD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{L}\p{N}]+(?:['’\-\u{200c}][\p{L}\p{N}]+)*").expect("word regex"));

/// A part of a text by byte offsets, `end` exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextSpan {
    pub start: usize,
    pub end: usize,
}

impl TextSpan {
    /// The spanned text.
    pub fn of<'a>(&self, text: &'a str) -> &'a str {
        &text[self.start..self.end]
    }
}

/// Where each sentence of a text starts and ends, without the spaces around it.
///
/// @returns The sentences' spans, in order; empty for a blank text.
pub fn sentence_spans(text: &str) -> Vec<TextSpan> {
    SENTENCE
        .find_iter(text)
        .filter_map(|found| trimmed_span(text, found.start(), found.end()))
        .collect()
}

/// Where each clause of one sentence starts and ends, the clause's own
/// punctuation (a comma, a colon) kept with it.
///
/// @param sentence One of the text's sentences (see [`sentence_spans`]).
/// @returns The clauses' spans in `text` offsets; the sentence itself when it has one clause.
pub fn clause_spans(text: &str, sentence: TextSpan) -> Vec<TextSpan> {
    let sentence_text = sentence.of(text);
    let mut spans = Vec::new();
    let mut clause_start = 0;

    for clause_end in CLAUSE_END.find_iter(sentence_text) {
        let span = trimmed_span(
            text,
            sentence.start + clause_start,
            sentence.start + clause_end.end(),
        );
        spans.extend(span);
        clause_start = clause_end.end();
    }

    let last_clause = trimmed_span(text, sentence.start + clause_start, sentence.end);
    spans.extend(last_clause);
    spans
}

/// The text cut into consecutive parts of whole sentences, each at most about
/// `max_words` words, as even in size as the sentences allow.
///
/// Work that is sent in pieces needs this: one LLM request has to fit a
/// provider's per-minute limit, and its reply its token budget. A sentence
/// longer than a part (speech recognised without full stops) is cut at its
/// clauses, and a clause still too long into runs of words.
///
/// @returns The parts' spans in `text`, in order; one span for a text that already fits.
pub fn sentence_chunks(text: &str, max_words: usize) -> Vec<TextSpan> {
    let words = word_spans(text);
    let part_count = words.len().div_ceil(max_words.max(1));
    if part_count <= 1 {
        let whole = sentence_spans(text);
        return match (whole.first(), whole.last()) {
            (Some(first), Some(last)) => vec![TextSpan {
                start: first.start,
                end: last.end,
            }],
            _ => Vec::new(),
        };
    }

    // Even parts: 700 words in parts of 250 become three of ~233, not 250 + 250 + 200.
    let target_words = words.len().div_ceil(part_count);
    let mut chunks = Vec::new();
    let mut open: Option<(TextSpan, usize)> = None;

    for piece in pieces(text, &words, max_words) {
        let piece_words = words_in(&words, piece).len();
        if let Some((span, count)) = open.as_mut() {
            if *count + piece_words <= target_words {
                span.end = piece.end;
                *count += piece_words;
                continue;
            }
            chunks.push(*span);
        }
        open = Some((piece, piece_words));
    }

    chunks.extend(open.map(|(span, _)| span));
    chunks
}

/// The word tokens of a text, in order.
fn word_spans(text: &str) -> Vec<TextSpan> {
    WORD.find_iter(text)
        .map(|word| TextSpan {
            start: word.start(),
            end: word.end(),
        })
        .collect()
}

/// The word tokens inside a span of the text.
fn words_in(words: &[TextSpan], span: TextSpan) -> Vec<TextSpan> {
    words
        .iter()
        .copied()
        .filter(|word| word.start >= span.start && word.end <= span.end)
        .collect()
}

/// Runs of at most `max_words` words covering a span too long to keep whole.
fn word_runs(words: &[TextSpan], span: TextSpan, max_words: usize) -> Vec<TextSpan> {
    let inside = words_in(words, span);
    inside
        .chunks(max_words.max(1))
        .enumerate()
        .map(|(index, run)| {
            let is_first_run = index == 0;
            let is_last_run = run.last() == inside.last();
            TextSpan {
                start: if is_first_run {
                    span.start
                } else {
                    run[0].start
                },
                end: if is_last_run {
                    span.end
                } else {
                    run[run.len() - 1].end
                },
            }
        })
        .collect()
}

/// The text's sentences, with any sentence longer than `max_words` cut into
/// clauses, then runs of words.
fn pieces(text: &str, words: &[TextSpan], max_words: usize) -> Vec<TextSpan> {
    sentence_spans(text)
        .into_iter()
        .flat_map(|sentence| {
            if words_in(words, sentence).len() <= max_words {
                return vec![sentence];
            }
            clause_spans(text, sentence)
                .into_iter()
                .flat_map(|clause| {
                    if words_in(words, clause).len() <= max_words {
                        vec![clause]
                    } else {
                        word_runs(words, clause, max_words)
                    }
                })
                .collect()
        })
        .collect()
}

/// `start..end` of `text` without leading and trailing spaces, or `None` when
/// only spaces are left.
fn trimmed_span(text: &str, start: usize, end: usize) -> Option<TextSpan> {
    let inner = &text[start..end];
    let leading = inner.len() - inner.trim_start().len();
    let trailing = inner.len() - inner.trim_end().len();
    let span = TextSpan {
        start: start + leading,
        end: end - trailing,
    };
    (span.end > span.start).then_some(span)
}
