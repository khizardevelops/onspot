import { getDatabaseAdapter, isTauriRuntime } from '$lib/adapters/db';

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
