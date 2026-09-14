import type { IDatabaseAdapter, Prompt } from '$lib/adapters/db';

export interface SeedPrompt {
	title: string;
	text: string;
}

/**
 * Opening prompt set, taken from the prototype. Deliberately small and varied;
 * the LLM is not used to generate prompts yet.
 */
export const SEED_PROMPTS: SeedPrompt[] = [
	{ title: 'Morning routine', text: 'Describe your morning routine.' },
	{ title: 'Favorite city', text: 'Talk about your favorite city.' },
	{ title: 'Last weekend', text: 'What did you do last weekend?' },
	{ title: 'Influential person', text: 'Describe a person who influenced you.' },
	{ title: 'A book that changed me', text: 'Talk about a book that changed your perspective.' },
	{ title: 'A free year', text: 'What would you do with a free year?' },
	{ title: 'A memorable meal', text: "Describe a meal you'll never forget." },
	{ title: 'A recent change', text: 'Talk about a recent change in your life.' }
];

function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Writes the seed prompts once, if the table is empty. Returns all prompts. */
export async function ensurePromptsSeeded(db: IDatabaseAdapter): Promise<Prompt[]> {
	const existing = await db.listPrompts();
	if (existing.length === 0) {
		const now = new Date().toISOString();
		for (const seed of SEED_PROMPTS) {
			await db.putPrompt({
				id: newId(),
				title: seed.title,
				text: seed.text,
				category: null,
				createdAt: now
			});
		}
		return db.listPrompts();
	}
	return existing;
}

export function pickRandomPrompt(prompts: Prompt[], excludeId?: string): Prompt {
	if (prompts.length === 0) {
		throw new Error('No prompts available.');
	}
	const candidates = prompts.length > 1 ? prompts.filter((p) => p.id !== excludeId) : prompts;
	return candidates[Math.floor(Math.random() * candidates.length)];
}
