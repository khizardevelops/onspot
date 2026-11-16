// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Saves one session's Markdown transcript through the core exporter. The
 * database export moves the whole app; this is for the learner who wants to
 * read, print or keep one session's work.
 */
import { sessionMarkdownCore } from '#lib/core-client/export.js';
import { saveTextDocument } from '#lib/platform/saveDocument.js';

const MARKDOWN_MIME = 'text/markdown';

/**
 * Exports one stored session's transcript and corrections as a `.md` file.
 *
 * @param sessionId The session to read through the core.
 * @returns True when a file was saved, false when the learner cancelled.
 */
export async function exportSessionTranscript(sessionId: string): Promise<boolean> {
	const { markdown, fileName } = await sessionMarkdownCore(sessionId);
	return saveTextDocument(fileName, markdown, {
		description: 'Markdown document',
		mimeType: MARKDOWN_MIME,
		extensions: ['md']
	});
}
