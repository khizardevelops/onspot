/**
 * Practice pacing and the LLM budget derived from it.
 *
 * A learner speaks for at most 60s. Conversational French runs ~120-150 wpm and
 * fast speakers reach ~180-200, so a liberal ceiling for a 60s answer is ~240
 * words (200 wpm + 20% headroom). That number is the cap: transcripts longer
 * than it are truncated before evaluation, and the LLM output budget is sized
 * so the whole response (corrected text, natural speech, English translation,
 * summary and corrections) fits with margin.
 */
export const MAX_RECORDING_SEC = 60;
export const FAST_WORDS_PER_MINUTE = 200;
export const MAX_ATTEMPT_WORDS = Math.round((FAST_WORDS_PER_MINUTE * MAX_RECORDING_SEC) / 60 * 1.2);

/**
 * Every returned text field mirrors the transcript: correctedText,
 * naturalSpeech, and three translation styles all scale with it, plus a short
 * summary and a correction list (each with its own replacement translation).
 * That is roughly 12-13 output tokens per spoken word, so 240 words -> ~3072
 * tokens. Requesting more than necessary is what tripped low
 * output-tokens-per-minute provider limits.
 */
export const MAX_EVALUATION_TOKENS = 3072;

/** Counts words the same way the UI does (apostrophes/hyphens stay one word). */
export function countWords(text: string): number {
	return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** Truncates a transcript to the liberal word cap (rarely reached in practice). */
export function capWords(text: string, maxWords = MAX_ATTEMPT_WORDS): string {
	const tokens = text.match(/\S+/g) ?? [];
	if (tokens.length <= maxWords) return text;
	return tokens.slice(0, maxWords).join(' ');
}
