// SPDX-License-Identifier: AGPL-3.0-or-later

//! Settings: the raw row service and the typed document.
//!
//! The typed defaults, merge and normalisation moved here from
//! `src/lib/stores/settings.ts` in the P7 closeout. The driver still owns the
//! optimistic Svelte store and the secret store; the core owns what a valid
//! document looks like and writes the changed rows.
//!
//! BYOK secrets live in browser storage, never in the database (invariant I3).
//! The service still refuses the legacy secret prefix, so a restored or
//! hand-edited file cannot leak a key through `settings.list`/`settings.get`.

use std::collections::BTreeMap;

use onspot_domain::Setting;
use onspot_ports::{SettingsStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::language as languages;
use crate::providers;

/// The prefix `stores/secrets.ts` uses in browser storage. It must never be a
/// settings row the bridge returns.
const SECRET_PREFIX: &str = "onspot.key.";

/// Every typed document field is stored under this prefix.
pub const FIELD_PREFIX: &str = "onspot.setting.";

/// Present once a database's saved model has been moved to Automatic. Without
/// it, the provider's preset model counts as never chosen; with it, a learner
/// who later picks that same model keeps it.
pub const AUTOMATIC_MODEL_MIGRATION_KEY: &str = "onspot.migration.automatic-model";

/// The speaking paces a learner can choose for the target-language voice.
pub const SPEECH_PACES: [f64; 4] = [0.8, 0.9, 1.0, 1.1];

/// A little slower than natural: the user found the voices' natural pace too
/// fast to follow (2026-11-08).
pub const DEFAULT_TARGET_SPEECH_PACE: f64 = 0.9;

/// Premade ElevenLabs voice used until the learner picks one.
pub const DEFAULT_ELEVENLABS_VOICE_ID: &str = "Xb7hH8MSUJpSbSDYk0k2";

/// The previous default, now a paid Voice Library voice; a stored copy is
/// replaced with the current default.
pub const RETIRED_DEFAULT_ELEVENLABS_VOICE_ID: &str = "21m00Tcm4TlvDq8ikWAM";

/// Per-voice learner adjustments, in dB.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceTuning {
    pub volume_db: f64,
    pub bass_db: f64,
    pub body_db: f64,
    pub presence_db: f64,
    pub treble_db: f64,
}

/// Non-secret preferences, persisted in the database so they sync with the
/// learner's data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub level: String,
    pub mode: String,
    pub stt_mode: String,
    pub tts_mode: String,
    pub tts_voice: String,
    pub target_voice_by_language: BTreeMap<String, String>,
    pub target_speech_pace: f64,
    pub correction_mode: String,
    pub local_llm_url: String,
    pub local_llm_model: String,
    pub tts_cloud_provider: String,
    pub eleven_labs_model: String,
    pub eleven_labs_voice_id: String,
    pub tts_api_base_url: String,
    pub tts_api_model: String,
    pub tts_api_voice: String,
    pub llm_provider: String,
    pub llm_model: String,
    pub custom_base_url: String,
    pub custom_model: String,
    pub explanation_voice: String,
    pub explanation_voice_by_language: BTreeMap<String, String>,
    pub target_language: String,
    pub instruction_language: String,
    pub sync_provider: String,
    pub webdav_url: String,
    pub webdav_path: String,
    pub voice_tunings: BTreeMap<String, VoiceTuning>,
    pub practice_reminders: bool,
    pub reminder_frequency: String,
    pub show_word_pos: bool,
    pub prompt_contributions: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            level: String::from("B1"),
            mode: String::from("exam"),
            stt_mode: String::from("local"),
            tts_mode: String::from("local"),
            tts_voice: String::from("piper-tom-medium"),
            target_voice_by_language: BTreeMap::new(),
            target_speech_pace: DEFAULT_TARGET_SPEECH_PACE,
            correction_mode: String::from("cloud"),
            local_llm_url: String::from("http://localhost:1234/v1"),
            local_llm_model: String::new(),
            tts_cloud_provider: String::from("elevenlabs"),
            eleven_labs_model: String::from("eleven_multilingual_v2"),
            eleven_labs_voice_id: String::from(DEFAULT_ELEVENLABS_VOICE_ID),
            tts_api_base_url: String::from("https://api.openai.com/v1"),
            tts_api_model: String::from("gpt-4o-mini-tts"),
            tts_api_voice: String::from("alloy"),
            llm_provider: String::from("groq"),
            llm_model: providers::automatic_model().to_owned(),
            custom_base_url: String::new(),
            custom_model: String::new(),
            explanation_voice: String::new(),
            explanation_voice_by_language: BTreeMap::new(),
            target_language: languages::default_language_id().to_owned(),
            instruction_language: String::from("en"),
            sync_provider: String::from("off"),
            webdav_url: String::new(),
            webdav_path: String::from("/onspot/onspot.sqlite"),
            voice_tunings: BTreeMap::new(),
            practice_reminders: false,
            reminder_frequency: String::from("frequent"),
            show_word_pos: false,
            prompt_contributions: true,
        }
    }
}

/// The typed document plus what the load had to migrate.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSettings {
    pub settings: AppSettings,
    /// True when the legacy preset/classifier model was moved to Automatic.
    pub moved_to_automatic: bool,
    /// True when the migration marker row already existed.
    pub migration_recorded: bool,
}

/// The result of a patch: the new document and whether anything was written.
#[derive(Debug, Clone, PartialEq)]
pub struct PatchedSettings {
    pub settings: AppSettings,
    pub changed: bool,
}

/// The settings use cases over a [`SettingsStore`].
pub struct SettingsService<'a> {
    store: &'a dyn SettingsStore,
}

impl<'a> SettingsService<'a> {
    /// Creates the service over a store.
    pub fn new(store: &'a dyn SettingsStore) -> Self {
        Self { store }
    }

    /// Every stored row, ordered by key, without anything under the secret
    /// prefix.
    pub async fn list(&self) -> Result<Vec<Setting>, StoreError> {
        Ok(self
            .store
            .list()
            .await?
            .into_iter()
            .filter(|setting| !setting.key.starts_with(SECRET_PREFIX))
            .collect())
    }

    /// One stored value; a key under the secret prefix is never returned.
    pub async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        if key.starts_with(SECRET_PREFIX) {
            return Ok(None);
        }
        self.store.get(key).await
    }

    /// Inserts or replaces one value.
    pub async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.store.set(key, value).await
    }

    /// Reads the rows, merges them over the defaults, normalises the document
    /// and records the Automatic-model migration. Returns the document and the
    /// rows after those writes; callers use the rows as the driver's
    /// `written` map so unchanged fields are never written back.
    pub async fn load_document(&self) -> Result<(LoadedSettings, Vec<Setting>), StoreError> {
        let rows = self.list().await?;
        let loaded = document_from_rows(&rows);
        self.persist_migrations(&loaded).await?;
        let rows = self.list().await?;
        Ok((document_from_rows(&rows), rows))
    }

    /// Applies a patch of JSON-encoded fields, normalises the document and
    /// writes only rows whose values changed.
    pub async fn patch_document(
        &self,
        patch: &BTreeMap<String, String>,
    ) -> Result<PatchedSettings, StoreError> {
        let rows = self.list().await?;
        let before = document_from_rows(&rows).settings;
        self.persist_migrations(&document_from_rows(&rows)).await?;

        let mut after = before.clone();
        for (field, raw) in patch {
            if let Ok(value) = serde_json::from_str::<Value>(raw) {
                apply_value(&mut after, field, &value);
            }
        }
        normalize_document(&mut after);

        // A voice sent with a language change is an explicit choice; the
        // remembered voice must not override it. Keep the memory in step with
        // the explicit voice as well.
        let explicit_target_voice = patch.contains_key("ttsVoice");
        let explicit_explanation_voice = patch.contains_key("explanationVoice");
        let target_voice = after.tts_voice.clone();
        let explanation_voice = after.explanation_voice.clone();
        after = with_remembered_voices(&before, &after);
        if explicit_target_voice {
            after.tts_voice = target_voice;
            if voice_for(&after.target_language, &after.tts_voice).is_some() {
                after
                    .target_voice_by_language
                    .insert(after.target_language.clone(), after.tts_voice.clone());
            }
        }
        if explicit_explanation_voice {
            after.explanation_voice = explanation_voice;
            if voice_for(&after.instruction_language, &after.explanation_voice).is_some() {
                after.explanation_voice_by_language.insert(
                    after.instruction_language.clone(),
                    after.explanation_voice.clone(),
                );
            }
        }

        let changed = write_changed(&before, &after, self.store).await?;
        Ok(PatchedSettings {
            settings: after,
            changed,
        })
    }

    async fn persist_migrations(&self, loaded: &LoadedSettings) -> Result<(), StoreError> {
        if loaded.moved_to_automatic {
            let value = serde_json::to_string(providers::automatic_model())
                .expect("the automatic model id serializes");
            self.set(&field_key("llmModel"), &value).await?;
        }
        if !loaded.migration_recorded {
            self.set(AUTOMATIC_MODEL_MIGRATION_KEY, "done").await?;
        }
        Ok(())
    }
}

/// Builds the typed document from stored rows, applying every legacy
/// normalisation. Pure so the tests and the patch path share it.
pub fn document_from_rows(rows: &[Setting]) -> LoadedSettings {
    let mut settings = AppSettings::default();
    let migration_recorded = rows
        .iter()
        .any(|row| row.key == AUTOMATIC_MODEL_MIGRATION_KEY);

    for row in rows {
        let Some(field) = row.key.strip_prefix(FIELD_PREFIX) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(&row.value) {
            apply_value(&mut settings, field, &value);
        }
    }

    // Before Automatic, every learner had a model saved: the provider's preset
    // unless they changed it, and the preset was never a choice. A non-chat
    // model (a classifier such as gpt-oss-safeguard) can never evaluate a take.
    let saved_preset = !migration_recorded
        && settings.llm_model == providers::provider(&settings.llm_provider).default_model;
    let moved_to_automatic = saved_preset || !providers::is_chat_model(&settings.llm_model);
    if moved_to_automatic {
        settings.llm_model = providers::automatic_model().to_owned();
    }

    // The old default ElevenLabs voice is now a paid Voice Library voice, so
    // every take would fail with HTTP 402 on the free plan; it was never a
    // learner's pick.
    if settings.eleven_labs_voice_id == RETIRED_DEFAULT_ELEVENLABS_VOICE_ID {
        settings.eleven_labs_voice_id = DEFAULT_ELEVENLABS_VOICE_ID.to_owned();
    }

    normalize_document(&mut settings);

    LoadedSettings {
        settings,
        moved_to_automatic,
        migration_recorded,
    }
}

/// The normalisation every load and patch shares: languages, voices, choice
/// fields and the speech pace.
fn normalize_document(settings: &mut AppSettings) {
    normalize_languages(settings);
    validate_choices(settings);
    if !SPEECH_PACES.contains(&settings.target_speech_pace) {
        settings.target_speech_pace = DEFAULT_TARGET_SPEECH_PACE;
    }
}

fn sanitize_document(settings: &mut AppSettings) {
    settings.voice_tunings = sanitize_tunings(&settings.voice_tunings);
    settings
        .target_voice_by_language
        .retain(|language_id, voice_id| voice_for(language_id, voice_id).is_some());
    settings
        .explanation_voice_by_language
        .retain(|language_id, voice_id| voice_for(language_id, voice_id).is_some());
}

fn normalize_languages(settings: &mut AppSettings) {
    // Settings written before the language registry used ids stored the English
    // name ("French"). Normalise to the registry id, or fall back to the
    // default language.
    let matched = languages::catalog()
        .languages
        .iter()
        .find(|language| {
            language.id == settings.target_language || language.name == settings.target_language
        })
        .map(|language| language.id.clone());
    settings.target_language =
        matched.unwrap_or_else(|| languages::default_language_id().to_owned());

    // Cloud-only languages must not load with stale local modes.
    if let Some(language) = languages::language(&settings.target_language) {
        if !language.local.stt {
            settings.stt_mode = String::from("cloud");
        }
        if !language.local.tts {
            settings.tts_mode = String::from("cloud");
        }
        if !language.local.correction {
            settings.correction_mode = String::from("cloud");
        }
    }

    sanitize_document(settings);

    // An unknown instruction language, or the studied language itself, falls
    // back to the default.
    let teachable = languages::catalog()
        .instruction_languages
        .iter()
        .any(|language| {
            language.id == settings.instruction_language && language.id != settings.target_language
        });
    if !teachable {
        settings.instruction_language =
            languages::default_instruction_language_for(&settings.target_language);
    }

    // A voice saved for another language (or removed from the registry) would
    // leave the Voice select blank and read-backs on an unknown voice.
    if voice_for(&settings.target_language, &settings.tts_voice).is_none() {
        settings.tts_voice = languages::language(&settings.target_language)
            .and_then(|language| language.default_voice.clone())
            .unwrap_or_else(|| AppSettings::default().tts_voice);
    }

    let remembered = with_remembered_voices(settings, settings);
    *settings = remembered;
}

/// Port of `withRememberedVoices`: keeps each language's voices and brings
/// back the voice last chosen for a newly selected language.
fn with_remembered_voices(before: &AppSettings, next: &AppSettings) -> AppSettings {
    let mut settings = next.clone();

    if settings.target_language != before.target_language {
        let remembered = settings
            .target_voice_by_language
            .get(&settings.target_language)
            .cloned();
        if remembered
            .as_deref()
            .is_some_and(|voice| voice_for(&settings.target_language, voice).is_some())
        {
            settings.tts_voice = remembered.expect("checked above");
        } else if voice_for(&settings.target_language, &settings.tts_voice).is_none() {
            if let Some(default) = languages::language(&settings.target_language)
                .and_then(|language| language.default_voice.clone())
            {
                settings.tts_voice = default;
            }
        }
    }

    if settings.instruction_language != before.instruction_language {
        let remembered = settings
            .explanation_voice_by_language
            .get(&settings.instruction_language)
            .cloned();
        if remembered
            .as_deref()
            .is_some_and(|voice| voice_for(&settings.instruction_language, voice).is_some())
        {
            settings.explanation_voice = remembered.expect("checked above");
        } else if voice_for(&settings.instruction_language, &settings.explanation_voice).is_none() {
            settings.explanation_voice = String::new();
        }
    }

    if voice_for(&settings.target_language, &settings.tts_voice).is_some()
        && settings
            .target_voice_by_language
            .get(&settings.target_language)
            != Some(&settings.tts_voice)
    {
        settings
            .target_voice_by_language
            .insert(settings.target_language.clone(), settings.tts_voice.clone());
    }

    if voice_for(&settings.instruction_language, &settings.explanation_voice).is_some()
        && settings
            .explanation_voice_by_language
            .get(&settings.instruction_language)
            != Some(&settings.explanation_voice)
    {
        settings.explanation_voice_by_language.insert(
            settings.instruction_language.clone(),
            settings.explanation_voice.clone(),
        );
    }

    settings
}

fn voice_for(language_id: &str, voice_id: &str) -> Option<&'static languages::Voice> {
    languages::voices_for(language_id)
        .iter()
        .find(|voice| voice.id == voice_id)
}

/// Applies one field if its JSON value has the expected type. Unknown fields
/// and malformed values are ignored, as the legacy per-field parse did.
fn apply_value(settings: &mut AppSettings, field: &str, value: &Value) -> bool {
    macro_rules! set {
        ($name:ident, $ty:ty) => {{
            if let Ok(parsed) = serde_json::from_value::<$ty>(value.clone()) {
                settings.$name = parsed;
                return true;
            }
            false
        }};
    }

    match field {
        "level" => set!(level, String),
        "mode" => set!(mode, String),
        "sttMode" => set!(stt_mode, String),
        "ttsMode" => set!(tts_mode, String),
        "ttsVoice" => set!(tts_voice, String),
        "targetVoiceByLanguage" => {
            settings.target_voice_by_language = parse_string_map(value);
            true
        }
        "targetSpeechPace" => set!(target_speech_pace, f64),
        "correctionMode" => set!(correction_mode, String),
        "localLlmUrl" => set!(local_llm_url, String),
        "localLlmModel" => set!(local_llm_model, String),
        "ttsCloudProvider" => set!(tts_cloud_provider, String),
        "elevenLabsModel" => set!(eleven_labs_model, String),
        "elevenLabsVoiceId" => set!(eleven_labs_voice_id, String),
        "ttsApiBaseUrl" => set!(tts_api_base_url, String),
        "ttsApiModel" => set!(tts_api_model, String),
        "ttsApiVoice" => set!(tts_api_voice, String),
        "llmProvider" => set!(llm_provider, String),
        "llmModel" => set!(llm_model, String),
        "customBaseUrl" => set!(custom_base_url, String),
        "customModel" => set!(custom_model, String),
        "explanationVoice" => set!(explanation_voice, String),
        "explanationVoiceByLanguage" => {
            settings.explanation_voice_by_language = parse_string_map(value);
            true
        }
        "targetLanguage" => set!(target_language, String),
        "instructionLanguage" => set!(instruction_language, String),
        "syncProvider" => set!(sync_provider, String),
        "webdavUrl" => set!(webdav_url, String),
        "webdavPath" => set!(webdav_path, String),
        "voiceTunings" => {
            settings.voice_tunings = parse_tunings(value);
            true
        }
        "practiceReminders" => set!(practice_reminders, bool),
        "reminderFrequency" => set!(reminder_frequency, String),
        "showWordPos" => set!(show_word_pos, bool),
        "promptContributions" => set!(prompt_contributions, bool),
        _ => false,
    }
}

fn parse_string_map(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Per-voice tuning values are clamped to the UI's ±12 dB range; malformed
/// entries become neutral.
fn parse_tunings(value: &Value) -> BTreeMap<String, VoiceTuning> {
    value
        .as_object()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(voice_id, raw)| {
                    let raw = raw.as_object()?;
                    let clamp = |key: &str| {
                        raw.get(key)
                            .and_then(Value::as_f64)
                            .filter(|value| value.is_finite())
                            .map(|value| value.clamp(-12.0, 12.0))
                            .unwrap_or(0.0)
                    };
                    Some((
                        voice_id.clone(),
                        VoiceTuning {
                            volume_db: clamp("volumeDb"),
                            bass_db: clamp("bassDb"),
                            body_db: clamp("bodyDb"),
                            presence_db: clamp("presenceDb"),
                            treble_db: clamp("trebleDb"),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn sanitize_tunings(value: &BTreeMap<String, VoiceTuning>) -> BTreeMap<String, VoiceTuning> {
    value
        .iter()
        .map(|(voice_id, tuning)| {
            let clamp = |value: f64| {
                if value.is_finite() {
                    value.clamp(-12.0, 12.0)
                } else {
                    0.0
                }
            };
            (
                voice_id.clone(),
                VoiceTuning {
                    volume_db: clamp(tuning.volume_db),
                    bass_db: clamp(tuning.bass_db),
                    body_db: clamp(tuning.body_db),
                    presence_db: clamp(tuning.presence_db),
                    treble_db: clamp(tuning.treble_db),
                },
            )
        })
        .collect()
}

/// Choice fields: an unknown value falls back to the default rather than
/// rendering an empty select.
fn validate_choices(settings: &mut AppSettings) {
    let defaults = AppSettings::default();
    macro_rules! choice {
        ($name:ident, $($allowed:literal),+) => {
            if !matches!(settings.$name.as_str(), $($allowed)|+) {
                settings.$name = defaults.$name;
            }
        };
    }

    choice!(level, "A2", "B1", "B2", "C1");
    choice!(mode, "exam", "casual", "freeflow");
    choice!(stt_mode, "local", "cloud");
    choice!(tts_mode, "local", "cloud");
    choice!(tts_cloud_provider, "elevenlabs", "openai");
    choice!(correction_mode, "cloud", "local");
    choice!(llm_provider, "groq", "deepseek", "custom");
    choice!(sync_provider, "off", "google-drive", "webdav");
    choice!(reminder_frequency, "frequent", "infrequent");
}

fn field_key(field: &str) -> String {
    format!("{FIELD_PREFIX}{field}")
}

/// Writes every field whose value differs between two documents.
async fn write_changed(
    before: &AppSettings,
    after: &AppSettings,
    store: &dyn SettingsStore,
) -> Result<bool, StoreError> {
    let before = serde_json::to_value(before).expect("the settings document serializes");
    let after = serde_json::to_value(after).expect("the settings document serializes");
    let (Some(before), Some(after)) = (before.as_object(), after.as_object()) else {
        return Ok(false);
    };

    let mut changed = false;
    for (field, value) in after {
        if before.get(field) == Some(value) {
            continue;
        }
        let raw = serde_json::to_string(value).expect("a settings field serializes");
        store.set(&field_key(field), &raw).await?;
        changed = true;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use futures::executor::block_on;
    use onspot_domain::Setting;

    use super::*;

    /// A store whose rows are whatever the test put there.
    struct FakeStore(Mutex<Vec<Setting>>);

    #[async_trait]
    impl SettingsStore for FakeStore {
        async fn list(&self) -> Result<Vec<Setting>, StoreError> {
            Ok(self.0.lock().expect("fake store").clone())
        }

        async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
            Ok(self
                .0
                .lock()
                .expect("fake store")
                .iter()
                .find(|setting| setting.key == key)
                .map(|setting| setting.value.clone()))
        }

        async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
            let mut rows = self.0.lock().expect("fake store");
            if let Some(row) = rows.iter_mut().find(|row| row.key == key) {
                row.value = value.to_owned();
            } else {
                rows.push(setting(key, value));
            }
            Ok(())
        }
    }

    fn setting(key: &str, value: &str) -> Setting {
        Setting {
            key: key.to_owned(),
            value: value.to_owned(),
            updated_at: String::from("2026-11-12T00:00:00.000Z"),
        }
    }

    fn document(rows: Vec<(&str, &str)>) -> AppSettings {
        let rows = rows
            .into_iter()
            .map(|(field, value)| setting(&field_key(field), value))
            .collect::<Vec<_>>();
        document_from_rows(&rows).settings
    }

    #[test]
    fn key_material_never_surfaces_through_settings() {
        let store = FakeStore(Mutex::new(vec![
            setting("onspot.setting.level", "\"B1\""),
            setting("onspot.key.llm.groq", "secret-value"),
        ]));
        let service = SettingsService::new(&store);

        block_on(async {
            let rows = service.list().await.expect("list");
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].key, "onspot.setting.level");
            assert_eq!(service.get("onspot.key.llm.groq").await.expect("get"), None);
        });
    }

    #[test]
    fn defaults_match_the_legacy_document() {
        let settings = AppSettings::default();
        assert_eq!(settings.level, "B1");
        assert_eq!(settings.mode, "exam");
        assert_eq!(settings.target_language, "fr");
        assert_eq!(settings.instruction_language, "en");
        assert_eq!(settings.tts_voice, "piper-tom-medium");
        assert_eq!(settings.llm_model, providers::automatic_model());
        assert_eq!(settings.webdav_path, "/onspot/onspot.sqlite");
        assert!(settings.prompt_contributions);
        assert!(!settings.show_word_pos);
    }

    #[test]
    fn malformed_rows_keep_the_default_and_valid_rows_merge() {
        let settings = document(vec![
            ("level", "\"C1\""),
            ("mode", "42"),
            ("showWordPos", "true"),
            ("practiceReminders", "not-json"),
            ("targetSpeechPace", "1.3"),
        ]);
        assert_eq!(settings.level, "C1");
        assert_eq!(settings.mode, "exam");
        assert!(settings.show_word_pos);
        assert!(!settings.practice_reminders);
        assert_eq!(settings.target_speech_pace, DEFAULT_TARGET_SPEECH_PACE);
    }

    #[test]
    fn legacy_language_names_and_cloud_only_modes_normalise() {
        let settings = document(vec![
            ("targetLanguage", "\"French\""),
            ("sttMode", "\"local\""),
            ("ttsMode", "\"local\""),
            ("correctionMode", "\"local\""),
        ]);
        assert_eq!(settings.target_language, "fr");
    }

    #[test]
    fn unknown_target_falls_back_and_instruction_may_not_equal_it() {
        let settings = document(vec![
            ("targetLanguage", "\"nope\""),
            ("instructionLanguage", "\"fr\""),
        ]);
        assert_eq!(settings.target_language, "fr");
        assert_eq!(settings.instruction_language, "en");
    }

    #[test]
    fn a_voice_from_another_language_is_replaced_by_the_language_default() {
        let settings = document(vec![
            ("targetLanguage", "\"fr\""),
            ("ttsVoice", "\"piper-en-ryan-medium\""),
        ]);
        assert_eq!(settings.tts_voice, "piper-tom-medium");
    }

    #[test]
    fn remembered_voices_are_filtered_and_filled() {
        let settings = document(vec![
            ("targetLanguage", "\"fr\""),
            ("ttsVoice", "\"piper-tom-medium\""),
            (
                "targetVoiceByLanguage",
                "{\"fr\":\"piper-tom-medium\",\"en\":\"missing\"}",
            ),
        ]);
        assert_eq!(
            settings
                .target_voice_by_language
                .get("fr")
                .map(String::as_str),
            Some("piper-tom-medium")
        );
        assert!(!settings.target_voice_by_language.contains_key("en"));
    }

    #[test]
    fn changing_the_language_restores_its_remembered_voice() {
        let before = document(vec![
            ("targetLanguage", "\"fr\""),
            ("ttsVoice", "\"piper-tom-medium\""),
            (
                "targetVoiceByLanguage",
                "{\"fr\":\"piper-tom-medium\",\"en\":\"piper-en-ryan-medium\"}",
            ),
        ]);
        let mut after = before.clone();
        after.target_language = String::from("en");
        let after = with_remembered_voices(&before, &after);
        assert_eq!(after.tts_voice, "piper-en-ryan-medium");
    }

    #[test]
    fn the_automatic_migration_moves_presets_and_classifiers() {
        let preset = document(vec![
            ("llmProvider", "\"groq\""),
            ("llmModel", "\"openai/gpt-oss-120b\""),
        ]);
        assert_eq!(preset.llm_model, providers::automatic_model());

        let classifier = document(vec![
            ("llmProvider", "\"groq\""),
            ("llmModel", "\"whisper-large-v3\""),
        ]);
        assert_eq!(classifier.llm_model, providers::automatic_model());

        let unknown = document(vec![
            ("llmProvider", "\"groq\""),
            ("llmModel", "\"vendor/private-model\""),
        ]);
        assert_eq!(unknown.llm_model, "vendor/private-model");
    }

    #[test]
    fn a_recorded_migration_keeps_a_later_preset_choice() {
        let rows = vec![
            setting(&field_key("llmProvider"), "\"groq\""),
            setting(&field_key("llmModel"), "\"openai/gpt-oss-120b\""),
            setting(AUTOMATIC_MODEL_MIGRATION_KEY, "done"),
        ];
        let loaded = document_from_rows(&rows);
        assert_eq!(loaded.settings.llm_model, "openai/gpt-oss-120b");
        assert!(loaded.migration_recorded);
        assert!(!loaded.moved_to_automatic);
    }

    #[test]
    fn the_retired_elevenlabs_voice_is_replaced() {
        let settings = document(vec![("elevenLabsVoiceId", "\"21m00Tcm4TlvDq8ikWAM\"")]);
        assert_eq!(settings.eleven_labs_voice_id, DEFAULT_ELEVENLABS_VOICE_ID);
    }

    #[test]
    fn choices_and_pace_fall_back_to_defaults() {
        let settings = document(vec![
            ("level", "\"Z9\""),
            ("reminderFrequency", "\"hourly\""),
            ("targetSpeechPace", "2.0"),
        ]);
        assert_eq!(settings.level, "B1");
        assert_eq!(settings.reminder_frequency, "frequent");
        assert_eq!(settings.target_speech_pace, DEFAULT_TARGET_SPEECH_PACE);
    }

    #[test]
    fn tunings_are_clamped_and_malformed_entries_become_neutral() {
        let settings = document(vec![(
            "voiceTunings",
            "{\"v1\":{\"volumeDb\":40,\"bassDb\":-40},\"v2\":\"bad\"}",
        )]);
        let tuning = settings.voice_tunings.get("v1").expect("tuning");
        assert_eq!(tuning.volume_db, 12.0);
        assert_eq!(tuning.bass_db, -12.0);
        assert!(!settings.voice_tunings.contains_key("v2"));
    }

    #[test]
    fn load_persists_the_migration_and_returns_the_written_rows() {
        let store = FakeStore(Mutex::new(vec![
            setting(&field_key("llmProvider"), "\"groq\""),
            setting(&field_key("llmModel"), "\"openai/gpt-oss-120b\""),
        ]));
        let service = SettingsService::new(&store);

        block_on(async {
            let (loaded, rows) = service.load_document().await.expect("load");
            assert_eq!(loaded.settings.llm_model, providers::automatic_model());
            assert!(rows
                .iter()
                .any(|row| row.key == AUTOMATIC_MODEL_MIGRATION_KEY));
            assert!(service
                .get(&field_key("llmModel"))
                .await
                .expect("get")
                .is_some_and(|value| value.contains("auto")));
        });
    }

    #[test]
    fn patch_normalises_and_writes_only_changed_fields() {
        let store = FakeStore(Mutex::new(vec![
            setting(&field_key("targetLanguage"), "\"fr\""),
            setting(&field_key("ttsVoice"), "\"piper-tom-medium\""),
            setting(&field_key("level"), "\"B1\""),
        ]));
        let service = SettingsService::new(&store);

        block_on(async {
            let mut patch = BTreeMap::new();
            patch.insert(String::from("level"), String::from("\"C1\""));
            patch.insert(String::from("showWordPos"), String::from("true"));
            let result = service.patch_document(&patch).await.expect("patch");
            assert!(result.changed);
            assert_eq!(result.settings.level, "C1");
            assert!(result.settings.show_word_pos);
            let level = service.get(&field_key("level")).await.expect("get");
            assert_eq!(level.as_deref(), Some("\"C1\""));
            let pos = service.get(&field_key("showWordPos")).await.expect("get");
            assert_eq!(pos.as_deref(), Some("true"));
        });
    }

    #[test]
    fn patch_normalises_choices_and_an_explicit_voice_beats_the_memory() {
        let store = FakeStore(Mutex::new(vec![
            setting(&field_key("targetLanguage"), "\"fr\""),
            setting(&field_key("ttsVoice"), "\"piper-tom-medium\""),
            setting(&field_key("level"), "\"B1\""),
            setting(
                &field_key("targetVoiceByLanguage"),
                "{\"es\":\"supertonic-es-f1\"}",
            ),
        ]));
        let service = SettingsService::new(&store);

        block_on(async {
            let mut patch = BTreeMap::new();
            patch.insert(String::from("targetLanguage"), String::from("\"es\""));
            patch.insert(
                String::from("ttsVoice"),
                String::from("\"supertonic-es-f2\""),
            );
            patch.insert(String::from("level"), String::from("\"Z9\""));
            let result = service.patch_document(&patch).await.expect("patch");
            assert_eq!(result.settings.target_language, "es");
            assert_eq!(result.settings.tts_voice, "supertonic-es-f2");
            assert_eq!(
                result
                    .settings
                    .target_voice_by_language
                    .get("es")
                    .map(String::as_str),
                Some("supertonic-es-f2")
            );
            assert_eq!(result.settings.level, "B1");
        });
    }
}
