// SPDX-License-Identifier: AGPL-3.0-or-later

/** Session Markdown assembly through the Rust core (P7). */

import { getCoreClient } from './client.js';

export interface SessionMarkdown {
	markdown: string;
	fileName: string;
}

/**
 * Asks the core to assemble one session's readable Markdown and file name.
 *
 * @param sessionId The session to export.
 * @returns The document and its suggested file name.
 */
export async function sessionMarkdownCore(sessionId: string): Promise<SessionMarkdown> {
	const client = await getCoreClient();
	return client.command<SessionMarkdown>('export.session_markdown', { sessionId });
}

/** The result of a whole-database export through the core. */
export interface DatabaseExport {
	saved: boolean;
	fileName: string;
}

/** Which backup is waiting for the learner's confirmation. */
export interface RestorePick {
	fileName: string | null;
}

/** What a confirmed restore put back on the device. */
export interface RestoreRestored {
	sessions: number;
	attempts: number;
}

/**
 * Exports the whole database through the core and the driver's save dialog.
 *
 * @returns Whether the file was saved and the suggested name.
 */
export async function exportDatabaseCore(): Promise<DatabaseExport> {
	const client = await getCoreClient();
	return client.command<DatabaseExport>('export.database');
}

/**
 * Opens the picker, validates the backup and stages it for confirmation.
 *
 * @returns The picked file's name, or `null` when the picker was cancelled.
 */
export async function restorePickCore(): Promise<RestorePick> {
	const client = await getCoreClient();
	return client.command<RestorePick>('restore.pick');
}

/**
 * Applies the staged backup. Call only after the learner confirmed it.
 *
 * @returns Sessions and takes now in the database.
 */
export async function restoreConfirmCore(): Promise<RestoreRestored> {
	const client = await getCoreClient();
	return client.command<RestoreRestored>('restore.confirm');
}

/** Discards a staged backup without touching the database. */
export async function restoreCancelCore(): Promise<void> {
	const client = await getCoreClient();
	await client.command('restore.cancel');
}
