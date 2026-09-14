/**
 * Canonical schema for both runtimes.
 *
 * Written to be valid on plain SQLite as shipped by both
 * `@tauri-apps/plugin-sql` and `@sqlite.org/sqlite-wasm`. Migrations are
 * append-only: bump `SCHEMA_VERSION` and add a new entry to `MIGRATIONS`.
 */

export const SCHEMA_VERSION = 5;

export const MIGRATIONS: Record<number, string> = {
	1: `
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
	`,

	// The LLM returns a fluent spoken rewrite and a coaching summary in
	// addition to the corrected text; persist them on the attempt.
	2: `
		ALTER TABLE attempts ADD COLUMN natural_speech TEXT;
		ALTER TABLE attempts ADD COLUMN summary TEXT;
	`,

	// English translation of what the learner said, for the translation toggle.
	3: `
		ALTER TABLE attempts ADD COLUMN translation TEXT;
	`,

	// Three translation variants per attempt (JSON), the voice last used for its
	// TTS, and a translation of each correction's suggested replacement.
	4: `
		ALTER TABLE attempts ADD COLUMN translations TEXT;
		ALTER TABLE attempts ADD COLUMN tts_voice TEXT;
		ALTER TABLE corrections ADD COLUMN replacement_translation TEXT;
	`,

	// Character offsets of each correction's `original` in the transcript, so the
	// transcript renders by position instead of searching for the substring.
	5: `
		ALTER TABLE corrections ADD COLUMN start_index INTEGER;
		ALTER TABLE corrections ADD COLUMN end_index INTEGER;
	`
};
