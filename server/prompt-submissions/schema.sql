-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Review queue for prompt contributions. Maintainers promote approved rows into
-- src/lib/practice/promptCatalogue.ts; nothing here is served to clients.
CREATE TABLE IF NOT EXISTS prompt_submissions (
	id                    TEXT PRIMARY KEY,
	content_hash          TEXT NOT NULL UNIQUE,
	title                 TEXT NOT NULL,
	text                  TEXT NOT NULL,
	instruction_language  TEXT NOT NULL,
	target_language       TEXT NOT NULL,
	level                 TEXT NOT NULL,
	mode                  TEXT NOT NULL,
	prompt_created_at     TEXT NOT NULL,
	received_at           TEXT NOT NULL,
	status                TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS prompt_submissions_status
	ON prompt_submissions (status, received_at);
