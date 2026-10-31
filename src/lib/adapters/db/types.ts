// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Database abstraction for onspot.
 *
 * The app runs in two runtimes with very different storage engines:
 *  - Desktop (Tauri v2): native SQLite through `@tauri-apps/plugin-sql`.
 *  - Web SPA (browser): `@sqlite.org/sqlite-wasm` over OPFS, inside a Worker.
 *
 * Everything above this layer talks only to `IDatabaseAdapter`, so no store or
 * component imports a storage engine directly. The concrete SQL is shared by
 * both runtimes via `SqlDatabaseAdapter`; only the low-level driver differs.
 */

/** SQLite scalar types accepted as bind parameters. */
export type SqlValue = string | number | null;

/** The subset of a SQL engine the repository layer needs. */
export interface SqlDriver {
	/** Run a statement that returns no rows (INSERT/UPDATE/DELETE/DDL). */
	execute(sql: string, params?: SqlValue[]): Promise<void>;
	/** Run a query and return rows as plain objects. */
	select<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
	/**
	 * Run statements as one transaction: all of them or none. Optional because
	 * Tauri's plugin pools connections, so a `BEGIN` sent through it may not
	 * share a connection with the statements after it.
	 */
	batch?(statements: SqlStatement[]): Promise<void>;
	close(): Promise<void>;
}

/** One statement of a `SqlDriver.batch`. */
export interface SqlStatement {
	sql: string;
	params?: SqlValue[];
}

export type RunMode = 'exam' | 'casual';
export type CorrectionCategory = 'grammar' | 'register' | 'filler' | 'style';
export type CorrectionSeverity = 'error' | 'warning' | 'suggestion';
export type ExamStatus = 'strictly-avoid' | 'avoid' | 'use-sparingly' | 'allowed';

export interface TranslationBreakdownItem {
	source: string;
	target: string;
}

/**
 * Three ways to render the learner's sentence in their native language:
 * idiomatic, literal (grammar fixed, structure preserved) and word-for-word
 * (root meaning in the original order, for study).
 */
/**
 * The translation format in use. Version 3 translates the correct version of
 * the take ("Did you mean to say?"), not the raw transcript, which can be
 * nonsense; version 2 sets translated the transcript and are regenerated
 * when the learner asks for a translation.
 */
export const TRANSLATION_SET_VERSION = 3;

export interface TranslationSet {
	/** Prompt/format version (see `TRANSLATION_SET_VERSION`). Missing on attempts created before the stricter translation prompt. */
	version?: number;
	/** The language of instruction it is written in (an `INSTRUCTION_LANGUAGES` id); missing means English. */
	instructionLanguage?: string;
	idiomatic: string;
	/** Other genuinely distinct natural renderings; excludes the primary idiomatic value. */
	idiomaticVariants: string[];
	literal: string;
	wordForWord: string;
	/** Token/morpheme mapping, generated on demand to keep normal evaluation compact. */
	wordBreakdown: TranslationBreakdownItem[];
}

/** The question that keeps the learner talking after a take, and what it means. */
export interface FollowUp {
	/** In the target language; the learner answers it in their next take. */
	question: string;
	/** In the language of instruction; hidden until the learner asks for it. Empty on older takes. */
	translation: string;
}

/**
 * The meaning of several words read together. `start` and `end` are word-token
 * indexes, inclusive. `expression` phrases come with the word meanings (fixed
 * expressions, compound nouns: "pomme de terre"); `selection` phrases are
 * ranges the learner selected, kept so selecting them again is instant.
 */
export interface PhraseGloss {
	start: number;
	end: number;
	meaning: string;
	origin: 'expression' | 'selection';
}

/** One text's hover translations: a meaning per word token, and its phrases. */
export interface TextGlosses {
	words: string[];
	phrases: PhraseGloss[];
}

/**
 * Hover translations per text of an attempt (the transcript, the correct
 * version), keyed by a hash of the text so a regenerated text never shows
 * stale meanings.
 */
export type WordGlosses = Record<string, TextGlosses>;

/** A speaking prompt. Populated from a seed list and/or generated per session. */
export interface Prompt {
	id: string;
	title: string;
	text: string;
	category: string | null;
	/** Target language id this prompt belongs to (ISO 639-1). */
	language: string | null;
	createdAt: string;
}

/** One practice session: a topic the learner keeps speaking about. */
export interface Session {
	id: string;
	title: string;
	mode: RunMode;
	startedAt: string;
	endedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** One recorded answer inside a session. */
export interface Attempt {
	id: string;
	sessionId: string;
	promptId: string | null;
	promptText: string;
	/** Raw STT transcript of what the learner actually said. */
	transcript: string;
	/** The correct version: what the learner was trying to say, fixed but faithful. */
	correctedText: string | null;
	/** Translation of what the learner meant, in the language of instruction (idiomatic variant). */
	translation: string | null;
	/** All three translation variants. */
	translations: TranslationSet | null;
	/** Voice id or cloud model last used to synthesize this attempt. */
	ttsVoice: string | null;
	/**
	 * Spoken coaching in the language of instruction, with highlight tags
	 * (`adapters/llm/explanation.ts`). Takes from before migration 7 carry
	 * their plain coaching summary here.
	 */
	explanation: string | null;
	/** The follow-up question and its translation (migration 8); older takes carry it in `explanation`. */
	followUp: FollowUp | null;
	/** In-context word meanings for hover translations (migration 9), fetched on first hover. */
	wordGlosses: WordGlosses | null;
	durationSec: number;
	wordCount: number;
	/** Cache key for the recorded audio in `audio_assets`, if any. */
	audioKey: string | null;
	createdAt: string;
	updatedAt: string;
}

/** One correction the LLM produced for an attempt. */
export interface Correction {
	id: string;
	attemptId: string;
	category: CorrectionCategory;
	severity: CorrectionSeverity;
	label: string;
	original: string;
	replacement: string;
	/** The suggested replacement's meaning, in the language of instruction. */
	replacementTranslation: string | null;
	/** Character offsets of `original` in the attempt transcript, when known. */
	start: number | null;
	end: number | null;
	explanation: string;
	/** Sentence to read back through TTS, when the correction warrants one. */
	speakText: string | null;
	examStatus: ExamStatus | null;
	formalAlternatives: string[];
	sortOrder: number;
	createdAt: string;
}

/** Stored microphone audio. Base64 text keeps both drivers portable. */
export interface AudioAsset {
	key: string;
	attemptId: string | null;
	mime: string;
	dataBase64: string;
	createdAt: string;
}

/** Free-form key/value settings (API keys, preferences). */
export interface Setting {
	key: string;
	value: string;
	updatedAt: string;
}

/** Sync bookkeeping for one BYOC provider. */
export interface SyncMetadata {
	provider: string;
	remoteFileId: string | null;
	etag: string | null;
	lastSyncedAt: string | null;
	cursor: string | null;
	updatedAt: string;
}

/**
 * Unified persistence contract. Implementations: `TauriSqlAdapter`,
 * `OpfsSqliteAdapter`.
 */
export interface IDatabaseAdapter {
	/** Which backend is live; surfaced in Settings and logs. */
	readonly kind: 'tauri-sql' | 'opfs-sqlite';

	/** Open the connection and run migrations. Idempotent. */
	init(): Promise<void>;
	close(): Promise<void>;

	// Prompts
	/** All prompts, or only those for one language id when provided. */
	listPrompts(language?: string): Promise<Prompt[]>;
	getPrompt(id: string): Promise<Prompt | null>;
	putPrompt(prompt: Prompt): Promise<void>;
	deletePrompt(id: string): Promise<void>;

	// Sessions
	listSessions(): Promise<Session[]>;
	getSession(id: string): Promise<Session | null>;
	putSession(session: Session): Promise<void>;
	deleteSession(id: string): Promise<void>;

	// Attempts
	listAttempts(sessionId: string): Promise<Attempt[]>;
	listAllAttempts(): Promise<Attempt[]>;
	getAttempt(id: string): Promise<Attempt | null>;
	putAttempt(attempt: Attempt): Promise<void>;
	deleteAttempt(id: string): Promise<void>;

	// Corrections (replaced wholesale per attempt — the LLM result is atomic)
	listCorrections(attemptId: string): Promise<Correction[]>;
	/** Every correction, for cross-session analytics. */
	listAllCorrections(): Promise<Correction[]>;
	replaceCorrections(attemptId: string, corrections: Correction[]): Promise<void>;

	// Audio
	putAudio(asset: AudioAsset): Promise<void>;
	getAudio(key: string): Promise<AudioAsset | null>;
	deleteAudio(key: string): Promise<void>;
	/** Drop every cached clip last saved for this attempt (recording or read-back). */
	deleteAttemptAudio(attemptId: string): Promise<void>;

	// Settings
	getSetting(key: string): Promise<string | null>;
	setSetting(key: string, value: string): Promise<void>;
	listSettings(): Promise<Setting[]>;
	deleteSetting(key: string): Promise<void>;

	// Sync metadata
	getSyncMetadata(provider: string): Promise<SyncMetadata | null>;
	setSyncMetadata(meta: SyncMetadata): Promise<void>;

	/** Dump the whole database as a portable SQL script (UTF-8 bytes). */
	export(): Promise<Uint8Array>;
	/**
	 * The whole database as a standard `.sqlite` file: every table, including
	 * recordings and all cached TTS audio. API keys live outside the database
	 * and are never part of it.
	 */
	exportSqliteFile(): Promise<Uint8Array>;
	/**
	 * Replace the whole database with a `.sqlite` file produced by
	 * `exportSqliteFile`, then run migrations and leave it open. Destructive:
	 * data on this device that is absent from the file is discarded.
	 */
	importSqliteFile(data: Uint8Array): Promise<void>;
	/** Replace the database contents from a dump produced by `export`. */
	import(data: Uint8Array): Promise<void>;
}

/**
 * A `.sqlite` restore that failed. `storage` marks a write the browser refused
 * (Firefox's per-site quota, or a full disk). When `rolledBack` is false the
 * previous database could not be written back and `rescue` holds it.
 */
export class DatabaseImportError extends Error {
	constructor(
		message: string,
		readonly storage: boolean,
		readonly rolledBack: boolean,
		readonly rescue?: Uint8Array,
		/** The file was rejected before anything was written (not an onspot backup, or damaged). */
		readonly invalid = false
	) {
		super(message);
		this.name = 'DatabaseImportError';
	}
}
