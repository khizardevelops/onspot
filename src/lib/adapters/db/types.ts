// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shapes of onspot's stored records, as the screens read them.
 *
 * The Rust core owns the database: the schema, the migrations and every
 * query (`onspot-adapter-repo-sql`). The desktop and Android apps open it
 * natively; in the browser the core runs its SQL through the page's SQLite
 * worker (`browserDatabase.ts`). These types describe the rows that cross
 * the bridge, and the SQL values the worker accepts.
 */

/** SQLite scalar types accepted as bind parameters. */
export type SqlValue = string | number | null;

/** One statement of a transaction the worker runs as a whole. */
export interface SqlStatement {
	sql: string;
	params?: SqlValue[];
}

export type RunMode = 'exam' | 'casual' | 'freeflow';
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

/** A range of a text's word tokens (`glossWords` indexes), `end` inclusive. */
export interface GlossedRange {
	start: number;
	end: number;
}

/** One text's hover translations: a meaning per word token, and its phrases. */
export interface TextGlosses {
	words: string[];
	phrases: PhraseGloss[];
	/**
	 * Optional part-of-speech label for each word token (parallel to `words`),
	 * e.g. "noun", "verb", "adj", "adv", "prep", "pron", "conj", "det", "num".
	 * Absent when `showWordPos` was off when the section was fetched, or on
	 * older stored data.
	 */
	pos?: string[];
	/**
	 * The sections whose part-of-speech labels have been fetched. Separate from
	 * `sections` because meanings fetched before the POS setting existed (or
	 * with it off) have none, and must be asked for again on the next hover.
	 * Absent on older saved meanings.
	 */
	posSections?: GlossedRange[];
	/**
	 * The sections (`glossSections`) whose meanings have been fetched; `words`
	 * is blank outside them. Absent on meanings fetched whole, before
	 * sections: those cover every word.
	 */
	sections?: GlossedRange[];
}

/**
 * Hover translations per text of an attempt (the transcript, the correct
 * version), keyed by a hash of the text so a regenerated text never shows
 * stale meanings.
 */
export type WordGlosses = Record<string, TextGlosses>;

/** A speaking prompt: a bundled catalogue entry or one generated for a learner. */
export interface Prompt {
	id: string;
	title: string;
	text: string;
	category: string | null;
	/** Target language id this prompt belongs to (ISO 639-1). */
	language: string | null;
	/** Instruction language id the title and text are written in (ISO 639-1). */
	instructionLanguage: string;
	createdAt: string;
}

/**
 * A generated prompt waiting to be sent to the shared prompt database.
 *
 * The row is deleted once the server accepts it; failed attempts stay, with
 * their error and count, so the next connection can retry. It holds the
 * prompt text only: no transcript, recording, correction, provider key or
 * device identifier.
 */
export interface PromptSubmission {
	/** The prompt's own id, so queueing the same prompt twice does nothing. */
	id: string;
	title: string;
	text: string;
	/** ISO 639-1 code the title and text are written in. */
	instructionLanguage: string;
	/** ISO 639-1 code of the language being studied. */
	targetLanguage: string;
	level: string;
	mode: RunMode;
	createdAt: string;
	/** Failed sends so far; 0 until the first failure. */
	attempts: number;
	lastAttemptAt: string | null;
	lastError: string | null;
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
	/**
	 * What the session is practised with (migration 10); null on sessions from
	 * before, until they are opened and theirs is worked out from their takes.
	 */
	setup: SessionSetup | null;
}

/**
 * A session's languages and how it is spoken, so opening it again shows its
 * takes as they were practised (`practice/sessionSetup.ts`).
 */
export interface SessionSetup {
	/** The studied language (a `LANGUAGES` id). */
	targetLanguage: string;
	/** The language of instruction (an `INSTRUCTION_LANGUAGES` id). */
	instructionLanguage: string;
	ttsMode: 'local' | 'cloud';
	/** The on-device read-back voice. */
	ttsVoice: string;
	/** The on-device explanation voice; empty when none was chosen. */
	explanationVoice: string;
	/** How fast the studied language is spoken (`SPEECH_PACES`). */
	targetSpeechPace: number;
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
