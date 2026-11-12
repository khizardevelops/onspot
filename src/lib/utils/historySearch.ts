// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The history screen's search matcher.
 *
 * Extracted from the page in P2 so `bun run golden:capture` can pin the Rust
 * port against today's behaviour. The page's derived `matcher` and this
 * function must stay identical: literal text is escaped, regex mode is used as
 * written, and the expression is case-insensitive unless asked otherwise.
 */

/** The UI's matcher shape: a non-global expression, or a compile error. */
export interface HistoryMatcher {
	re: RegExp | null;
	error: string;
}

/** Escapes the characters JavaScript's `RegExp` treats specially. */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a query. An empty (or whitespace-only) query has no matcher.
 *
 * @param query The learner's search text.
 * @param options `regex` uses the text as an expression; `caseSensitive` drops the `i` flag.
 */
export function compileMatcher(
	query: string,
	options: { regex?: boolean; caseSensitive?: boolean } = {}
): HistoryMatcher {
	const raw = query.trim();
	if (!raw) return { re: null, error: '' };
	const source = options.regex ? raw : escapeRegExp(raw);
	try {
		return { re: new RegExp(source, options.caseSensitive ? '' : 'i'), error: '' };
	} catch (error) {
		return { re: null, error: error instanceof Error ? error.message : 'Invalid regular expression' };
	}
}
