// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IDatabaseAdapter, Prompt } from '#lib/adapters/db/index.js';
import { DEFAULT_INSTRUCTION_LANGUAGE_ID, getInstructionLanguage, requireLanguage } from '#lib/languages/index.js';
import { promptCatalogueCore } from '#lib/core-client/prompts.js';

/**
 * The prompts already stored for a studied language and a language of
 * instruction, seeding the bundled catalogue entries on first use.
 *
 * A language of instruction without catalogue entries yields an empty list:
 * the caller generates a prompt instead, and later calls find what it stored.
 *
 * @param db The open database.
 * @param targetLanguageId The studied language's ISO 639-1 code.
 * @param instructionLanguageId The language the prompt text is written in.
 * @returns The stored prompts for that pair.
 */
export async function ensurePromptsSeeded(
	db: IDatabaseAdapter,
	targetLanguageId: string,
	instructionLanguageId: string
): Promise<Prompt[]> {
	const language = requireLanguage(targetLanguageId);
	const instructionLanguage = getInstructionLanguage(instructionLanguageId);

	const existing = await db.listPrompts(language.id, instructionLanguage.id);
	if (existing.length > 0) return existing;

	const seeds = await promptCatalogueCore(instructionLanguage.id, language.id);
	if (seeds.length === 0) return [];

	const now = new Date().toISOString();
	for (const seed of seeds) {
		await db.putPrompt({
			id: seed.id,
			title: seed.title,
			text: seed.text,
			category: seed.category ?? null,
			language: language.id,
			instructionLanguage: instructionLanguage.id,
			createdAt: now
		});
	}
	return db.listPrompts(language.id, instructionLanguage.id);
}

/**
 * The English prompts as a last resort when nothing could be written or found
 * in the learner's language of instruction.
 *
 * @param db The open database.
 * @param targetLanguageId The studied language's ISO 639-1 code.
 * @returns The English prompts stored for that target language.
 */
export function ensureEnglishPromptsSeeded(
	db: IDatabaseAdapter,
	targetLanguageId: string
): Promise<Prompt[]> {
	return ensurePromptsSeeded(db, targetLanguageId, DEFAULT_INSTRUCTION_LANGUAGE_ID);
}

/**
 * Picks one prompt at random, avoiding a repeat of the one on screen.
 *
 * @param prompts The candidates; must not be empty.
 * @param excludeId The prompt to avoid, usually the current one.
 * @returns The chosen prompt.
 * @throws When there are no candidates at all.
 */
export function pickRandomPrompt(prompts: Prompt[], excludeId?: string): Prompt {
	if (prompts.length === 0) {
		throw new Error('No prompts available.');
	}
	const candidates = prompts.length > 1 ? prompts.filter((prompt) => prompt.id !== excludeId) : prompts;
	return candidates[Math.floor(Math.random() * candidates.length)];
}
