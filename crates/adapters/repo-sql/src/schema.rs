// SPDX-License-Identifier: AGPL-3.0-or-later

//! The canonical schema and the append-only migration chain, copied verbatim
//! from `src/lib/adapters/db/schema.ts` (P2, invariant I3).
//!
//! Same table names, columns, indexes, order and defaults. Do not "improve" a
//! type or a default here: a database written by v0.2.4 must open and migrate
//! unmodified. The comments are the legacy file's comments, kept so the intent
//! of each migration survives the port.

/// The schema version a fresh or migrated database reaches.
pub const SCHEMA_VERSION: i64 = 12;

/// The ordered migration chain: `(version, SQL)`.
///
/// Each version's statements are applied together with its `schema_migrations`
/// row (see [`crate::migrate`]).
pub const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        r#"
		CREATE TABLE IF NOT EXISTS prompts (
			id          TEXT PRIMARY KEY,
			title       TEXT NOT NULL,
			text        TEXT NOT NULL,
			category    TEXT,
			created_at  TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS sessions (
			id          TEXT PRIMARY KEY,
			title       TEXT NOT NULL,
			mode        TEXT NOT NULL DEFAULT 'exam',
			started_at  TEXT NOT NULL,
			ended_at    TEXT,
			created_at  TEXT NOT NULL,
			updated_at  TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS attempts (
			id              TEXT PRIMARY KEY,
			session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			prompt_id       TEXT,
			prompt_text     TEXT NOT NULL,
			transcript      TEXT NOT NULL DEFAULT '',
			corrected_text  TEXT,
			duration_sec    REAL NOT NULL DEFAULT 0,
			word_count      INTEGER NOT NULL DEFAULT 0,
			audio_key       TEXT,
			created_at      TEXT NOT NULL,
			updated_at      TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS corrections (
			id                   TEXT PRIMARY KEY,
			attempt_id           TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
			category             TEXT NOT NULL,
			severity             TEXT NOT NULL,
			label                TEXT NOT NULL,
			original             TEXT NOT NULL,
			replacement          TEXT NOT NULL,
			explanation          TEXT NOT NULL,
			speak_text           TEXT,
			exam_status          TEXT,
			formal_alternatives  TEXT,
			sort_order           INTEGER NOT NULL DEFAULT 0,
			created_at           TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS audio_assets (
			key          TEXT PRIMARY KEY,
			attempt_id   TEXT,
			mime         TEXT NOT NULL,
			data_base64  TEXT NOT NULL,
			created_at   TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS settings (
			key         TEXT PRIMARY KEY,
			value       TEXT NOT NULL,
			updated_at  TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS sync_metadata (
			provider        TEXT PRIMARY KEY,
			remote_file_id  TEXT,
			etag            TEXT,
			last_synced_at  TEXT,
			cursor          TEXT,
			updated_at      TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_attempts_session    ON attempts(session_id);
		CREATE INDEX IF NOT EXISTS idx_corrections_attempt ON corrections(attempt_id);
		CREATE INDEX IF NOT EXISTS idx_sync_provider       ON sync_metadata(provider);
	"#,
    ),
    (
        2,
        r#"
		ALTER TABLE attempts ADD COLUMN natural_speech TEXT;
		ALTER TABLE attempts ADD COLUMN summary TEXT;
	"#,
    ),
    (
        3,
        r#"
		ALTER TABLE attempts ADD COLUMN translation TEXT;
	"#,
    ),
    (
        4,
        r#"
		ALTER TABLE attempts ADD COLUMN translations TEXT;
		ALTER TABLE attempts ADD COLUMN tts_voice TEXT;
		ALTER TABLE corrections ADD COLUMN replacement_translation TEXT;
	"#,
    ),
    (
        5,
        r#"
		ALTER TABLE corrections ADD COLUMN start_index INTEGER;
		ALTER TABLE corrections ADD COLUMN end_index INTEGER;
	"#,
    ),
    (
        6,
        r#"
		ALTER TABLE prompts ADD COLUMN language TEXT;
		UPDATE prompts SET language = 'fr' WHERE language IS NULL;
	"#,
    ),
    (
        7,
        r#"
		ALTER TABLE attempts ADD COLUMN explanation TEXT;
		UPDATE attempts SET explanation = summary WHERE explanation IS NULL;
	"#,
    ),
    (
        8,
        r#"
		ALTER TABLE attempts ADD COLUMN follow_up TEXT;
	"#,
    ),
    (
        9,
        r#"
		ALTER TABLE attempts ADD COLUMN word_glosses TEXT;
	"#,
    ),
    (
        10,
        r#"
		ALTER TABLE sessions ADD COLUMN setup TEXT;
	"#,
    ),
    (
        11,
        r#"
		ALTER TABLE prompts ADD COLUMN instruction_language TEXT NOT NULL DEFAULT 'en';
	"#,
    ),
    (
        12,
        r#"
		CREATE TABLE IF NOT EXISTS prompt_submissions (
			id                    TEXT PRIMARY KEY,
			title                 TEXT NOT NULL,
			text                  TEXT NOT NULL,
			instruction_language  TEXT NOT NULL,
			target_language       TEXT NOT NULL,
			level                 TEXT NOT NULL,
			mode                  TEXT NOT NULL,
			created_at            TEXT NOT NULL,
			attempts              INTEGER NOT NULL DEFAULT 0,
			last_attempt_at       TEXT,
			last_error            TEXT
		);
	"#,
    ),
];

/// The SQL for one version, if the chain defines it.
pub fn migration(version: i64) -> Option<&'static str> {
    MIGRATIONS
        .iter()
        .find(|(candidate, _)| *candidate == version)
        .map(|(_, sql)| *sql)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chain_is_contiguous_and_ends_at_the_version() {
        let versions: Vec<i64> = MIGRATIONS.iter().map(|(version, _)| *version).collect();
        let expected: Vec<i64> = (1..=SCHEMA_VERSION).collect();
        assert_eq!(versions, expected);
    }

    #[test]
    fn migration_twelve_is_the_prompt_submission_queue() {
        let sql = migration(12).expect("migration 12 exists");
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS prompt_submissions"));
        assert!(sql.contains("last_error"));
    }
}
