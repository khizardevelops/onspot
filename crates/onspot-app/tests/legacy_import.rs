// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::Arc;

use futures::executor::block_on;
use onspot_adapter_repo_sql::{
    migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore, SqlSettingsStore,
};
use onspot_app::{import_legacy_json, LegacyImportError};
use onspot_ports::{HistoryStore, RecordsStore, SettingsStore};

fn database() -> (
    Arc<RusqliteDriver>,
    Arc<SqlHistoryStore>,
    Arc<SqlRecordsStore>,
    Arc<SqlSettingsStore>,
) {
    let driver = Arc::new(RusqliteDriver::open_in_memory().expect("database"));
    block_on(migrate(driver.as_ref())).expect("migrate");
    (
        driver.clone(),
        Arc::new(SqlHistoryStore::new(driver.clone())),
        Arc::new(SqlRecordsStore::new(driver.clone())),
        Arc::new(SqlSettingsStore::new(driver)),
    )
}

const BACKUP: &str = r#"{
  "app": "onspot",
  "format": 1,
  "sessions": [
    {
      "id": "s-old",
      "title": "Old morning",
      "mode": "casual",
      "startedAt": "2026-01-01T08:00:00.000Z",
      "createdAt": "2026-01-01T08:00:00.000Z",
      "updatedAt": "2026-01-01T08:00:00.000Z",
      "setup": {
        "targetLanguage": "fr",
        "instructionLanguage": "en",
        "ttsMode": "local",
        "ttsVoice": "piper-tom-medium",
        "explanationVoice": "piper-en-amy",
        "targetSpeechPace": 0.9
      }
    }
  ],
  "prompts": [
    { "id": "p-old", "title": "Le matin", "text": "Racontez votre matinée.", "language": "fr" }
  ],
  "attempts": [
    {
      "id": "a-old",
      "sessionId": "s-old",
      "promptId": "p-old",
      "promptText": "Racontez votre matinée.",
      "transcript": "Je bois du café.",
      "summary": "A short morning.",
      "translations": {
        "version": 3,
        "instructionLanguage": "en",
        "idiomatic": "I drink coffee.",
        "idiomaticVariants": ["I drink coffee.", "I am drinking coffee."],
        "literal": "I drink of the coffee.",
        "wordForWord": "I drink of the coffee",
        "wordBreakdown": [{ "source": "café", "target": "coffee" }]
      },
      "durationSec": 4.5,
      "wordCount": 4,
      "audioKey": "attempt:a-old",
      "createdAt": "2026-01-01T08:01:00.000Z",
      "updatedAt": "2026-01-01T08:01:00.000Z"
    },
    {
      "id": "a-orphan",
      "sessionId": "missing",
      "transcript": "Dropped."
    }
  ],
  "corrections": [
    {
      "id": "c-old",
      "attemptId": "a-old",
      "category": "grammar",
      "severity": "warning",
      "label": "Article",
      "original": "du café",
      "replacement": "le café",
      "explanation": "Use the definite article.",
      "sortOrder": 1,
      "createdAt": "2026-01-01T08:02:00.000Z"
    },
    { "id": "c-orphan", "attemptId": "a-orphan", "category": "grammar", "severity": "error" }
  ],
  "recordings": [
    { "attemptId": "a-old", "mime": "audio/webm", "dataBase64": "AAAA" },
    { "attemptId": "a-orphan", "dataBase64": "BBBB" }
  ],
  "settings": [
    { "key": "onspot.setting.mode", "value": "casual" },
    { "key": "unrelated", "value": "kept out" }
  ]
}"#;

#[test]
fn a_legacy_backup_merges_sessions_attempts_corrections_and_recordings() {
    let (_driver, history, records, settings) = database();
    block_on(async {
        let result = import_legacy_json(
            BACKUP,
            history.as_ref(),
            records.as_ref(),
            Some(settings.as_ref()),
            "2026-11-15T00:00:00.000Z",
        )
        .await
        .expect("import");
        assert_eq!(result.sessions, 1);
        assert_eq!(result.attempts, 1);
        assert_eq!(result.corrections, 1);
        assert_eq!(result.recordings, 1);
        assert_eq!(result.settings, 1);

        let session = records
            .get_session("s-old")
            .await
            .expect("session")
            .expect("row");
        assert_eq!(session.setup.as_ref().expect("setup").target_language, "fr");
        assert_eq!(session.mode, "casual");

        let attempt = records
            .get_attempt("a-old")
            .await
            .expect("attempt")
            .expect("row");
        assert_eq!(attempt.explanation.as_deref(), Some("A short morning."));
        assert_eq!(
            attempt
                .translations
                .as_ref()
                .expect("translations")
                .idiomatic,
            "I drink coffee."
        );
        assert_eq!(
            attempt
                .translations
                .as_ref()
                .expect("translations")
                .idiomatic_variants
                .len(),
            1
        );
        assert!(records
            .get_attempt("a-orphan")
            .await
            .expect("orphan")
            .is_none());

        let corrections = records
            .list_corrections("a-old")
            .await
            .expect("corrections");
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].replacement, "le café");
        assert_eq!(
            records
                .list_corrections("a-orphan")
                .await
                .expect("orphan")
                .len(),
            0
        );

        assert!(records
            .get_audio("attempt:a-old")
            .await
            .expect("audio")
            .is_some());
        assert!(records
            .get_audio("attempt:a-orphan")
            .await
            .expect("audio")
            .is_none());
        assert_eq!(
            settings
                .get("onspot.setting.mode")
                .await
                .expect("setting")
                .as_deref(),
            Some("casual")
        );
        assert_eq!(settings.get("unrelated").await.expect("setting"), None);
    });
}

#[test]
fn a_foreign_or_unreadable_backup_is_refused_before_writing() {
    let (_driver, history, records, settings) = database();
    block_on(async {
        assert_eq!(
            import_legacy_json(
                "not json",
                history.as_ref(),
                records.as_ref(),
                Some(settings.as_ref()),
                "now"
            )
            .await,
            Err(LegacyImportError::NotJson)
        );
        assert_eq!(
            import_legacy_json(
                r#"{"app":"other","format":1}"#,
                history.as_ref(),
                records.as_ref(),
                Some(settings.as_ref()),
                "now"
            )
            .await,
            Err(LegacyImportError::WrongFormat)
        );
        assert_eq!(history.list_sessions().await.expect("sessions").len(), 0);
    });
}
