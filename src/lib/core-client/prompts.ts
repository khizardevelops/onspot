// SPDX-License-Identifier: AGPL-3.0-or-later

/** Bundled prompt catalogue through the Rust core (P7). */

import { getCoreClient } from './client.js';

export interface CataloguePromptView {
	id: string;
	instructionLanguage: string;
	title: string;
	text: string;
	targetLanguages?: string[];
	category?: string;
}

/**
 * Reads the bundled prompts that suit a language pair.
 *
 * @param instructionLanguage Language the prompt text is written in.
 * @param targetLanguage Language being studied.
 * @returns Matching prompts in catalogue order.
 */
export async function promptCatalogueCore(
	instructionLanguage: string,
	targetLanguage: string
): Promise<CataloguePromptView[]> {
	const client = await getCoreClient();
	const response = await client.command<{ prompts: CataloguePromptView[] }>('prompts.catalogue', {
		instructionLanguage,
		targetLanguage
	});
	return response.prompts;
}
