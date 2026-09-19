import type { IDatabaseAdapter, Prompt } from '$lib/adapters/db';
import { requireLanguage, type LanguagePrompt } from '$lib/languages';

export type SeedPrompt = LanguagePrompt;

/**
 * Prompts are owned by the language registry so adding a language adds its
 * opening prompt set. They are written to the database once per language.
 */
export async function ensurePromptsSeeded(
	db: IDatabaseAdapter,
	languageId: string
): Promise<Prompt[]> {
	const language = requireLanguage(languageId);
	const existing = await db.listPrompts(language.id);
	if (existing.length === 0) {
		const now = new Date().toISOString();
		for (const seed of language.prompts) {
			await db.putPrompt({
				id: newId(),
				title: seed.title,
				text: seed.text,
				category: null,
				language: language.id,
				createdAt: now
			});
		}
		return db.listPrompts(language.id);
	}
	return existing;
}

function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pickRandomPrompt(prompts: Prompt[], excludeId?: string): Prompt {
	if (prompts.length === 0) {
		throw new Error('No prompts available.');
	}
	const candidates = prompts.length > 1 ? prompts.filter((p) => p.id !== excludeId) : prompts;
	return candidates[Math.floor(Math.random() * candidates.length)];
}
