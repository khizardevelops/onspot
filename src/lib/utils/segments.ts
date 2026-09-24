/**
 * Splits a transcript into sentence-sized segments for per-segment playback.
 *
 * Rules are intentionally simple and language-agnostic: split after `.!?…`
 * or their full-width Japanese forms `。！？` (and repetitions, e.g. `!?`),
 * keep the punctuation, and trim. Good enough to let a learner replay one
 * sentence of a longer answer.
 */
export function splitSentences(text: string): string[] {
	const matches = text.match(/[^.!?…。！？]+[.!?…。！？]+[\s]*|[^.!?…。！？]+$/g);
	if (!matches) return text.trim() ? [text.trim()] : [];
	return matches.map((segment) => segment.trim()).filter(Boolean);
}
