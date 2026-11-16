// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The platform save-dialog shim: desktop uses the native dialog and file
 * system, the web downloads through the File System Access API fallback.
 * Everything outside this module works with plain text and never imports a
 * Tauri plugin directly.
 */

import { isTauri } from '#lib/platform/runtime.js';

/** The filter shown in the native save dialog and the web file picker. */
export interface SaveDocumentFilter {
	/** Human-readable description, e.g. "Markdown document". */
	description: string;
	/** MIME type, e.g. `text/markdown`. */
	mimeType: string;
	/** File extensions, without the dot, e.g. `['md']`. */
	extensions: string[];
}

/**
 * Saves a text document with the platform's own dialog.
 *
 * @returns True when the file was saved, false when the learner cancelled.
 */
export async function saveTextDocument(
	fileName: string,
	text: string,
	filter: SaveDocumentFilter
): Promise<boolean> {
	if (isTauri()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const path = await save({
			defaultPath: fileName,
			filters: [{ name: filter.description, extensions: filter.extensions }]
		});
		if (!path) return false;

		const { writeTextFile } = await import('@tauri-apps/plugin-fs');
		await writeTextFile(path, text);
		return true;
	}

	const { fileSave } = await import('browser-fs-access');
	try {
		await fileSave(new Blob([text], { type: `${filter.mimeType};charset=utf-8` }), {
			fileName,
			extensions: filter.extensions.map((extension) => `.${extension}`),
			mimeTypes: [filter.mimeType],
			description: filter.description
		});
		return true;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return false;
		throw error;
	}
}
