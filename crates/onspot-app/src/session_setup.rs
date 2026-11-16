// SPDX-License-Identifier: AGPL-3.0-or-later

//! What a session is practised with: the studied language, the language it is
//! taught in, the speech mode, the two on-device voices and the pace.
//!
//! Ported from `src/lib/practice/sessionSetup.ts`. A session records its setup
//! when it starts (migration 10); sessions from before that have none, and the
//! setup is worked out once from their takes and the current settings. The
//! driver still owns the settings document; this module owns validation, the
//! usable-voice fallback and the inference rules.

use onspot_domain::SessionSetup;
use serde::{Deserialize, Serialize};

use crate::language::{catalog, default_instruction_language_for, language, voices_for};
use crate::settings::{AppSettings, DEFAULT_TARGET_SPEECH_PACE, SPEECH_PACES};

/// The languages offered before sessions recorded their setup, in the order an
/// old take's letters decide between them (Latin script: French).
const LANGUAGES_BEFORE_SETUPS: [&str; 3] = ["fr", "fa", "ja"];

/// The prefix of a word-gloss map key: `numbered:<hash>` (English) or
/// `numbered:<language>:<hash>`.
const GLOSS_KEY_PREFIX: &str = "numbered:";

/// The setup the settings describe now: what a new session records.
pub fn setup_from_settings(settings: &AppSettings) -> SessionSetup {
    SessionSetup {
        target_language: settings.target_language.clone(),
        instruction_language: settings.instruction_language.clone(),
        tts_mode: settings.tts_mode.clone(),
        tts_voice: settings.tts_voice.clone(),
        explanation_voice: settings.explanation_voice.clone(),
        target_speech_pace: settings.target_speech_pace,
    }
}

/// Whether two setups are the same, field by field.
pub fn same_setup(first: &SessionSetup, second: &SessionSetup) -> bool {
    first == second
}

/// Validates a stored setup at the boundary (the database, a backup).
pub fn parse_session_setup(value: Option<&serde_json::Value>) -> Option<SessionSetup> {
    let value = value?;
    let parsed = match value {
        serde_json::Value::String(raw) => serde_json::from_str::<serde_json::Value>(raw).ok()?,
        value => value.clone(),
    };
    let fields = parsed.as_object()?;
    let text = |key: &str| {
        fields
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };

    let target_id = text("targetLanguage");
    let instruction_id = text("instructionLanguage");
    language(&target_id)?;
    if !catalog()
        .instruction_languages
        .iter()
        .any(|candidate| candidate.id == instruction_id)
        || target_id == instruction_id
    {
        return None;
    }

    let pace = fields
        .get("targetSpeechPace")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(DEFAULT_TARGET_SPEECH_PACE);
    Some(SessionSetup {
        target_language: target_id,
        instruction_language: instruction_id,
        tts_mode: if text("ttsMode") == "cloud" {
            String::from("cloud")
        } else {
            String::from("local")
        },
        tts_voice: text("ttsVoice"),
        explanation_voice: text("explanationVoice"),
        target_speech_pace: if SPEECH_PACES.contains(&pace) {
            pace
        } else {
            DEFAULT_TARGET_SPEECH_PACE
        },
    })
}

/// The voices that can read the instruction-language half of an explanation.
fn explanation_voices_for(language_id: &str) -> Vec<String> {
    voices_for(language_id)
        .iter()
        .map(|voice| voice.id.clone())
        .collect()
}

/// A setup the app can use: voices that exist for its languages and Cloud
/// read-back where no on-device voice speaks the language.
pub fn usable_setup(setup: &SessionSetup) -> SessionSetup {
    let target = language(&setup.target_language);
    let tts_voice = voices_for(&setup.target_language)
        .iter()
        .find(|voice| voice.id == setup.tts_voice)
        .map(|voice| voice.id.clone())
        .or_else(|| {
            target
                .and_then(|language| language.default_voice.clone())
                .filter(|voice| !voice.is_empty())
        })
        .unwrap_or_default();
    let explanation_voice = explanation_voices_for(&setup.instruction_language)
        .iter()
        .find(|voice| **voice == setup.explanation_voice)
        .cloned()
        .or_else(|| {
            explanation_voices_for(&setup.instruction_language)
                .first()
                .cloned()
        })
        .unwrap_or_default();
    let tts_mode = if target.is_some_and(|language| !language.local.tts) {
        String::from("cloud")
    } else {
        setup.tts_mode.clone()
    };
    SessionSetup {
        tts_mode,
        tts_voice,
        explanation_voice,
        ..setup.clone()
    }
}

/// One take, as far as the setup inference needs it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupAttempt {
    #[serde(default)]
    pub transcript: String,
    #[serde(default)]
    pub tts_voice: Option<String>,
    /// The instruction language its translations were written in.
    #[serde(default)]
    pub translation_language: Option<String>,
    /// The word-gloss map keys, oldest first; only the first is read.
    #[serde(default)]
    pub word_gloss_keys: Vec<String>,
}

/// Works out the setup of a session that never recorded one, from its takes.
/// What the takes cannot show is taken from the current settings.
pub fn infer_session_setup(attempts: &[SetupAttempt], settings: &AppSettings) -> SessionSetup {
    let newest_first: Vec<&SetupAttempt> = attempts.iter().rev().collect();
    let target_language = infer_target_language(&newest_first, &settings.target_language);
    let instruction_language = infer_instruction_language(
        &newest_first,
        &target_language,
        &settings.instruction_language,
    );

    let take_voice = newest_first.iter().find_map(|attempt| {
        let voice = attempt.tts_voice.as_deref()?;
        voices_for(&target_language)
            .iter()
            .any(|candidate| candidate.id == voice)
            .then(|| voice.to_owned())
    });
    let tts_voice = take_voice.unwrap_or_else(|| {
        if target_language == settings.target_language {
            settings.tts_voice.clone()
        } else {
            String::new()
        }
    });
    let explanation_voice = if instruction_language == settings.instruction_language {
        settings.explanation_voice.clone()
    } else {
        String::new()
    };
    usable_setup(&SessionSetup {
        target_language,
        instruction_language,
        tts_mode: settings.tts_mode.clone(),
        tts_voice,
        explanation_voice,
        target_speech_pace: settings.target_speech_pace,
    })
}

fn infer_target_language(newest_first: &[&SetupAttempt], current: &str) -> String {
    let voice_language = newest_first.iter().find_map(|attempt| {
        let voice = attempt.tts_voice.as_deref()?;
        catalog()
            .languages
            .iter()
            .find(|language| {
                voices_for(&language.id)
                    .iter()
                    .any(|candidate| candidate.id == voice)
            })
            .map(|language| language.id.clone())
    });
    if let Some(language) = voice_language {
        return language;
    }

    let transcripts = newest_first
        .iter()
        .map(|attempt| attempt.transcript.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let candidates: Vec<String> = catalog()
        .languages
        .iter()
        .filter(|language| {
            onspot_dsp::text_language::could_be_written_in(
                &transcripts,
                &language.id,
                &language.scripts,
            )
        })
        .map(|language| language.id.clone())
        .collect();
    if candidates.iter().any(|id| id == current) || candidates.is_empty() {
        return current.to_owned();
    }
    LANGUAGES_BEFORE_SETUPS
        .iter()
        .find(|id| candidates.iter().any(|candidate| candidate == *id))
        .map_or_else(|| candidates[0].clone(), |id| (*id).to_owned())
        .to_owned()
}

fn infer_instruction_language(
    newest_first: &[&SetupAttempt],
    target_language: &str,
    current: &str,
) -> String {
    for attempt in newest_first {
        if let Some(language) = attempt
            .translation_language
            .as_deref()
            .filter(|language| !language.is_empty())
        {
            return language.to_owned();
        }
        if let Some(key) = attempt.word_gloss_keys.first() {
            if let Some(language) = gloss_key_language(key) {
                return language;
            }
            return String::from("en");
        }
    }
    if current == target_language {
        default_instruction_language_for(target_language)
    } else {
        current.to_owned()
    }
}

/// The language in `numbered:<language>:<hash>`, or `None` for plain English.
fn gloss_key_language(key: &str) -> Option<String> {
    let rest = key.strip_prefix(GLOSS_KEY_PREFIX)?;
    let (language, _hash) = rest.split_once(':')?;
    (2..=3)
        .contains(&language.len())
        .then(|| language.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_english_gloss_keys_have_no_language_marker() {
        assert_eq!(gloss_key_language("numbered:abc-1"), None);
        assert_eq!(
            gloss_key_language("numbered:es:abc-1"),
            Some(String::from("es"))
        );
        assert_eq!(gloss_key_language("other"), None);
    }

    #[test]
    fn an_unrecorded_session_keeps_its_translation_language() {
        let settings = settings();
        let attempts = vec![SetupAttempt {
            transcript: String::from("Bonjour je vais au marché"),
            tts_voice: Some(settings.tts_voice.clone()),
            translation_language: Some(String::from("en")),
            word_gloss_keys: vec![String::from("numbered:abc")],
        }];
        let inferred = infer_session_setup(&attempts, &settings);
        assert_eq!(inferred.target_language, "fr");
        assert_eq!(inferred.instruction_language, "en");
        assert_eq!(inferred.tts_voice, settings.tts_voice);
    }

    #[test]
    fn an_unrecorded_session_guesses_by_letters_and_repairs_voices() {
        let mut settings = settings();
        settings.target_language = String::from("ja");
        settings.instruction_language = String::from("fa");
        settings.tts_voice = String::from("not-a-voice");
        settings.explanation_voice = String::from("not-a-voice");
        let attempts = vec![SetupAttempt {
            transcript: String::from("Bonjour je vais au marché"),
            ..SetupAttempt::default()
        }];
        let inferred = infer_session_setup(&attempts, &settings);
        // Latin letters: French, one of the languages offered before setups.
        assert_eq!(inferred.target_language, "fr");
        // No recorded translation language, so Settings' choice survives.
        assert_eq!(inferred.instruction_language, "fa");
        // The unknown voices become the languages' defaults.
        assert!(!inferred.tts_voice.is_empty());
        assert!(!inferred.explanation_voice.is_empty());
    }

    fn settings() -> AppSettings {
        AppSettings {
            target_language: String::from("fr"),
            instruction_language: String::from("en"),
            tts_mode: String::from("local"),
            tts_voice: String::from("piper-tom-medium"),
            explanation_voice: String::from("piper-en-amy"),
            target_speech_pace: 0.9,
            ..AppSettings::default()
        }
    }
}
