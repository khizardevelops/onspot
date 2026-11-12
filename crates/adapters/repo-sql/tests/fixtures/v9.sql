-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Synthetic v0.2.4 database at schema 9, used to prove invariant I3: a file
-- written by the shipping app opens, migrates to schema 12 and keeps its rows.
-- This script is the fixture's source; regenerate the .sqlite with:
--
--   rm -f onspot-v0.2.4.sqlite
--   sqlite3 onspot-v0.2.4.sqlite < v9.sql
--
-- The DDL is migrations 1-9 verbatim, followed by synthetic rows covering a
-- prompt, two sessions, three takes, a correction, an audio asset, settings
-- and sync metadata. All content is invented.

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO schema_migrations (version, applied_at) VALUES
	(1, '2026-09-01T10:00:00.000Z'),
	(2, '2026-09-01T10:00:00.000Z'),
	(3, '2026-09-01T10:00:00.000Z'),
	(4, '2026-09-01T10:00:00.000Z'),
	(5, '2026-09-01T10:00:00.000Z'),
	(6, '2026-09-01T10:00:00.000Z'),
	(7, '2026-09-01T10:00:00.000Z'),
	(8, '2026-09-01T10:00:00.000Z'),
	(9, '2026-09-01T10:00:00.000Z');

CREATE TABLE prompts (
	id          TEXT PRIMARY KEY,
	title       TEXT NOT NULL,
	text        TEXT NOT NULL,
	category    TEXT,
	created_at  TEXT NOT NULL,
	language    TEXT
);

CREATE TABLE sessions (
	id          TEXT PRIMARY KEY,
	title       TEXT NOT NULL,
	mode        TEXT NOT NULL DEFAULT 'exam',
	started_at  TEXT NOT NULL,
	ended_at    TEXT,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);

CREATE TABLE attempts (
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
	updated_at      TEXT NOT NULL,
	natural_speech TEXT,
	summary TEXT,
	translation TEXT,
	translations TEXT,
	tts_voice TEXT,
	explanation TEXT,
	follow_up TEXT,
	word_glosses TEXT
);

CREATE TABLE corrections (
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
	created_at           TEXT NOT NULL,
	replacement_translation TEXT,
	start_index INTEGER,
	end_index INTEGER
);

CREATE TABLE audio_assets (
	key          TEXT PRIMARY KEY,
	attempt_id   TEXT,
	mime         TEXT NOT NULL,
	data_base64  TEXT NOT NULL,
	created_at   TEXT NOT NULL
);

CREATE TABLE settings (
	key         TEXT PRIMARY KEY,
	value       TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);

CREATE TABLE sync_metadata (
	provider        TEXT PRIMARY KEY,
	remote_file_id  TEXT,
	etag            TEXT,
	last_synced_at  TEXT,
	cursor          TEXT,
	updated_at      TEXT NOT NULL
);

CREATE INDEX idx_attempts_session    ON attempts(session_id);
CREATE INDEX idx_corrections_attempt ON corrections(attempt_id);
CREATE INDEX idx_sync_provider       ON sync_metadata(provider);

INSERT INTO prompts (id, title, text, category, created_at, language) VALUES
	('p-1', 'Se présenter', 'Présentez-vous en quelques phrases.', 'introduction', '2026-09-02T08:00:00.000Z', 'fr');

INSERT INTO sessions (id, title, mode, started_at, ended_at, created_at, updated_at) VALUES
	('s-1', 'Bonjour à Paris', 'exam', '2026-10-01T09:00:00.000Z', '2026-10-01T09:12:00.000Z', '2026-10-01T09:00:00.000Z', '2026-10-01T09:12:00.000Z'),
	('s-2', 'Le marché du samedi', 'casual', '2026-10-03T11:00:00.000Z', NULL, '2026-10-03T11:00:00.000Z', '2026-10-03T11:08:00.000Z');

INSERT INTO attempts
	(id, session_id, prompt_id, prompt_text, transcript, corrected_text, duration_sec, word_count,
	 audio_key, created_at, updated_at, summary, translation, translations, tts_voice,
	 explanation, follow_up, word_glosses)
VALUES
	('a-1', 's-1', 'p-1', 'Présentez-vous en quelques phrases.',
	 'Bonjour, je m''appelle Ana.', 'Bonjour, je m''appelle Ana.', 42.5, 4,
	 'audio-a-1', '2026-10-01T09:02:00.000Z', '2026-10-01T09:02:00.000Z',
	 'Bonne présentation.', 'Hello, my name is Ana.',
	 '{"version":3,"instructionLanguage":"en","idiomatic":"Hello, my name is Ana.","idiomaticVariants":[],"literal":"Good day, I call myself Ana.","wordForWord":"Hello I me call Ana","wordBreakdown":[]}',
	 'piper-tom-medium', '<hl>Bonjour</hl>, je m''appelle Ana.',
	 '{"question":"D''où venez-vous ?","translation":"Where are you from?"}',
	 NULL),
	('a-2', 's-1', NULL, 'Parlez de votre journée.',
	 'Je vais au marché.', 'Je vais au marché.', 31.0, 4,
	 NULL, '2026-10-01T09:08:00.000Z', '2026-10-01T09:08:00.000Z',
	 'Bien.', NULL, NULL, NULL, 'Simple et correct.', NULL, NULL),
	('a-3', 's-2', NULL, 'Racontez votre lecture.',
	 'Hier j''ai lu un livre.', 'Hier, j''ai lu un livre.', 55.25, 5,
	 'audio-a-3', '2026-10-03T11:04:00.000Z', '2026-10-03T11:04:00.000Z',
	 'Bon récit.', NULL, NULL, NULL, 'Ajoutez une virgule après « Hier ».', NULL, NULL);

INSERT INTO corrections
	(id, attempt_id, category, severity, label, original, replacement, explanation,
	 speak_text, exam_status, formal_alternatives, sort_order, created_at,
	 replacement_translation, start_index, end_index)
VALUES
	('c-1', 'a-3', 'style', 'suggestion', 'Punctuation', 'Hier j''ai', 'Hier, j''ai',
	 'A comma after a time adverb reads more naturally.', NULL, 'allowed', '[]', 0,
	 '2026-10-03T11:04:01.000Z', 'Yesterday, I', 0, 8);

INSERT INTO audio_assets (key, attempt_id, mime, data_base64, created_at) VALUES
	('audio-a-1', 'a-1', 'audio/webm', 'AAECAwQ=', '2026-10-01T09:02:00.000Z'),
	('audio-a-3', 'a-3', 'audio/webm', 'BQYHCAk=', '2026-10-03T11:04:00.000Z');

INSERT INTO settings (key, value, updated_at) VALUES
	('onspot.setting.level', '"B1"', '2026-10-01T08:00:00.000Z'),
	('onspot.setting.ttsMode', '"local"', '2026-10-01T08:00:00.000Z'),
	('onspot.migration.automatic-model', 'done', '2026-09-30T08:00:00.000Z');

INSERT INTO sync_metadata (provider, remote_file_id, etag, last_synced_at, cursor, updated_at) VALUES
	('google-drive', 'drive-file-1', 'etag-1', '2026-10-04T07:00:00.000Z', NULL, '2026-10-04T07:00:00.000Z');
