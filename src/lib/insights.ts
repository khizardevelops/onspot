import type {
	Attempt,
	Correction,
	CorrectionCategory,
	CorrectionSeverity,
	Session
} from '$lib/adapters/db';

export interface Occurrence {
	session: Session | undefined;
	attempt: Attempt;
	correction: Correction;
}

export interface Pattern {
	key: string;
	label: string;
	category: CorrectionCategory;
	severity: CorrectionSeverity;
	count: number;
	sessionIds: string[];
	occurrences: Occurrence[];
}

export interface InsightsTotals {
	sessions: number;
	attempts: number;
	words: number;
	speakingSeconds: number;
	errors: number;
	warnings: number;
	suggestions: number;
}

export interface InsightsData {
	totals: InsightsTotals;
	patterns: Pattern[];
}

/**
 * Aggregates all attempts into session totals and recurring patterns.
 *
 * Style suggestions are excluded from the pattern list (as in the prototype):
 * they are optional polish, not mistakes to drill. Everything else is grouped
 * by `category|label` (case- and spacing-insensitive, since the LLM writes the
 * label), so "Elision" and "elision" across ten sessions are one row.
 *
 * Corrections whose attempt no longer exists are ignored everywhere, so the
 * totals, a pattern's count and its listed occurrences always agree.
 */
/** Lower is more severe. */
export const SEVERITY_RANK: Record<CorrectionSeverity, number> = { error: 0, warning: 1, suggestion: 2 };

export function computeInsights(
	sessions: Session[],
	attempts: Attempt[],
	corrections: Correction[]
): InsightsData {
	const sessionById = new Map(sessions.map((session) => [session.id, session]));
	const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));

	const totals: InsightsTotals = {
		sessions: sessions.length,
		attempts: attempts.length,
		words: attempts.reduce((sum, attempt) => sum + attempt.wordCount, 0),
		speakingSeconds: attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0),
		errors: 0,
		warnings: 0,
		suggestions: 0
	};

	const patterns = new Map<string, Pattern>();

	for (const correction of corrections) {
		const attempt = attemptById.get(correction.attemptId);
		if (!attempt) continue;
		if (correction.severity === 'error') totals.errors++;
		else if (correction.severity === 'warning') totals.warnings++;
		else totals.suggestions++;

		if (correction.category === 'style') continue;

		const key = `${correction.category}|${correction.label.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
		let pattern = patterns.get(key);
		if (!pattern) {
			pattern = {
				key,
				label: correction.label,
				category: correction.category,
				severity: correction.severity,
				count: 0,
				sessionIds: [],
				occurrences: []
			};
			patterns.set(key, pattern);
		}

		pattern.count++;
		// A group is as severe as its worst occurrence.
		if (SEVERITY_RANK[correction.severity] < SEVERITY_RANK[pattern.severity]) {
			pattern.severity = correction.severity;
		}
		const session = sessionById.get(attempt.sessionId);
		if (session && !pattern.sessionIds.includes(session.id)) pattern.sessionIds.push(session.id);
		pattern.occurrences.push({ session, attempt, correction });
	}

	// Newest first inside a pattern, so its detail view starts with recent work.
	for (const pattern of patterns.values()) {
		pattern.occurrences.sort((a, b) => Date.parse(b.attempt.createdAt) - Date.parse(a.attempt.createdAt));
	}

	return {
		totals,
		patterns: [...patterns.values()].sort(
			(a, b) => b.count - a.count || a.label.localeCompare(b.label)
		)
	};
}
