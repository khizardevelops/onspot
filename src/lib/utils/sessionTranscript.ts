// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One session as a readable Markdown file: every take's transcript, the
 * corrected version, the explanation, and the corrections with what to say
 * instead. The database export moves the whole app; this is for the learner
 * who wants to read, print or keep one session's work.
 */
import {
	getDatabaseAdapter,
	type Attempt,
	type Correction,
	type Session,
	type TranslationSet
} from '#lib/adapters/db/index.js';
import { speakableExplanation } from '#lib/adapters/llm/explanation.js';
import { isTauri } from '#lib/platform/runtime.js';

const MARKDOWN_MIME = 'text/markdown';

/** Formats a stored ISO time the way the rest of the app writes dates (British English). */
function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

/** m:ss from whole seconds, so 59.6 s reads 1:00 rather than 0:60. */
function formatDuration(seconds: number): string {
	const total = Math.round(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A paragraph readers can scroll without its line breaks becoming Markdown syntax. */
function quote(text: string): string {
	return text
		.trim()
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');
}

/** One correction as a list item; a deletion says so instead of showing an empty arrow. */
function correctionLine(correction: Correction): string {
	const category = correction.category.charAt(0).toUpperCase() + correction.category.slice(1);
	const target = correction.replacement
		? `"${correction.original}" → "${correction.replacement}"`
		: `Remove "${correction.original}"`;
	const meaning = correction.replacementTranslation ? ` (${correction.replacementTranslation})` : '';
	const detail = correction.explanation ? `\n  - ${correction.explanation}` : '';
	return `- **${category} · ${correction.severity}** — ${target}${meaning}${detail}`;
}

/** The translation variants stored on a take, when the learner generated any. */
function translationSection(translations: TranslationSet | null): string[] {
	if (!translations) return [];
	const lines: string[] = [];
	if (translations.idiomatic) lines.push(`- **Idiomatic:** ${translations.idiomatic}`);
	if (translations.literal) lines.push(`- **Literal:** ${translations.literal}`);
	if (translations.wordForWord) lines.push(`- **Word-for-word:** ${translations.wordForWord}`);
	for (const alternative of translations.idiomaticVariants) {
		lines.push(`- **Also:** ${alternative}`);
	}
	const words = translations.wordBreakdown
		.filter((item) => /[\p{L}\p{N}]/u.test(item.source))
		.map((item) => `${item.source} — ${item.target}`);
	if (words.length > 0) lines.push(`- **Each word:** ${words.join('; ')}`);
	if (lines.length === 0) return [];

	return ['**Translation**', '', ...lines, ''];
}

/** One take of the session, in the order the learner recorded them. */
function attemptSection(attempt: Attempt, index: number, corrections: Correction[]): string {
	const lines: string[] = [
		`## Take ${index}`,
		'',
		`${formatDuration(attempt.durationSec)} · ${attempt.wordCount} words · ${formatDate(attempt.createdAt)}`,
		''
	];

	if (attempt.promptText) {
		lines.push(`**Prompt:** ${attempt.promptText}`, '');
	}

	lines.push('**You said**', '', quote(attempt.transcript), '');

	const corrected = attempt.correctedText?.trim();
	if (corrected && corrected !== attempt.transcript.trim()) {
		lines.push('**Did you mean to say?**', '', quote(corrected), '');
	}

	const explanation = speakableExplanation(attempt.explanation ?? '');
	if (explanation) {
		lines.push('**Explanation**', '', explanation, '');
	}

	const followUp = attempt.followUp;
	if (followUp?.question) {
		lines.push(`**Follow-up:** ${followUp.question}`);
		if (followUp.translation) lines.push(`*${followUp.translation}*`);
		lines.push('');
	}

	lines.push(...translationSection(attempt.translations));

	if (corrections.length > 0) {
		lines.push('**Corrections**', '', ...corrections.map(correctionLine), '');
	}

	return lines.join('\n');
}

/**
 * Builds the Markdown for one session without touching the database, so the
 * same text can be checked or shown before saving.
 *
 * @param session The session, for its title, date and mode.
 * @param attempts Its takes, oldest first.
 * @param correctionsByAttempt Each take's corrections, keyed by attempt id.
 * @returns A complete Markdown document.
 */
export function buildSessionMarkdown(
	session: Session,
	attempts: Attempt[],
	correctionsByAttempt: Map<string, Correction[]>
): string {
	const spoken = attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0);

	const lines = [
		`# ${session.title}`,
		'',
		`- **Date:** ${formatDate(session.createdAt)}`,
		`- **Mode:** ${session.mode === 'exam' ? 'Exam' : 'Casual'}`,
		`- **Takes:** ${attempts.length} · ${formatDuration(spoken)} spoken`,
		'',
		`_Exported from onspot on ${formatDate(new Date().toISOString())}._`,
		''
	];

	if (attempts.length === 0) {
		lines.push('_This session has no takes yet._', '');
		return lines.join('\n');
	}

	for (const [index, attempt] of attempts.entries()) {
		lines.push(attemptSection(attempt, index + 1, correctionsByAttempt.get(attempt.id) ?? []));
	}

	return lines.join('\n').trimEnd() + '\n';
}

/** A short, filesystem-friendly name from the session title. */
function fileStem(title: string): string {
	const slug = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return slug || 'session';
}

/**
 * Saves a Markdown document with the platform's own save dialog where one
 * exists (desktop) and a download elsewhere. Rejects nothing on a cancelled
 * dialog; returns false instead.
 */
async function saveMarkdown(fileName: string, markdown: string): Promise<boolean> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const path = await save({
			defaultPath: fileName,
			filters: [{ name: 'Markdown document', extensions: ['md'] }]
		});
		if (!path) return false;

		const { writeTextFile } = await import('@tauri-apps/plugin-fs');
		await writeTextFile(path, markdown);
		return true;
	}

	const { fileSave } = await import('browser-fs-access');
	try {
		await fileSave(new Blob([markdown], { type: `${MARKDOWN_MIME};charset=utf-8` }), {
			fileName,
			extensions: ['.md'],
			mimeTypes: [MARKDOWN_MIME],
			description: 'Markdown document'
		});
		return true;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return false;
		throw error;
	}
}

/**
 * Exports one stored session's transcript and corrections as a `.md` file.
 *
 * @param sessionId The session to read from the database.
 * @returns True when a file was saved, false when the learner cancelled.
 */
export async function exportSessionTranscript(sessionId: string): Promise<boolean> {
	const db = await getDatabaseAdapter();
	const session = await db.getSession(sessionId);
	if (!session) throw new Error('That session is no longer on this device.');

	const attempts = await db.listAttempts(sessionId);
	const corrections = await Promise.all(attempts.map((attempt) => db.listCorrections(attempt.id)));
	const correctionsByAttempt = new Map(attempts.map((attempt, index) => [attempt.id, corrections[index]]));

	const markdown = buildSessionMarkdown(session, attempts, correctionsByAttempt);
	const day = session.createdAt.slice(0, 10);
	return saveMarkdown(`onspot-${fileStem(session.title)}-${day}.md`, markdown);
}
