import type { Correction } from '$lib/adapters/db';

export function isDeletion(correction: Pick<Correction, 'original' | 'replacement'>): boolean {
	return Boolean(correction.original.trim()) && !correction.replacement.trim();
}

export function isInsertion(correction: Pick<Correction, 'original' | 'replacement'>): boolean {
	return !correction.original.trim() && Boolean(correction.replacement.trim());
}

/**
 * LLMs occasionally repeat structural metadata in a human label (for example
 * "Register inappropriate"). Category and severity already have dedicated UI,
 * so strip that noise and provide an action-oriented fallback.
 */
export function correctionTitle(correction: Correction): string {
	if (isDeletion(correction)) {
		return correction.original.trim().includes(' ') ? 'Omit this phrase' : 'Omit this word';
	}
	if (isInsertion(correction)) return 'Add the missing phrase';

	let label = correction.label.trim();
	const redundant = /^(grammar|register|filler(?:\s+word)?|style|error|warning|suggestion|correction)\s*[:·—–-]?\s*/i;
	for (let pass = 0; pass < 3 && redundant.test(label); pass++) label = label.replace(redundant, '');

	if (!label || /^(issue|inappropriate|incorrect|mistake)$/i.test(label)) {
		if (correction.category === 'grammar') return 'Grammar fix';
		if (correction.category === 'register') return 'Better fit for this context';
		if (correction.category === 'filler') return 'Smoother delivery';
		return 'More natural phrasing';
	}
	if (/^vocabulary$/i.test(label)) return 'Stronger word choice';
	if (/^connector$/i.test(label)) return 'Smoother connection';
	return label;
}
