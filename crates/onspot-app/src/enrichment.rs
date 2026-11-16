// SPDX-License-Identifier: AGPL-3.0-or-later

//! What a stored take learns on demand: its three translations, the meaning
//! of each word, and the meaning of a phrase the learner selected. Each is
//! fetched once from the learner's model and saved on the take, so later
//! views are instant and work offline.

use onspot_domain::{Attempt, PhraseGloss, TextGlosses, TranslationSet};
use onspot_ports::{CancelToken, CoreError, LlmProvider, RecordsStore};

use crate::practice::PracticeConfig;
use crate::usage_ledger::hash_text;

/// The prefix of a word-gloss map key: `numbered:<hash>` (English) or
/// `numbered:<language>:<hash>`. Meanings saved before words were asked for
/// by number sit under older keys and are fetched again.
pub const GLOSS_KEY_PREFIX: &str = "numbered:";

/// The language of instruction whose gloss keys carry no language part.
const UNMARKED_INSTRUCTION_LANGUAGE: &str = "en";

/// Where a text's meanings are kept on its take: per language of instruction,
/// so a change of language fetches new ones.
pub fn gloss_key(text: &str, instruction_language: &str) -> String {
    let text_key = if instruction_language == UNMARKED_INSTRUCTION_LANGUAGE {
        hash_text(text)
    } else {
        format!("{instruction_language}:{}", hash_text(text))
    };
    format!("{GLOSS_KEY_PREFIX}{text_key}")
}

/// A selected phrase on one of a take's texts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhraseSelection<'a> {
    /// The transcript or the correct version the phrase is in.
    pub text: &'a str,
    /// First and last word of the selection.
    pub start: i64,
    pub end: i64,
    pub phrase: &'a str,
}

/// The on-demand meanings of one stored take.
pub struct EnrichTake<'a> {
    records: &'a dyn RecordsStore,
    llm: &'a dyn LlmProvider,
    config: &'a PracticeConfig,
}

impl<'a> EnrichTake<'a> {
    /// Creates the use case over the repositories, the learner's model and
    /// the open session's languages.
    pub fn new(
        records: &'a dyn RecordsStore,
        llm: &'a dyn LlmProvider,
        config: &'a PracticeConfig,
    ) -> Self {
        Self {
            records,
            llm,
            config,
        }
    }

    /// Translates the take's correct version (the transcript itself when
    /// there was nothing to fix) into the three study views, and saves them.
    ///
    /// @param now The change time (RFC 3339).
    pub async fn translations(
        &self,
        attempt_id: &str,
        now: &str,
    ) -> Result<TranslationSet, CoreError> {
        const FAILED: &str = "translations.persistence_failed";

        let mut attempt = self.stored_attempt(attempt_id, FAILED).await?;
        let text = attempt
            .corrected_text
            .clone()
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| attempt.transcript.clone());

        let mut translations = self
            .llm
            .translate(
                &text,
                &self.config.llm_endpoint,
                &self.config.target_language_name,
                &self.config.instruction_language_name,
                &CancelToken::new(),
            )
            .await?;
        translations.instruction_language = Some(self.config.instruction_language_id.clone());

        attempt.translation = Some(translations.idiomatic.clone());
        attempt.translations = Some(translations.clone());
        attempt.updated_at = now.to_owned();
        self.save(&attempt, FAILED).await?;
        Ok(translations)
    }

    /// The meaning of every word of one of the take's texts, fetched once.
    ///
    /// @returns The key the meanings are stored under, and the meanings.
    pub async fn glosses(
        &self,
        attempt_id: &str,
        text: &str,
        with_pos: bool,
        now: &str,
    ) -> Result<(String, TextGlosses), CoreError> {
        const FAILED: &str = "glosses.persistence_failed";

        let mut attempt = self.stored_attempt(attempt_id, FAILED).await?;
        let key = gloss_key(text, &self.config.instruction_language_id);
        let mut glosses_by_text = attempt.word_glosses.clone().unwrap_or_default();
        if let Some(existing) = glosses_by_text.get(&key) {
            let has_meanings = existing.sections.is_some() || !existing.words.is_empty();
            if has_meanings {
                return Ok((key, existing.clone()));
            }
        }

        let mut glosses = self
            .llm
            .gloss(
                text,
                &self.config.llm_endpoint,
                &self.config.target_language_name,
                &self.config.instruction_language_name,
                with_pos,
                &CancelToken::new(),
            )
            .await?;
        // Selections translated before the word meanings were asked for stay.
        if let Some(earlier) = glosses_by_text.get(&key) {
            glosses.phrases.extend(
                earlier
                    .phrases
                    .iter()
                    .filter(|phrase| phrase.origin == SELECTION_ORIGIN)
                    .cloned(),
            );
        }

        glosses_by_text.insert(key.clone(), glosses.clone());
        attempt.word_glosses = Some(glosses_by_text);
        attempt.updated_at = now.to_owned();
        self.save(&attempt, FAILED).await?;
        Ok((key, glosses))
    }

    /// The meaning of a phrase the learner selected, in the context of its
    /// text; a selection translated before is read back.
    pub async fn phrase(
        &self,
        attempt_id: &str,
        selection: &PhraseSelection<'_>,
        now: &str,
    ) -> Result<String, CoreError> {
        const FAILED: &str = "phrases.persistence_failed";

        let mut attempt = self.stored_attempt(attempt_id, FAILED).await?;
        let key = gloss_key(selection.text, &self.config.instruction_language_id);
        let mut glosses_by_text = attempt.word_glosses.clone().unwrap_or_default();
        let saved = glosses_by_text.get(&key).and_then(|glosses| {
            glosses.phrases.iter().find(|phrase| {
                phrase.origin == SELECTION_ORIGIN
                    && phrase.start == selection.start
                    && phrase.end == selection.end
            })
        });
        if let Some(saved) = saved {
            return Ok(saved.meaning.clone());
        }

        let meaning = self
            .llm
            .phrase(
                selection.phrase,
                selection.text,
                &self.config.llm_endpoint,
                &self.config.target_language_name,
                &self.config.instruction_language_name,
                &CancelToken::new(),
            )
            .await?;

        let glosses = glosses_by_text.entry(key).or_insert_with(empty_glosses);
        glosses.phrases.push(PhraseGloss {
            start: selection.start,
            end: selection.end,
            meaning: meaning.clone(),
            origin: String::from(SELECTION_ORIGIN),
        });
        attempt.word_glosses = Some(glosses_by_text);
        attempt.updated_at = now.to_owned();
        self.save(&attempt, FAILED).await?;
        Ok(meaning)
    }

    async fn stored_attempt(&self, attempt_id: &str, failed: &str) -> Result<Attempt, CoreError> {
        self.records
            .get_attempt(attempt_id)
            .await
            .map_err(|error| CoreError::new(failed, error.message))?
            .ok_or_else(|| {
                CoreError::new("practice.attempt_not_found", "the attempt is not stored")
            })
    }

    async fn save(&self, attempt: &Attempt, failed: &str) -> Result<(), CoreError> {
        self.records
            .put_attempt(attempt)
            .await
            .map_err(|error| CoreError::new(failed, error.message))
    }
}

/// Phrase meanings the learner asked for by selecting text, as opposed to
/// the expressions the word-meaning request finds.
const SELECTION_ORIGIN: &str = "selection";

fn empty_glosses() -> TextGlosses {
    TextGlosses {
        words: Vec::new(),
        phrases: Vec::new(),
        pos: None,
        pos_sections: None,
        sections: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gloss_cache_keys_match_the_legacy_hash() {
        assert_eq!(hash_text("Bonjour je vais"), "ed9c0c8e-f");
        assert_eq!(hash_text("Bonjour je vais é"), "d966b3b9-h");
        assert_eq!(gloss_key("Bonjour je vais", "en"), "numbered:ed9c0c8e-f");
        assert_eq!(gloss_key("Bonjour je vais", "es"), "numbered:es:ed9c0c8e-f");
    }
}
