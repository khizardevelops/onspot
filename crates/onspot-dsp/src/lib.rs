// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pure signal and text helpers: silence detection, WAV encoding, word caps,
//! word comparison, sentence chunking and history search.
//!
//! No I/O and no framework types. The first ports land here in P3 (silence,
//! word cap) and P4 (sentence chunks). Their behaviour is pinned by the
//! fixtures in `tests/golden/`, captured from today's TypeScript by
//! `bun run golden:capture` (decision: ADR-003).

pub mod search;
pub mod speech;
pub mod text_language;
pub mod words;
