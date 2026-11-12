// SPDX-License-Identifier: AGPL-3.0-or-later

//! The OpenAI-compatible chat adapter: request building, streaming-free
//! completion, JSON repair, pacing and provider quirks.
//!
//! Ported from `src/lib/adapters/llm/` in P4. The rendered prompt templates
//! must stay byte-identical (invariant I5); the JSON repair behaviour is
//! pinned by `tests/golden/jsonRepair.json`.

pub mod client;
pub mod explanation;
pub mod gloss;
pub mod json_repair;
pub mod language_guidance;
pub mod pacing;
pub mod parse;
pub mod prompt;
pub mod translation;
pub mod translation_prompt;

#[cfg(test)]
mod tests {
    #[test]
    fn crate_is_registered() {
        assert_eq!(env!("CARGO_PKG_NAME"), "onspot-adapter-llm-openai");
    }
}
