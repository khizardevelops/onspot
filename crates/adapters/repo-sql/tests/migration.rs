// SPDX-License-Identifier: AGPL-3.0-or-later

//! P2 data-compatibility tests.
//!
//! The fixture is a synthetic schema-9 database (the v0.2.4 generation). It
//! must open, migrate to schema 12, keep every row, and pass SQLite's own
//! integrity and foreign-key checks.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use futures::executor::block_on;
use onspot_adapter_repo_sql::{
    migrate, RusqliteDriver, SqlHistoryStore, SqlSettingsStore, SCHEMA_VERSION,
};
use onspot_ports::{HistoryStore, SettingsStore, SqlDriver, SqlValue};

include!("fixtures/ensure.rs");

static NEXT_FIXTURE: AtomicU32 = AtomicU32::new(0);

fn fixture_copy() -> PathBuf {
    let source = ensure_v024_fixture();
    let directory = std::env::temp_dir().join(format!("onspot-repo-sql-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("temp directory");
    let destination = directory.join(format!(
        "onspot-{}.sqlite",
        NEXT_FIXTURE.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::copy(source, &destination).expect("fixture copy");
    destination
}

async fn scalar(driver: &dyn SqlDriver, sql: &str) -> Result<i64, String> {
    let rows = driver
        .select(sql, &[])
        .await
        .map_err(|error| error.message)?;
    rows.first()
        .and_then(|row| row.values().next())
        .and_then(SqlValue::as_i64)
        .ok_or_else(|| format!("no scalar for `{sql}`"))
}

async fn column_names(driver: &dyn SqlDriver, table: &str) -> Vec<String> {
    driver
        .select(&format!("PRAGMA table_info({table})"), &[])
        .await
        .expect("table info")
        .iter()
        .filter_map(|row| {
            row.get("name")
                .and_then(SqlValue::as_str)
                .map(str::to_owned)
        })
        .collect()
}

#[test]
fn a_fresh_database_reaches_the_current_schema() {
    block_on(async {
        let driver = RusqliteDriver::open_in_memory().expect("open");
        migrate(&driver).await.expect("migrate");

        let version = scalar(
            &driver,
            "SELECT MAX(version) AS version FROM schema_migrations",
        )
        .await
        .expect("version");
        assert_eq!(version, SCHEMA_VERSION);

        let attempts = column_names(&driver, "attempts").await;
        for column in ["explanation", "follow_up", "word_glosses", "translations"] {
            assert!(attempts.contains(&column.to_owned()), "attempts.{column}");
        }
        let prompts = column_names(&driver, "prompts").await;
        assert!(prompts.contains(&"instruction_language".to_owned()));
        let sessions = column_names(&driver, "sessions").await;
        assert!(sessions.contains(&"setup".to_owned()));

        let submissions = scalar(
            &driver,
            "SELECT COUNT(*) AS count FROM sqlite_master \
             WHERE type = 'table' AND name = 'prompt_submissions'",
        )
        .await
        .expect("prompt_submissions");
        assert_eq!(submissions, 1);

        // Running init again must not replay a migration.
        migrate(&driver).await.expect("second migrate is a no-op");
        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM schema_migrations")
                .await
                .expect("rows"),
            SCHEMA_VERSION
        );
    });
}

#[test]
fn the_v024_fixture_migrates_without_losing_rows() {
    block_on(async {
        let path = fixture_copy();
        let driver = RusqliteDriver::open(&path).expect("open fixture");

        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM sessions")
                .await
                .expect("sessions"),
            2
        );
        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM attempts")
                .await
                .expect("attempts"),
            3
        );

        migrate(&driver).await.expect("migrate fixture");

        assert_eq!(
            scalar(
                &driver,
                "SELECT MAX(version) AS version FROM schema_migrations"
            )
            .await
            .expect("version"),
            SCHEMA_VERSION
        );
        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM sessions")
                .await
                .expect("sessions after"),
            2
        );
        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM attempts")
                .await
                .expect("attempts after"),
            3
        );
        assert_eq!(
            scalar(&driver, "SELECT COUNT(*) AS count FROM corrections")
                .await
                .expect("corrections"),
            1
        );

        // The pre-10 session still has no setup, exactly as stored.
        assert_eq!(
            scalar(
                &driver,
                "SELECT COUNT(*) AS count FROM sessions WHERE setup IS NULL"
            )
            .await
            .expect("null setups"),
            2
        );

        // The migrated chain is readable through the history repository.
        let history = SqlHistoryStore::new(Arc::new(driver) as Arc<dyn SqlDriver>);
        let sessions = history.list_sessions().await.expect("list");
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].title, "Le marché du samedi");
        let previews = history.list_attempt_previews().await.expect("previews");
        assert_eq!(previews.len(), 3);
        assert!(previews
            .iter()
            .any(|preview| preview.transcript.contains("marché")));

        std::fs::remove_file(path).ok();
    });
}

#[test]
fn the_migrated_fixture_passes_sqlite_integrity_checks() {
    block_on(async {
        let path = fixture_copy();
        let driver = RusqliteDriver::open(&path).expect("open fixture");
        migrate(&driver).await.expect("migrate");

        let integrity = driver
            .select("PRAGMA integrity_check", &[])
            .await
            .expect("integrity");
        assert_eq!(
            integrity[0]
                .values()
                .next()
                .and_then(SqlValue::as_str)
                .expect("integrity text"),
            "ok"
        );

        let violations = driver
            .select("PRAGMA foreign_key_check", &[])
            .await
            .expect("foreign keys");
        assert!(
            violations.is_empty(),
            "foreign-key violations: {violations:?}"
        );

        std::fs::remove_file(path).ok();
    });
}

#[test]
fn settings_and_history_repositories_round_trip() {
    block_on(async {
        let driver = Arc::new(RusqliteDriver::open_in_memory().expect("open"));
        migrate(driver.as_ref()).await.expect("migrate");
        let settings = SqlSettingsStore::new(driver.clone() as Arc<dyn SqlDriver>);
        let history = SqlHistoryStore::new(driver.clone() as Arc<dyn SqlDriver>);

        assert_eq!(
            settings.get("onspot.setting.level").await.expect("get"),
            None
        );
        settings
            .set("onspot.setting.level", "\"B1\"")
            .await
            .expect("set");
        settings
            .set("onspot.setting.mode", "\"exam\"")
            .await
            .expect("set");
        assert_eq!(
            settings.get("onspot.setting.level").await.expect("get"),
            Some(String::from("\"B1\""))
        );
        let rows = settings.list().await.expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].key, "onspot.setting.level");
        assert!(!rows[0].updated_at.is_empty());

        driver
            .execute(
                "INSERT INTO sessions
                 (id, title, mode, started_at, ended_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                &[
                    "s-1".into(),
                    "Bonjour".into(),
                    "exam".into(),
                    "2026-10-01T09:00:00.000Z".into(),
                    SqlValue::Null,
                    "2026-10-01T09:00:00.000Z".into(),
                    "2026-10-01T09:00:00.000Z".into(),
                ],
            )
            .await
            .expect("insert session");
        driver
            .execute(
                "INSERT INTO attempts
                 (id, session_id, prompt_text, transcript, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
                &[
                    "a-1".into(),
                    "s-1".into(),
                    "Parlez.".into(),
                    "Bonjour, je m'appelle Ana.".into(),
                    "2026-10-01T09:01:00.000Z".into(),
                    "2026-10-01T09:01:00.000Z".into(),
                ],
            )
            .await
            .expect("insert attempt");

        let sessions = history.list_sessions().await.expect("sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].setup, None);

        assert!(history
            .rename_session("s-1", "Salut")
            .await
            .expect("rename"));
        let sessions = history.list_sessions().await.expect("sessions");
        assert_eq!(sessions[0].title, "Salut");
        assert!(!history
            .rename_session("missing", "X")
            .await
            .expect("rename"));

        assert!(history.delete_session("s-1").await.expect("delete"));
        assert!(!history.delete_session("s-1").await.expect("delete again"));
        assert_eq!(
            scalar(driver.as_ref(), "SELECT COUNT(*) AS count FROM attempts")
                .await
                .expect("cascade"),
            0
        );
    });
}
