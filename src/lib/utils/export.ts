import {
	getDatabaseAdapter,
	isTauriRuntime,
	type Attempt,
	type Correction,
	type Prompt,
	type Session,
	type TranslationSet
} from '#lib/adapters/db/index.js';
import { initSettings } from '#lib/stores/settings.js';
import { toast } from '#lib/stores/toast.js';
import { DatabaseImportError } from '#lib/adapters/db/types.js';
import { StorageFullError, requestPersistentStorage, storageRoom } from './storage';
import { hydrateLatestSession } from '#lib/stores/practice.js';

const SQLITE_MIME = 'application/vnd.sqlite3';
const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Exports the learner's whole database as one standard `.sqlite` file:
 * sessions, attempts, corrections, translations, prompts, settings, the
 * recordings and every cached TTS clip (read-backs, sentences, words,
 * previews). It opens in any SQLite tool.
 *
 * API keys are not included: they live in `localStorage`, never in the
 * database. Downloaded speech models are not included either; they are
 * public downloads the app can fetch again.
 *
 * Resolves to `false` when the learner cancels the save dialog.
 */
export async function exportDatabaseFile(): Promise<boolean> {
	const fileName = `onspot-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
	const db = await getDatabaseAdapter();

	if (isTauriRuntime()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const path = await save({
			defaultPath: fileName,
			filters: [{ name: 'SQLite database', extensions: ['sqlite'] }]
		});
		if (!path) return false;
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		await writeFile(path, await db.exportSqliteFile());
		return true;
	}

	// Native "Save as" where the File System Access API exists, a download
	// elsewhere. The blob is passed as a promise so the picker opens while the
	// user gesture is still fresh.
	const { fileSave } = await import('browser-fs-access');
	try {
		await fileSave(
			db
				.exportSqliteFile()
				.then((bytes) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: SQLITE_MIME })),
			{
				fileName,
				extensions: ['.sqlite'],
				mimeTypes: [SQLITE_MIME],
				description: 'SQLite database'
			}
		);
		return true;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return false;
		throw error;
	}
}

/** True when the bytes start with SQLite's file-format header. */
export function isSqliteDatabase(data: Uint8Array): boolean {
	if (data.byteLength < SQLITE_MAGIC.length) return false;
	for (let i = 0; i < SQLITE_MAGIC.length; i++) {
		if (data[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
	}
	return true;
}

/** How long a restore waits for the user to answer the persistent-storage prompt. */
const PERSIST_PROMPT_WAIT = 60_000;

/** Room kept free beyond the backup itself for SQLite's rewrite and OPFS bookkeeping. */
const SAFETY_MARGIN = 1_048_576;

/** Last-resort download of the previous database when a failed restore could not put it back. */
function saveRescueFile(bytes: Uint8Array): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: SQLITE_MIME }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `onspot-rescue-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sqlite`;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Counts reported after a `.sqlite` backup replaces the local database. */
export interface SqliteRestoreResult {
	sessions: number;
	attempts: number;
}

/**
 * Restores the onspot `.sqlite` backup that `exportDatabaseFile` writes. Unlike
 * the legacy JSON restore, this *replaces* the device's database: anything not
 * in the backup is discarded. Settings are reloaded and the newest restored
 * session is opened so every screen reflects the backup immediately.
 */
export async function importSqliteBackup(file: File): Promise<SqliteRestoreResult> {
	// Which step is running, so an unexpected browser error (Firefox's bare
	// "Unknown failure" DOMException, say) says where it came from.
	let step = 'starting the restore';
	try {
		// Ask first, while the confirm click still counts as user activation:
		// Firefox only prompts for persistent storage then, and a persisted site is
		// not held to the shared per-site allowance that makes restores fail there.
		// Not awaited: the promise only settles once the user answers the prompt.
		const web = !isTauriRuntime();
		const persisting = web ? requestPersistentStorage() : Promise.resolve(false);
		step = 'reading the backup file';
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!isSqliteDatabase(bytes)) {
			throw new RestoreError('This is not a SQLite database. Choose an onspot .sqlite backup.');
		}
		step = 'opening the local database';
		const db = await getDatabaseAdapter();
		step = 'measuring the local database';
		// The current database file is freed before the backup is written, so only
		// growth beyond it needs new room. A site already over its allowance has none.
		const current = web ? (await db.exportSqliteFile()).byteLength : 0;
		const needed = Math.max(0, bytes.byteLength - current) + SAFETY_MARGIN;
		if (web) {
			step = 'checking browser storage';
			let room = await storageRoom();
			if (room && room.free < needed && !room.persisted) {
				// Not enough room yet; the browser may be asking to allow persistent storage.
				toast('Allow persistent storage if your browser asks: this site needs more room to restore.', 8000);
				await Promise.race([persisting, new Promise((resolve) => setTimeout(resolve, PERSIST_PROMPT_WAIT))]);
				room = await storageRoom();
			}
			if (room && room.free < needed) throw new StorageFullError(room, needed, 'Nothing was changed.');
		}
		step = 'writing the backup into the local database';
		try {
			await db.importSqliteFile(bytes);
		} catch (error) {
			if (!(error instanceof DatabaseImportError)) throw error;
			if (error.invalid) throw new RestoreError(`${error.message} Nothing was changed.`);
			let outcome = 'Nothing was changed: your current data is still here.';
			if (!error.rolledBack) {
				if (error.rescue) saveRescueFile(error.rescue);
				outcome = error.rescue
					? 'Your previous data could not be written back, so it was downloaded as an onspot-rescue .sqlite file; restore that once there is space.'
					: 'Your previous data could not be written back.';
			}
			if (error.storage) throw new StorageFullError(await storageRoom(), needed, outcome);
			throw new RestoreError(`Restore failed while ${step} (${error.message}). ${outcome}`);
		}
		step = 'reloading the restored data';
		const [sessions, attempts] = await Promise.all([db.listSessions(), db.listAllAttempts()]);
		// Imported settings must replace the in-memory ones, or the next preference
		// change would write the old values back over the restored database.
		await initSettings();
		await hydrateLatestSession();
		return { sessions: sessions.length, attempts: attempts.length };
	} catch (error) {
		if (error instanceof RestoreError || error instanceof StorageFullError) throw error;
		// Unexpected: keep the whole error for the console and name the step in the message.
		console.error(`[restore] failed while ${step}`, error);
		const kind = error instanceof Error && error.name && error.name !== 'Error' ? `${error.name}: ` : '';
		const detail = error instanceof Error ? error.message : String(error);
		throw new RestoreError(`Restore failed while ${step} (${kind}${detail || 'no details'}). Details are in the browser console.`);
	}
}

/** A restore failure whose message is already written for the learner. */
class RestoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RestoreError';
	}
}

/** Counts reported after a legacy JSON backup is merged into the current database. */
export interface LegacyRestoreResult {
	sessions: number;
	attempts: number;
	corrections: number;
	recordings: number;
}

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asArray = (value: unknown): JsonObject[] => Array.isArray(value) ? value.filter(isRecord) : [];
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const nullableString = (value: unknown): string | null => typeof value === 'string' ? value : null;
const number = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const now = () => new Date().toISOString();

function translation(value: unknown): TranslationSet | null {
	if (!isRecord(value)) return null;
	const idiomatic = string(value.idiomatic);
	if (!idiomatic) return null;
	const variants = Array.isArray(value.idiomaticVariants)
		? value.idiomaticVariants.map((item) => string(item)).filter((item) => item && item !== idiomatic)
		: [];
	const breakdown = Array.isArray(value.wordBreakdown)
		? value.wordBreakdown
			.filter(isRecord)
			.map((item) => ({ source: string(item.source), target: string(item.target) }))
			.filter((item) => item.source && item.target)
		: [];
	return {
		...(value.version === 2 ? { version: 2 as const } : {}),
		idiomatic,
		idiomaticVariants: variants,
		literal: string(value.literal),
		wordForWord: string(value.wordForWord),
		wordBreakdown: breakdown
	};
}

/**
 * Merges the pre-SQLite-export JSON format into the current database. It never
 * clears unrelated local data, which makes it safe when recovering a browser
 * profile or moving from the web app to the desktop app.
 */
export async function importLegacyJsonBackup(file: File): Promise<LegacyRestoreResult> {
	let decoded: unknown;
	try {
		decoded = JSON.parse(await file.text());
	} catch {
		throw new Error('This is not a readable onspot JSON backup.');
	}
	if (!isRecord(decoded) || decoded.app !== 'onspot' || decoded.format !== 1) {
		throw new Error('Choose an onspot JSON backup with format 1. For a .sqlite backup, use Restore database.');
	}

	const db = await getDatabaseAdapter();
	const sessions = asArray(decoded.sessions);
	const attempts = asArray(decoded.attempts);
	const corrections = asArray(decoded.corrections);
	const prompts = asArray(decoded.prompts);
	const recordings = asArray(decoded.recordings);
	const settings = asArray(decoded.settings);
	const importedAttemptIds = new Set<string>();
	const knownSessionIds = new Set((await db.listSessions()).map((session) => session.id));

	let sessionCount = 0;
	for (const row of sessions) {
		const id = string(row.id);
		const title = string(row.title);
		if (!id || !title) continue;
		const session: Session = {
			id,
			title,
			mode: row.mode === 'casual' ? 'casual' : 'exam',
			startedAt: string(row.startedAt, now()),
			endedAt: nullableString(row.endedAt),
			createdAt: string(row.createdAt, now()),
			updatedAt: string(row.updatedAt, now())
		};
		await db.putSession(session);
		knownSessionIds.add(id);
		sessionCount++;
	}

	for (const row of prompts) {
		const id = string(row.id);
		const title = string(row.title);
		const text = string(row.text);
		if (!id || !title || !text) continue;
		const prompt: Prompt = {
			id,
			title,
			text,
			category: nullableString(row.category),
			language: string(row.language, 'fr'),
			createdAt: string(row.createdAt, now())
		};
		await db.putPrompt(prompt);
	}

	let attemptCount = 0;
	for (const row of attempts) {
		const id = string(row.id);
		const sessionId = string(row.sessionId);
		// A take whose session is neither in the file nor on this device would
		// fail its foreign key and abort the restore halfway; skip it instead.
		if (!id || !knownSessionIds.has(sessionId)) continue;
		const attempt: Attempt = {
			id,
			sessionId,
			promptId: nullableString(row.promptId),
			promptText: string(row.promptText),
			transcript: string(row.transcript),
			correctedText: nullableString(row.correctedText),
			naturalSpeech: nullableString(row.naturalSpeech),
			translation: nullableString(row.translation),
			translations: translation(row.translations),
			ttsVoice: nullableString(row.ttsVoice),
			summary: nullableString(row.summary),
			durationSec: number(row.durationSec),
			wordCount: number(row.wordCount),
			audioKey: nullableString(row.audioKey),
			createdAt: string(row.createdAt, now()),
			updatedAt: string(row.updatedAt, now())
		};
		await db.putAttempt(attempt);
		importedAttemptIds.add(id);
		attemptCount++;
	}

	const byAttempt = new Map<string, Correction[]>();
	for (const row of corrections) {
		const id = string(row.id);
		const attemptId = string(row.attemptId);
		const category = string(row.category);
		const severity = string(row.severity);
		if (!id || !importedAttemptIds.has(attemptId) || !['grammar', 'register', 'filler', 'style'].includes(category) || !['error', 'warning', 'suggestion'].includes(severity)) continue;
		const correction: Correction = {
			id,
			attemptId,
			category: category as Correction['category'],
			severity: severity as Correction['severity'],
			label: string(row.label),
			original: string(row.original),
			replacement: string(row.replacement),
			replacementTranslation: nullableString(row.replacementTranslation),
			start: typeof row.start === 'number' ? row.start : null,
			end: typeof row.end === 'number' ? row.end : null,
			explanation: string(row.explanation),
			speakText: nullableString(row.speakText),
			examStatus: ['strictly-avoid', 'avoid', 'use-sparingly', 'allowed'].includes(string(row.examStatus))
				? string(row.examStatus) as Correction['examStatus']
				: null,
			formalAlternatives: Array.isArray(row.formalAlternatives) ? row.formalAlternatives.map((item) => string(item)).filter(Boolean) : [],
			sortOrder: number(row.sortOrder),
			createdAt: string(row.createdAt, now())
		};
		const list = byAttempt.get(attemptId) ?? [];
		list.push(correction);
		byAttempt.set(attemptId, list);
	}
	for (const [attemptId, rows] of byAttempt) await db.replaceCorrections(attemptId, rows);

	let recordingCount = 0;
	for (const row of recordings) {
		const attemptId = string(row.attemptId);
		const dataBase64 = string(row.dataBase64);
		if (!importedAttemptIds.has(attemptId) || !dataBase64) continue;
		await db.putAudio({
			key: `attempt:${attemptId}`,
			attemptId,
			mime: string(row.mime, 'audio/webm'),
			dataBase64,
			createdAt: now()
		});
		recordingCount++;
	}

	let settingCount = 0;
	for (const row of settings) {
		const key = string(row.key);
		if (key.startsWith('onspot.setting.') && typeof row.value === 'string') {
			await db.setSetting(key, row.value);
			settingCount++;
		}
	}
	// As with the .sqlite restore: the in-memory settings must pick up the
	// restored values, or the next preference change writes the old ones back.
	if (settingCount) await initSettings();

	return { sessions: sessionCount, attempts: attemptCount, corrections: [...byAttempt.values()].reduce((count, rows) => count + rows.length, 0), recordings: recordingCount };
}
