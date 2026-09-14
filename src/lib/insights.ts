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
 * by `category|label`, so "Elision" across ten sessions is one row.
 */
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
		if (correction.severity === 'error') totals.errors++;
		else if (correction.severity === 'warning') totals.warnings++;
		else totals.suggestions++;

		if (correction.category === 'style') continue;

		const key = `${correction.category}|${correction.label}`;
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
		const attempt = attemptById.get(correction.attemptId);
		const session = attempt ? sessionById.get(attempt.sessionId) : undefined;
		if (session && !pattern.sessionIds.includes(session.id)) pattern.sessionIds.push(session.id);
		if (attempt) pattern.occurrences.push({ session, attempt, correction });
	}

	return {
		totals,
		patterns: [...patterns.values()].sort(
			(a, b) => b.count - a.count || a.label.localeCompare(b.label)
		)
	};
}
