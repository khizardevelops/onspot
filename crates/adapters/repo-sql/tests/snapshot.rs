// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whole-database snapshot tests: a release export restores into the core, and
//! a core export restores into a fresh database without losing rows.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures::executor::block_on;
use onspot_adapter_repo_sql::{migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore};
use onspot_domain::{
    Attempt, FollowUp, Session, SessionSetup, TranslationBreakdownItem, TranslationSet,
};
use onspot_ports::{DatabaseFile, HistoryStore, RecordsStore, SqlDriver, SqlValue};

include!("fixtures/ensure.rs");

static NEXT_FIXTURE: AtomicU32 = AtomicU32::new(0);

fn fixture_copy() -> std::path::PathBuf {
    let source = ensure_v024_fixture();
    let directory =
        std::env::temp_dir().join(format!("onspot-repo-snapshot-{}", std::process::id()));
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
            idiomatic_variants: Vec::new(),
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
        word_glosses: Some(BTreeMap::new()),
        duration_sec: 4.5,
        word_count: 2,
        audio_key: None,
        created_at: "2026-01-02T03:05:00.000Z".to_owned(),
        updated_at: "2026-01-02T03:05:00.000Z".to_owned(),
    }
}

async fn scalar(driver: &dyn SqlDriver, sql: &str) -> i64 {
    driver
        .select(sql, &[])
        .await
        .expect("scalar query")
        .first()
        .and_then(|row| row.values().next())
        .and_then(SqlValue::as_i64)
        .unwrap_or_default()
}

#[test]
fn an_export_restores_every_row_into_a_fresh_database() {
    block_on(async {
        let source = Arc::new(RusqliteDriver::open_in_memory().expect("source"));
        migrate(source.as_ref()).await.expect("migrate source");
        let records = SqlRecordsStore::new(source.clone() as Arc<dyn SqlDriver>);
        records
            .put_session(&session("s-1", "Kept session"))
            .await
            .expect("put session");
        records
            .put_attempt(&attempt("a-1", "s-1"))
            .await
            .expect("put attempt");

        let bytes = source.export_bytes().await.expect("export");
        assert!(bytes.starts_with(b"SQLite format 3\0"));

        let destination = Arc::new(RusqliteDriver::open_in_memory().expect("destination"));
        migrate(destination.as_ref())
            .await
            .expect("migrate destination");
        let destination_records = SqlRecordsStore::new(destination.clone() as Arc<dyn SqlDriver>);
        destination_records
            .put_session(&session("old", "Old session"))
            .await
            .expect("put old session");

        let counts = destination.import_bytes(&bytes).await.expect("import");

        assert_eq!(counts.sessions, 1);
        assert_eq!(counts.attempts, 1);
        let history = SqlHistoryStore::new(destination.clone() as Arc<dyn SqlDriver>);
        let sessions = history.list_sessions().await.expect("list");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Kept session");
        let version = scalar(
            destination.as_ref(),
            "SELECT MAX(version) AS version FROM schema_migrations",
        )
        .await;
        assert_eq!(version, 12);
    });
}

#[test]
fn a_release_schema_9_export_restores_in_the_core() {
    block_on(async {
        let fixture = fixture_copy();
        let bytes = std::fs::read(&fixture).expect("fixture bytes");
        let driver = RusqliteDriver::open_in_memory().expect("open");

        let counts = driver
            .import_bytes(&bytes)
            .await
            .expect("import release backup");

        assert_eq!(counts.sessions, 2);
        assert_eq!(counts.attempts, 3);
        let version = scalar(
            &driver,
            "SELECT MAX(version) AS version FROM schema_migrations",
        )
        .await;
        assert_eq!(version, 12);
        let sessions = driver
            .select("SELECT COUNT(*) AS total FROM sessions", &[])
            .await
            .expect("count sessions");
        assert_eq!(sessions[0].get("total").and_then(SqlValue::as_i64), Some(2));
    });
}

#[test]
fn a_core_export_restores_into_another_core_database() {
    block_on(async {
        let first = Arc::new(RusqliteDriver::open_in_memory().expect("first"));
        migrate(first.as_ref()).await.expect("migrate first");
        SqlRecordsStore::new(first.clone() as Arc<dyn SqlDriver>)
            .put_session(&session("s-1", "Round trip"))
            .await
            .expect("put session");
        let first_bytes = first.export_bytes().await.expect("export");

        let second = RusqliteDriver::open_in_memory().expect("second");
        let counts = second.import_bytes(&first_bytes).await.expect("import");
        let second_bytes = second.export_bytes().await.expect("re-export");

        assert_eq!(counts.sessions, 1);
        assert!(second_bytes.starts_with(b"SQLite format 3\0"));

        let third = RusqliteDriver::open_in_memory().expect("third");
        let third_counts = third.import_bytes(&second_bytes).await.expect("re-import");
        assert_eq!(third_counts.sessions, 1);
    });
}
