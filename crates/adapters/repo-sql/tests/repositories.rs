// SPDX-License-Identifier: AGPL-3.0-or-later

//! Round-trip tests for the typed repositories ported in P2, plus reads from
//! the v0.2.4 fixture. They prove the Rust store returns what the legacy
//! adapter wrote, including the tolerant JSON columns.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures::executor::block_on;
use onspot_adapter_repo_sql::{migrate, RusqliteDriver, SqlRecordsStore};
use onspot_domain::{
    Attempt, AudioAsset, Correction, FollowUp, GlossedRange, PhraseGloss, Prompt, PromptSubmission,
    Session, SessionSetup, SyncMetadata, TextGlosses, TranslationBreakdownItem, TranslationSet,
};
use onspot_ports::RecordsStore;

static NEXT_FIXTURE: AtomicU32 = AtomicU32::new(0);

fn fixture_copy() -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/onspot-v0.2.4.sqlite");
    let directory =
        std::env::temp_dir().join(format!("onspot-repo-records-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("temp directory");
    let destination = directory.join(format!(
        "onspot-{}.sqlite",
        NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::copy(source, &destination).expect("fixture copy");
    destination
}

fn session(id: &str, title: &str) -> Session {
    Session {
        id: id.to_owned(),
        title: title.to_owned(),
        mode: "casual".to_owned(),
        started_at: "2026-01-02T03:04:05.000Z".to_owned(),
        ended_at: None,
        created_at: "2026-01-02T03:04:05.000Z".to_owned(),
        updated_at: "2026-01-02T03:04:05.000Z".to_owned(),
        setup: Some(SessionSetup {
            target_language: "es".to_owned(),
            instruction_language: "en".to_owned(),
            tts_mode: "local".to_owned(),
            tts_voice: "voice-a".to_owned(),
            explanation_voice: "voice-b".to_owned(),
            target_speech_pace: 0.9,
        }),
    }
}

fn attempt(id: &str, session_id: &str) -> Attempt {
    Attempt {
        id: id.to_owned(),
        session_id: session_id.to_owned(),
        prompt_id: Some("prompt-1".to_owned()),
        prompt_text: "Hola".to_owned(),
        transcript: "Hola, mundo".to_owned(),
        corrected_text: Some("Hola, mundo.".to_owned()),
        translation: Some("Hello, world".to_owned()),
        translations: Some(TranslationSet {
            version: Some(3),
            instruction_language: Some("en".to_owned()),
            idiomatic: "Hello, world".to_owned(),
            idiomatic_variants: vec!["Hi, world".to_owned()],
            literal: "Hello, world".to_owned(),
            word_for_word: "Hello world".to_owned(),
            word_breakdown: vec![TranslationBreakdownItem {
                source: "Hola".to_owned(),
                target: "Hello".to_owned(),
            }],
        }),
        tts_voice: Some("voice-a".to_owned()),
        explanation: Some("A greeting.".to_owned()),
        follow_up: Some(FollowUp {
            question: "¿Cómo estás?".to_owned(),
            translation: "How are you?".to_owned(),
        }),
        word_glosses: Some(BTreeMap::from([(
            "text-hash".to_owned(),
            TextGlosses {
                words: vec!["hello".to_owned(), "world".to_owned()],
                phrases: vec![PhraseGloss {
                    start: 0,
                    end: 1,
                    meaning: "greeting".to_owned(),
                    origin: "expression".to_owned(),
                }],
                pos: Some(vec!["interjection".to_owned(), "noun".to_owned()]),
                pos_sections: Some(vec![GlossedRange { start: 0, end: 1 }]),
                sections: Some(vec![GlossedRange { start: 0, end: 1 }]),
            },
        )])),
        duration_sec: 4.5,
        word_count: 2,
        audio_key: Some("audio-1".to_owned()),
        created_at: "2026-01-02T03:05:00.000Z".to_owned(),
        updated_at: "2026-01-02T03:05:00.000Z".to_owned(),
    }
}

fn correction(id: &str, attempt_id: &str) -> Correction {
    Correction {
        id: id.to_owned(),
        attempt_id: attempt_id.to_owned(),
        category: "grammar".to_owned(),
        severity: "warning".to_owned(),
        label: "Article".to_owned(),
        original: "mundo".to_owned(),
        replacement: "el mundo".to_owned(),
        replacement_translation: Some("the world".to_owned()),
        start: Some(6),
        end: Some(11),
        explanation: "Needs an article.".to_owned(),
        speak_text: Some("el mundo".to_owned()),
        exam_status: Some("avoid".to_owned()),
        formal_alternatives: vec!["el mundo".to_owned()],
        sort_order: 1,
        created_at: "2026-01-02T03:05:00.000Z".to_owned(),
    }
}

#[test]
fn every_record_round_trips() {
    block_on(async {
        let driver: Arc<dyn onspot_ports::SqlDriver> =
            Arc::new(RusqliteDriver::open_in_memory().expect("open"));
        migrate(&*driver).await.expect("migrate");
        let store = SqlRecordsStore::new(driver);

        let prompt = Prompt {
            id: "prompt-1".to_owned(),
            title: "Greeting".to_owned(),
            text: "Hola".to_owned(),
            category: Some("basics".to_owned()),
            language: Some("es".to_owned()),
            instruction_language: "en".to_owned(),
            created_at: "2026-01-02T03:00:00.000Z".to_owned(),
        };
        store.put_prompt(&prompt).await.expect("put prompt");
        assert_eq!(
            store.get_prompt("prompt-1").await.expect("get prompt"),
            Some(prompt.clone())
        );
        assert_eq!(
            store
                .list_prompts(Some("es"), Some("en"))
                .await
                .expect("list prompts"),
            vec![prompt.clone()]
        );
        assert!(store
            .list_prompts(Some("fr"), None)
            .await
            .expect("empty prompts")
            .is_empty());

        let session = session("s-1", "Morning");
        store.put_session(&session).await.expect("put session");
        assert_eq!(
            store.get_session("s-1").await.expect("get session"),
            Some(session)
        );

        let attempt = attempt("attempt-1", "s-1");
        store.put_attempt(&attempt).await.expect("put attempt");
        assert_eq!(
            store.get_attempt("attempt-1").await.expect("get attempt"),
            Some(attempt.clone())
        );
        assert_eq!(
            store.list_attempts("s-1").await.expect("list attempts"),
            vec![attempt.clone()]
        );
        assert_eq!(
            store.list_all_attempts().await.expect("list all"),
            vec![attempt.clone()]
        );

        let mut glosses = attempt.word_glosses.clone().expect("glosses");
        glosses.insert(
            "second".to_owned(),
            TextGlosses {
                words: vec!["hola".to_owned()],
                phrases: Vec::new(),
                pos: None,
                pos_sections: None,
                sections: None,
            },
        );
        assert!(store
            .set_word_glosses("attempt-1", &glosses)
            .await
            .expect("set glosses"));
        assert_eq!(
            store
                .get_word_glosses("attempt-1")
                .await
                .expect("get glosses"),
            Some(glosses.clone())
        );
        assert!(!store
            .set_word_glosses("missing", &glosses)
            .await
            .expect("missing glosses"));

        let translations = attempt.translations.clone().expect("translations");
        assert!(store
            .set_translations("attempt-1", &translations)
            .await
            .expect("set translations"));
        assert_eq!(
            store
                .get_translations("attempt-1")
                .await
                .expect("get translations"),
            Some(translations)
        );

        let corrections = vec![
            correction("correction-1", "attempt-1"),
            correction("correction-2", "attempt-1"),
        ];
        store
            .replace_corrections("attempt-1", &corrections)
            .await
            .expect("replace corrections");
        assert_eq!(
            store
                .list_corrections("attempt-1")
                .await
                .expect("list corrections"),
            corrections
        );
        assert_eq!(
            store.list_all_corrections().await.expect("list all"),
            corrections
        );

        let audio = AudioAsset {
            key: "audio-1".to_owned(),
            attempt_id: Some("attempt-1".to_owned()),
            mime: "audio/webm".to_owned(),
            data_base64: "AAAA".to_owned(),
            created_at: "2026-01-02T03:05:00.000Z".to_owned(),
        };
        store.put_audio(&audio).await.expect("put audio");
        assert_eq!(
            store.get_audio("audio-1").await.expect("get audio"),
            Some(audio)
        );

        let submission = PromptSubmission {
            id: "submission-1".to_owned(),
            title: "Greeting".to_owned(),
            text: "Hola".to_owned(),
            instruction_language: "en".to_owned(),
            target_language: "es".to_owned(),
            level: "a1".to_owned(),
            mode: "casual".to_owned(),
            created_at: "2026-01-02T03:00:00.000Z".to_owned(),
            attempts: 0,
            last_attempt_at: None,
            last_error: None,
        };
        store
            .put_prompt_submission(&submission)
            .await
            .expect("put submission");
        // A second queue must not overwrite the first row's backoff.
        store
            .put_prompt_submission(&PromptSubmission {
                title: "Changed".to_owned(),
                ..submission.clone()
            })
            .await
            .expect("put submission again");
        assert_eq!(
            store
                .list_prompt_submissions()
                .await
                .expect("list submissions"),
            vec![submission]
        );
        assert!(store
            .mark_prompt_submission_failed("submission-1", "offline", "2026-01-02T04:00:00.000Z")
            .await
            .expect("mark failed"));
        let failed = store
            .list_prompt_submissions()
            .await
            .expect("list failed")
            .remove(0);
        assert_eq!(failed.attempts, 1);
        assert_eq!(failed.last_error.as_deref(), Some("offline"));

        let sync = SyncMetadata {
            provider: "drive".to_owned(),
            remote_file_id: Some("file-1".to_owned()),
            etag: Some("etag-1".to_owned()),
            last_synced_at: Some("2026-01-02T04:00:00.000Z".to_owned()),
            cursor: Some("cursor-1".to_owned()),
            updated_at: "2026-01-02T04:00:00.000Z".to_owned(),
        };
        store.set_sync_metadata(&sync).await.expect("set sync");
        assert_eq!(
            store.get_sync_metadata("drive").await.expect("get sync"),
            Some(sync)
        );

        assert!(store.delete_audio("audio-1").await.expect("delete audio"));
        assert!(!store.delete_audio("audio-1").await.expect("again"));
        assert_eq!(
            store
                .delete_attempt_audio("attempt-1")
                .await
                .expect("delete attempt audio"),
            0
        );
        assert!(store
            .delete_prompt_submission("submission-1")
            .await
            .expect("delete submission"));
        assert!(store
            .delete_prompt("prompt-1")
            .await
            .expect("delete prompt"));
        assert!(store
            .delete_attempt("attempt-1")
            .await
            .expect("delete attempt"));
        assert!(!store
            .delete_attempt("attempt-1")
            .await
            .expect("delete again"));
    });
}

#[test]
fn the_fixture_reads_through_the_full_repositories() {
    block_on(async {
        let path = fixture_copy();
        let driver: Arc<dyn onspot_ports::SqlDriver> =
            Arc::new(RusqliteDriver::open(&path).expect("open fixture"));
        migrate(&*driver).await.expect("migrate fixture");
        let store = SqlRecordsStore::new(driver);

        assert_eq!(store.list_all_attempts().await.expect("attempts").len(), 3);
        assert_eq!(
            store
                .list_all_corrections()
                .await
                .expect("corrections")
                .len(),
            1
        );
        assert_eq!(
            store
                .list_attempts("s-1")
                .await
                .expect("session attempts")
                .len(),
            2
        );
    });
}
