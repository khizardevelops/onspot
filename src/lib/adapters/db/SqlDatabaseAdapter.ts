/**
 * Runtime-agnostic database implementation.
 *
 * All CRUD lives here, written once against `SqlDriver`. Subclasses only supply
 * the driver (Tauri SQL vs sqlite-wasm in a Worker), so the two runtimes cannot
 * drift apart in behaviour.
 */
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import type {
	AudioAsset,
	Correction,
	ExamStatus,
	IDatabaseAdapter,
	Prompt,
	Session,
	Setting,
	SqlDriver,
	SqlValue,
	SyncMetadata,
	Attempt,
	CorrectionCategory,
	CorrectionSeverity,
	RunMode,
	TranslationBreakdownItem,
	TranslationSet
} from './types';

const nowIso = () => new Date().toISOString();

/** Upsert clause shared by every table: replace all columns on conflict. */
function upsert(table: string, columns: string[]): string {
	const placeholders = columns.map(() => '?').join(', ');
	const updates = columns
		.filter((c) => c !== 'id')
		.map((c) => `${c}=excluded.${c}`)
		.join(', ');
	return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`;
}

/** A minimal SQL statement splitter that respects single-quoted string literals. */
function splitStatements(sql: string): string[] {
	const out: string[] = [];
	let current = '';
	let inString = false;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (inString) {
			current += ch;
			if (ch === "'") {
				if (sql[i + 1] === "'") current += sql[++i];
				else inString = false;
			}
		} else if (ch === "'") {
			inString = true;
			current += ch;
		} else if (ch === ';') {
			if (current.trim()) out.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim()) out.push(current.trim());
	return out;
}

function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return String(value);
	return `'${String(value).replace(/'/g, "''")}'`;
}

type Row = Record<string, unknown>;

export abstract class SqlDatabaseAdapter implements IDatabaseAdapter {
	abstract readonly kind: 'tauri-sql' | 'opfs-sqlite';

	private dbPromise: Promise<SqlDriver> | null = null;

	/** Subclasses open the concrete engine. Called once. */
	protected abstract openDriver(): Promise<SqlDriver>;

	protected sql(): Promise<SqlDriver> {
		if (!this.dbPromise) this.dbPromise = this.openDriver();
		return this.dbPromise;
	}

	async init(): Promise<void> {
		const db = await this.sql();
		await db.execute('PRAGMA foreign_keys = ON');
		await db.execute(
			'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
		);

		const rows = await db.select<{ version: number }>(
			'SELECT version FROM schema_migrations ORDER BY version'
		);
		const applied = new Set(rows.map((r) => r.version));

		for (let version = 1; version <= SCHEMA_VERSION; version++) {
			if (applied.has(version)) continue;
			const migration = MIGRATIONS[version];
			if (!migration) continue;
			for (const statement of splitStatements(migration)) {
				await db.execute(statement);
			}
			await db.execute('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
				version,
				nowIso()
			]);
		}
	}

	async close(): Promise<void> {
		if (!this.dbPromise) return;
		const db = await this.dbPromise;
		this.dbPromise = null;
		await db.close();
	}

	// ---------------------------------------------------------------- Prompts

	async listPrompts(): Promise<Prompt[]> {
		const db = await this.sql();
		return db.select<Prompt>(
			'SELECT id, title, text, category, created_at AS createdAt FROM prompts ORDER BY created_at DESC'
		);
	}

	async getPrompt(id: string): Promise<Prompt | null> {
		const db = await this.sql();
		const rows = await db.select<Prompt>(
			'SELECT id, title, text, category, created_at AS createdAt FROM prompts WHERE id = ?',
			[id]
		);
		return rows[0] ?? null;
	}

	async putPrompt(prompt: Prompt): Promise<void> {
		const db = await this.sql();
		await db.execute(
			upsert('prompts', ['id', 'title', 'text', 'category', 'created_at']),
			[prompt.id, prompt.title, prompt.text, prompt.category, prompt.createdAt]
		);
	}

	async deletePrompt(id: string): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM prompts WHERE id = ?', [id]);
	}

	// --------------------------------------------------------------- Sessions

	async listSessions(): Promise<Session[]> {
		const db = await this.sql();
		return db.select<Session>(
			`SELECT id, title, mode, started_at AS startedAt, ended_at AS endedAt,
			        created_at AS createdAt, updated_at AS updatedAt
			 FROM sessions ORDER BY created_at DESC`
		);
	}

	async getSession(id: string): Promise<Session | null> {
		const db = await this.sql();
		const rows = await db.select<Session>(
			`SELECT id, title, mode, started_at AS startedAt, ended_at AS endedAt,
			        created_at AS createdAt, updated_at AS updatedAt
			 FROM sessions WHERE id = ?`,
			[id]
		);
		return rows[0] ?? null;
	}

	async putSession(session: Session): Promise<void> {
		const db = await this.sql();
		await db.execute(
			upsert('sessions', [
				'id',
				'title',
				'mode',
				'started_at',
				'ended_at',
				'created_at',
				'updated_at'
			]),
			[
				session.id,
				session.title,
				session.mode satisfies RunMode,
				session.startedAt,
				session.endedAt,
				session.createdAt,
				session.updatedAt
			]
		);
	}

	async deleteSession(id: string): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM sessions WHERE id = ?', [id]);
	}

	// --------------------------------------------------------------- Attempts

	async listAttempts(sessionId: string): Promise<Attempt[]> {
		const db = await this.sql();
		const rows = await db.select<AttemptRow>(`${ATTEMPT_SELECT} WHERE session_id = ? ORDER BY created_at ASC`, [
			sessionId
		]);
		return rows.map(mapAttempt);
	}

	async listAllAttempts(): Promise<Attempt[]> {
		const db = await this.sql();
		const rows = await db.select<AttemptRow>(`${ATTEMPT_SELECT} ORDER BY created_at ASC`);
		return rows.map(mapAttempt);
	}

	async getAttempt(id: string): Promise<Attempt | null> {
		const db = await this.sql();
		const rows = await db.select<AttemptRow>(`${ATTEMPT_SELECT} WHERE id = ?`, [id]);
		return rows[0] ? mapAttempt(rows[0]) : null;
	}

	async putAttempt(attempt: Attempt): Promise<void> {
		const db = await this.sql();
		await db.execute(
			upsert('attempts', [
				'id',
				'session_id',
				'prompt_id',
				'prompt_text',
				'transcript',
				'corrected_text',
				'natural_speech',
				'translation',
				'translations',
				'tts_voice',
				'summary',
				'duration_sec',
				'word_count',
				'audio_key',
				'created_at',
				'updated_at'
			]),
			[
				attempt.id,
				attempt.sessionId,
				attempt.promptId,
				attempt.promptText,
				attempt.transcript,
				attempt.correctedText,
				attempt.naturalSpeech,
				attempt.translation,
				attempt.translations ? JSON.stringify(attempt.translations) : null,
				attempt.ttsVoice,
				attempt.summary,
				attempt.durationSec,
				attempt.wordCount,
				attempt.audioKey,
				attempt.createdAt,
				attempt.updatedAt
			]
		);
	}

	async deleteAttempt(id: string): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM attempts WHERE id = ?', [id]);
	}

	// ------------------------------------------------------------ Corrections

	async listCorrections(attemptId: string): Promise<Correction[]> {
		const db = await this.sql();
		const rows = await db.select<Row & { formalAlternatives: string | null }>(
			`SELECT id, attempt_id AS attemptId, category, severity, label, original, replacement,
			        replacement_translation AS replacementTranslation, explanation,
			        speak_text AS speakText, exam_status AS examStatus,
			        formal_alternatives AS formalAlternatives, sort_order AS sortOrder,
			        created_at AS createdAt
			 FROM corrections WHERE attempt_id = ? ORDER BY sort_order ASC`,
			[attemptId]
		);
		return rows.map(mapCorrection);
	}

	async listAllCorrections(): Promise<Correction[]> {
		const db = await this.sql();
		const rows = await db.select<Row & { formalAlternatives: string | null }>(
			`SELECT id, attempt_id AS attemptId, category, severity, label, original, replacement,
			        replacement_translation AS replacementTranslation, explanation,
			        speak_text AS speakText, exam_status AS examStatus,
			        formal_alternatives AS formalAlternatives, sort_order AS sortOrder,
			        created_at AS createdAt
			 FROM corrections ORDER BY created_at ASC, sort_order ASC`
		);
		return rows.map(mapCorrection);
	}

	/**
	 * The LLM returns the whole correction set for an attempt at once, so the
	 * old set is discarded rather than diffed.
	 */
	async replaceCorrections(attemptId: string, corrections: Correction[]): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM corrections WHERE attempt_id = ?', [attemptId]);
		for (const c of corrections) {
			await db.execute(
				`INSERT INTO corrections
					(id, attempt_id, category, severity, label, original, replacement,
					 replacement_translation, explanation, speak_text, exam_status,
					 formal_alternatives, sort_order, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					c.id,
					attemptId,
					c.category satisfies CorrectionCategory,
					c.severity satisfies CorrectionSeverity,
					c.label,
					c.original,
					c.replacement,
					c.replacementTranslation,
					c.explanation,
					c.speakText,
					c.examStatus satisfies ExamStatus | null,
					JSON.stringify(c.formalAlternatives ?? []),
					c.sortOrder,
					c.createdAt
				]
			);
		}
	}

	// ------------------------------------------------------------------ Audio

	async putAudio(asset: AudioAsset): Promise<void> {
		const db = await this.sql();
		await db.execute(
			`INSERT INTO audio_assets (key, attempt_id, mime, data_base64, created_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET
			   attempt_id=excluded.attempt_id, mime=excluded.mime,
			   data_base64=excluded.data_base64, created_at=excluded.created_at`,
			[asset.key, asset.attemptId, asset.mime, asset.dataBase64, asset.createdAt]
		);
	}

	async getAudio(key: string): Promise<AudioAsset | null> {
		const db = await this.sql();
		const rows = await db.select<AudioAsset>(
			`SELECT key, attempt_id AS attemptId, mime, data_base64 AS dataBase64,
			        created_at AS createdAt
			 FROM audio_assets WHERE key = ?`,
			[key]
		);
		return rows[0] ?? null;
	}

	async deleteAudio(key: string): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM audio_assets WHERE key = ?', [key]);
	}

	// --------------------------------------------------------------- Settings

	async getSetting(key: string): Promise<string | null> {
		const db = await this.sql();
		const rows = await db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
			key
		]);
		return rows[0]?.value ?? null;
	}

	async setSetting(key: string, value: string): Promise<void> {
		const db = await this.sql();
		await db.execute(
			`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
			[key, value, nowIso()]
		);
	}

	async listSettings(): Promise<Setting[]> {
		const db = await this.sql();
		return db.select<Setting>(
			'SELECT key, value, updated_at AS updatedAt FROM settings ORDER BY key ASC'
		);
	}

	async deleteSetting(key: string): Promise<void> {
		const db = await this.sql();
		await db.execute('DELETE FROM settings WHERE key = ?', [key]);
	}

	// ----------------------------------------------------------- Sync metadata

	async getSyncMetadata(provider: string): Promise<SyncMetadata | null> {
		const db = await this.sql();
		const rows = await db.select<SyncMetadata>(
			`SELECT provider, remote_file_id AS remoteFileId, etag,
			        last_synced_at AS lastSyncedAt, cursor, updated_at AS updatedAt
			 FROM sync_metadata WHERE provider = ?`,
			[provider]
		);
		return rows[0] ?? null;
	}

	async setSyncMetadata(meta: SyncMetadata): Promise<void> {
		const db = await this.sql();
		await db.execute(
			`INSERT INTO sync_metadata (provider, remote_file_id, etag, last_synced_at, cursor, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(provider) DO UPDATE SET
			   remote_file_id=excluded.remote_file_id, etag=excluded.etag,
			   last_synced_at=excluded.last_synced_at, cursor=excluded.cursor,
			   updated_at=excluded.updated_at`,
			[
				meta.provider,
				meta.remoteFileId,
				meta.etag,
				meta.lastSyncedAt,
				meta.cursor,
				meta.updatedAt
			]
		);
	}

	// -------------------------------------------------------- Export / import

	/**
	 * Portable logical dump: schema plus `INSERT`s, as UTF-8 bytes of a `.sql`
	 * file. Works identically on both runtimes, unlike a raw SQLite page image.
	 */
	async export(): Promise<Uint8Array> {
		const db = await this.sql();
		const lines: string[] = ['-- onspot database dump', `-- ${nowIso()}`, 'BEGIN;'];

		for (const table of EXPORT_TABLES) {
			const rows = await db.select<Row>(`SELECT * FROM ${table}`);
			lines.push(`DELETE FROM ${table};`);
			for (const row of rows) {
				const columns = Object.keys(row);
				const values = columns.map((c) => sqlLiteral(row[c]));
				lines.push(
					`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`
				);
			}
		}

		lines.push('COMMIT;');
		return new TextEncoder().encode(lines.join('\n'));
	}

	async import(data: Uint8Array): Promise<void> {
		const db = await this.sql();
		const text = new TextDecoder().decode(data);
		for (const statement of splitStatements(text)) {
			if (statement.startsWith('--')) continue;
			await db.execute(statement);
		}
	}
}

const ATTEMPT_SELECT = `
	SELECT id, session_id AS sessionId, prompt_id AS promptId, prompt_text AS promptText,
	       transcript, corrected_text AS correctedText, natural_speech AS naturalSpeech,
	       translation, translations, tts_voice AS ttsVoice, summary, duration_sec AS durationSec,
	       word_count AS wordCount, audio_key AS audioKey,
	       created_at AS createdAt, updated_at AS updatedAt
	FROM attempts`;

interface AttemptRow extends Omit<Attempt, 'translations'> {
	translations: string | null;
}

function mapAttempt(row: AttemptRow): Attempt {
	let translations: TranslationSet | null = null;
	if (row.translations) {
		try {
			const parsed = JSON.parse(row.translations);
			const idiomatic = String(parsed?.idiomatic ?? '');
			translations = {
				...(parsed?.version === 2 ? { version: 2 as const } : {}),
				idiomatic,
				idiomaticVariants: Array.isArray(parsed?.idiomaticVariants)
					? parsed.idiomaticVariants
						.map(String)
						.filter((value: string) => value && value !== idiomatic)
					: [],
				literal: String(parsed?.literal ?? ''),
				wordForWord: String(parsed?.wordForWord ?? ''),
				wordBreakdown: Array.isArray(parsed?.wordBreakdown)
					? parsed.wordBreakdown
						.map((item: unknown) => {
							const entry = item as Record<string, unknown>;
							return {
								source: String(entry?.source ?? ''),
								target: String(entry?.target ?? '')
							};
						})
						.filter((item: TranslationBreakdownItem) => item.source && item.target)
					: []
			};
		} catch {
			translations = null;
		}
	}
	return { ...row, translations };
}

const EXPORT_TABLES = [
	'prompts',
	'sessions',
	'attempts',
	'corrections',
	'audio_assets',
	'settings',
	'sync_metadata'
] as const;

function mapCorrection(row: Row & { formalAlternatives: string | null }): Correction {
	let alternatives: string[] = [];
	if (row.formalAlternatives) {
		try {
			const parsed = JSON.parse(row.formalAlternatives);
			if (Array.isArray(parsed)) alternatives = parsed.map(String);
		} catch {
			alternatives = [];
		}
	}
	return {
		id: String(row.id),
		attemptId: String(row.attemptId),
		category: row.category as CorrectionCategory,
		severity: row.severity as CorrectionSeverity,
		label: String(row.label),
		original: String(row.original),
		replacement: String(row.replacement),
		replacementTranslation: (row.replacementTranslation as string | null) ?? null,
		explanation: String(row.explanation),
		speakText: (row.speakText as string | null) ?? null,
		examStatus: (row.examStatus as ExamStatus | null) ?? null,
		formalAlternatives: alternatives,
		sortOrder: Number(row.sortOrder ?? 0),
		createdAt: String(row.createdAt)
	};
}
