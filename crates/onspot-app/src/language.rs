// SPDX-License-Identifier: AGPL-3.0-or-later

//! The language registry, moved from `src/lib/languages/` as checked-in data.
//!
//! The JSON is generated from the TypeScript registry by
//! `scripts/export-language-catalog.mjs`; the build test reads the same file and
//! fails if it cannot be deserialized.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A language's approved local-engine support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSupport {
    #[serde(default)]
    pub stt: bool,
    #[serde(default)]
    pub tts: bool,
    #[serde(default)]
    pub correction: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttModel {
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttModels {
    pub whisper_cpp: SttModel,
    pub transformers: SttModel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LanguageStt {
    pub models: SttModels,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub id: String,
    pub locale: String,
    pub name: String,
    pub native_name: String,
    pub web_text_percent: f64,
    pub local: LocalSupport,
    #[serde(default)]
    pub stt: Option<LanguageStt>,
    #[serde(default)]
    pub default_voice: Option<String>,
}

/// One cached download a voice needs, from the TypeScript registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAsset {
    pub url: String,
    /// What the download occupies on the device.
    pub bytes: u64,
    /// What it costs over the network; the host may compress it.
    pub transfer_bytes: u64,
}

/// A downloadable voice; only planner-relevant fields are carried.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub download_bytes: u64,
    /// Individual downloads, so shared assets are counted once and transfer
    /// sizes stay distinct from device sizes.
    #[serde(default)]
    pub assets: Vec<VoiceAsset>,
}

/// The instruction languages offered for explanations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionLanguage {
    pub id: String,
    pub name: String,
    pub native_name: String,
    pub web_text_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub languages: Vec<Language>,
    pub instruction_languages: Vec<InstructionLanguage>,
    pub voices_by_language: BTreeMap<String, Vec<Voice>>,
    pub default_language_id: String,
}

static CATALOG: Lazy<Catalog> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/languages.json"))
        .expect("the checked-in language catalog is valid")
});

/// The whole registry.
pub fn catalog() -> &'static Catalog {
    &CATALOG
}

/// Finds a language by ISO id.
pub fn language(id: &str) -> Option<&'static Language> {
    CATALOG.languages.iter().find(|language| language.id == id)
}

/// The default study language id.
pub fn default_language_id() -> &'static str {
    &CATALOG.default_language_id
}

/// The approved voices for a language, in registry order.
pub fn voices_for(id: &str) -> &'static [Voice] {
    CATALOG
        .voices_by_language
        .get(id)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// The registry's default voice for a language, if it has one.
pub fn default_voice(id: &str) -> Option<&'static Voice> {
    let language = language(id)?;
    let preferred = language.default_voice.as_deref()?;
    voices_for(id).iter().find(|voice| voice.id == preferred)
}

/// The language a learner is taught in until they choose: English, or, for
/// learners of English, the language with the most text on the web after it.
pub fn default_instruction_language_for(target_id: &str) -> String {
    if target_id != "en" {
        return String::from("en");
    }
    let mut best: Option<&InstructionLanguage> = None;
    for language in &CATALOG.instruction_languages {
        if language.id == target_id {
            continue;
        }
        if best.map_or(true, |current| {
            language.web_text_percent > current.web_text_percent
        }) {
            best = Some(language);
        }
    }
    best.map(|language| language.id.clone())
        .unwrap_or_else(|| String::from("en"))
}

/// Common Crawl share, from the registry's high/medium/low thresholds.
pub fn resource_level(web_text_percent: f64) -> &'static str {
    if web_text_percent >= 1.0 {
        "high"
    } else if web_text_percent >= 0.1 {
        "medium"
    } else {
        "low"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_has_the_approved_languages_and_voices() {
        assert_eq!(catalog().languages.len(), 35);
        assert_eq!(
            language("fr").map(|entry| entry.name.as_str()),
            Some("French")
        );
        assert!(!voices_for("fr").is_empty());
        assert!(default_voice("fr").is_some());
        assert!(language("en").is_some());
    }

    #[test]
    fn resource_levels_follow_the_registry_thresholds() {
        assert_eq!(resource_level(42.56), "high");
        assert_eq!(resource_level(0.5), "medium");
        assert_eq!(resource_level(0.01), "low");
    }
}

/// Which local parts the learner's processing choices need.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguageParts {
    pub stt: bool,
    pub voice: bool,
    pub explanation_voice: bool,
}

/// Bytes still to download for the required parts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PendingBytes {
    pub stt: u32,
    pub voice: u32,
    pub explanation_voice: u32,
    pub storage: u32,
    pub transfer: u32,
}

/// One check of the language's required local data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguagePlan {
    pub required: LanguageParts,
    pub installed: LanguageParts,
    pub pending: PendingBytes,
    pub ready: bool,
}

/// Inputs the driver supplies from its caches and settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/lib/core-client/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LanguagePlanInput {
    pub language_id: String,
    pub instruction_language_id: String,
    pub native: bool,
    pub required: LanguageParts,
    pub installed: LanguageParts,
    #[serde(default)]
    pub voice_id: Option<String>,
    #[serde(default)]
    pub explanation_voice_id: Option<String>,
    /// URLs already in the driver's cache. A part is priced from its missing
    /// assets only, so a shared model or an interrupted download is not counted
    /// again.
    #[serde(default)]
    pub cached_assets: Vec<String>,
}

/// The bridge and serde-wasm-bindgen turn `u64` into a JS `bigint`; byte
/// counts stay `u32` on the wire, which covers every approved download.
fn clamp_bytes(value: u64) -> u32 {
    value.min(u32::MAX as u64) as u32
}

/// The chosen voice's assets; the default voice when no id is given.
fn voice_assets(language_id: &str, voice_id: Option<&str>) -> &'static [VoiceAsset] {
    let voices = voices_for(language_id);
    let voice = match voice_id {
        Some(id) => voices.iter().find(|voice| voice.id == id),
        None => default_voice(language_id),
    };
    voice.map_or(&[], |voice| voice.assets.as_slice())
}

/// Missing assets and their transfer cost, leaving out URLs that are already
/// cached and URLs an earlier part already counted (Supertonic's model is
/// shared by every style).
fn missing_assets(
    assets: &[VoiceAsset],
    cached: &[String],
    already_counted: &[String],
) -> (u64, u64) {
    assets.iter().fold((0, 0), |(bytes, transfer), asset| {
        if cached.iter().any(|url| url == &asset.url)
            || already_counted.iter().any(|url| url == &asset.url)
        {
            (bytes, transfer)
        } else {
            (bytes + asset.bytes, transfer + asset.transfer_bytes)
        }
    })
}

/// Computes missing bytes and readiness from the catalog.
///
/// Each part is the sum of its *missing* assets: cached URLs and URLs an
/// earlier part already counted are left out. `storage` is what the missing
/// files occupy; `transfer` is what the host actually downloads (the Japanese
/// dictionary is compressed). The driver's `installed` flags are all-or-nothing
/// readiness, while `cached_assets` lets a partially cached part be priced
/// exactly.
pub fn plan_language_data(input: &LanguagePlanInput) -> LanguagePlan {
    let language = language(&input.language_id);
    let stt = if input.required.stt && !input.installed.stt {
        language
            .and_then(|language| language.stt.as_ref())
            .map(|stt| {
                if input.native {
                    stt.models.whisper_cpp.bytes
                } else {
                    stt.models.transformers.bytes
                }
            })
            .unwrap_or_default()
    } else {
        0
    };
    let target_assets = if input.required.voice {
        voice_assets(&input.language_id, input.voice_id.as_deref())
    } else {
        &[]
    };
    let target_urls: Vec<String> = target_assets
        .iter()
        .map(|asset| asset.url.clone())
        .collect();
    let (voice, voice_transfer) = if input.required.voice && !input.installed.voice {
        missing_assets(target_assets, &input.cached_assets, &[])
    } else {
        (0, 0)
    };

    let explanation_assets = if input.required.explanation_voice {
        voice_assets(
            &input.instruction_language_id,
            input.explanation_voice_id.as_deref(),
        )
    } else {
        &[]
    };
    let (explanation_voice, explanation_transfer) =
        if input.required.explanation_voice && !input.installed.explanation_voice {
            // The target voice may already fetch a shared asset (the Japanese
            // dictionary, the Supertonic model); count it once.
            missing_assets(explanation_assets, &input.cached_assets, &target_urls)
        } else {
            (0, 0)
        };

    let total = stt + voice + explanation_voice;
    let transfer = stt + voice_transfer + explanation_transfer;
    LanguagePlan {
        required: input.required,
        installed: LanguageParts {
            stt: !input.required.stt || input.installed.stt,
            voice: !input.required.voice || input.installed.voice,
            explanation_voice: !input.required.explanation_voice
                || input.installed.explanation_voice,
        },
        pending: PendingBytes {
            stt: clamp_bytes(stt),
            voice: clamp_bytes(voice),
            explanation_voice: clamp_bytes(explanation_voice),
            storage: clamp_bytes(total),
            transfer: clamp_bytes(transfer),
        },
        ready: stt == 0 && voice == 0 && explanation_voice == 0,
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;

    fn input() -> LanguagePlanInput {
        LanguagePlanInput {
            language_id: String::from("fr"),
            instruction_language_id: String::from("en"),
            native: true,
            required: LanguageParts {
                stt: true,
                voice: true,
                explanation_voice: false,
            },
            installed: LanguageParts {
                stt: false,
                voice: false,
                explanation_voice: false,
            },
            voice_id: None,
            explanation_voice_id: None,
            cached_assets: Vec::new(),
        }
    }

    #[test]
    fn missing_parts_add_up_and_installed_parts_cost_nothing() {
        let mut value = input();
        let plan = plan_language_data(&value);
        assert_eq!(plan.pending.stt, 190_085_487);
        assert!(plan.pending.voice > 0);
        assert_eq!(plan.pending.storage, plan.pending.transfer);
        assert!(!plan.ready);

        value.installed = LanguageParts {
            stt: true,
            voice: true,
            explanation_voice: true,
        };
        let ready = plan_language_data(&value);
        assert_eq!(ready.pending.storage, 0);
        assert!(ready.ready);
    }

    #[test]
    fn a_shared_model_is_counted_once_across_voice_and_explanation() {
        let mut value = input();
        value.language_id = String::from("en");
        value.instruction_language_id = String::from("fr");
        value.voice_id = Some(String::from("supertonic-en-f1"));
        value.explanation_voice_id = Some(String::from("supertonic-fr-f1"));
        value.required.explanation_voice = true;

        let plan = plan_language_data(&value);
        assert!(plan.pending.voice > 0);
        assert_eq!(plan.pending.explanation_voice, 0);
        assert_eq!(plan.pending.storage, plan.pending.transfer);
    }

    #[test]
    fn a_partially_cached_voice_only_prices_the_missing_assets() {
        let mut value = input();
        value.language_id = String::from("en");
        value.voice_id = Some(String::from("supertonic-en-f1"));
        value.required.stt = false;
        let assets = voice_assets("en", value.voice_id.as_deref());
        assert!(
            assets.len() > 1,
            "the fixture voice needs a shared model and a style"
        );

        value.cached_assets = vec![assets[0].url.clone()];
        let plan = plan_language_data(&value);
        let expected: u64 = assets[1..].iter().map(|asset| asset.bytes).sum();
        let expected_transfer: u64 = assets[1..].iter().map(|asset| asset.transfer_bytes).sum();
        assert_eq!(plan.pending.voice as u64, expected);
        assert_eq!(plan.pending.transfer as u64, expected_transfer);
        assert!(!plan.ready);
    }

    #[test]
    fn an_installed_target_voice_still_shares_its_assets_with_the_explanation() {
        let mut value = input();
        value.language_id = String::from("en");
        value.instruction_language_id = String::from("fr");
        value.voice_id = Some(String::from("supertonic-en-f1"));
        value.explanation_voice_id = Some(String::from("supertonic-fr-f1"));
        value.required.explanation_voice = true;
        value.installed.voice = true;

        let plan = plan_language_data(&value);
        assert_eq!(plan.pending.voice, 0);
        assert_eq!(plan.pending.explanation_voice, 0);
    }

    #[test]
    fn a_compressed_asset_makes_transfer_smaller_than_storage() {
        let mut value = input();
        value.language_id = String::from("ja");
        value.instruction_language_id = String::from("en");
        value.voice_id = None;
        value.required.explanation_voice = false;

        let plan = plan_language_data(&value);
        assert!(plan.pending.voice > 0);
        assert!(plan.pending.transfer < plan.pending.storage);
    }

    #[test]
    fn an_unrequired_part_is_never_counted_or_missing() {
        let mut value = input();
        value.required = LanguageParts {
            stt: false,
            voice: false,
            explanation_voice: false,
        };
        value.installed = LanguageParts {
            stt: false,
            voice: false,
            explanation_voice: false,
        };
        let plan = plan_language_data(&value);
        assert_eq!(plan.pending.storage, 0);
        assert!(plan.installed.stt && plan.installed.voice && plan.installed.explanation_voice);
        assert!(plan.ready);
    }
}
