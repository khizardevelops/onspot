# ADR-006 — History search: JS `RegExp` vs Rust `regex`

Status: accepted (P2, 2026-11-12)

## Context

The history screen builds one non-global `RegExp` from the query: literal text
is escaped, regex mode is used as written, and the `i` flag is on unless the
learner asks for case sensitivity. The Rust port uses the `regex` crate. The
engines are not identical.

## Decision

- Port the matcher to `onspot-dsp::search` with the same literal escaping
  (`[.*+?^${}()|[\]\\]`), trimming, empty-query behaviour and case handling.
- Pin it with goldens captured from the extracted
  `src/lib/utils/historySearch.ts` (the page now imports that function, so the
  legacy path and the capture cannot drift). The Rust test
  `crates/onspot-app/tests/history_search.rs` replays every case.
- Map a compile failure to the bridge code `history.invalid_regex`; the screen
  keeps showing its inline "Invalid regex" message.
- Document the engine differences rather than emulating them:
  - JavaScript supports lookaround (`(?=...)`, `(?<=...)`) and backreferences
    (`\1`); Rust `regex` does not and reports them invalid.
  - JavaScript's `\b` is ASCII-word-boundary oriented; Rust's is Unicode-aware
    by default. Fixtures avoid relying on that edge.
  - JavaScript has no `(?i)` inline flag in the same places; the driver passes
    case sensitivity explicitly.
  - Both treat an unanchored expression as "contains"; neither enables
    multiline by default.

## Consequences

A learner who types a lookaround in regex mode gets the inline error on the
core path while the legacy path would have matched. No stored data changes and
the default literal mode is unaffected. If that gap matters, the follow-up is
to inspect the expression in the driver and keep the legacy engine for those
patterns; it is not needed for P2.

Golden fixtures are refreshed only when the TypeScript behaviour is
deliberately changed (ADR-003), never to make a Rust difference pass.
