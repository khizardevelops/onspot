import {
	getDatabaseAdapter,
	isTauriRuntime,
	type Attempt,
	type Correction,
	type Prompt,
	type Session,
	type TranslationSet
} from '$lib/adapters/db';

const SQLITE_MIME = 'application/vnd.sqlite3';

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
		throw new Error('Choose an onspot JSON backup with format 1. SQLite backups are exported separately.');
	}

	const db = await getDatabaseAdapter();
	const sessions = asArray(decoded.sessions);
	const attempts = asArray(decoded.attempts);
	const corrections = asArray(decoded.corrections);
	const prompts = asArray(decoded.prompts);
	const recordings = asArray(decoded.recordings);
	const settings = asArray(decoded.settings);
	const importedAttemptIds = new Set<string>();

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
		if (!id || !sessionId) continue;
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

	for (const row of settings) {
		const key = string(row.key);
		if (key.startsWith('onspot.setting.') && typeof row.value === 'string') await db.setSetting(key, row.value);
	}

	return { sessions: sessionCount, attempts: attemptCount, corrections: [...byAttempt.values()].reduce((count, rows) => count + rows.length, 0), recordings: recordingCount };
}
