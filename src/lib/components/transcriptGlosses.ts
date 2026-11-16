// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextGlosses } from '#lib/adapters/db/index.js';

/**
 * True once the meaning of the word at `wordIndex` has been fetched (it may
 * still be blank: the model gave none). Meanings saved whole, before
 * sections, cover every word.
 */
export function hasMeaningAt(glosses: TextGlosses | null, wordIndex: number): boolean {
	if (!glosses) return false;
	if (!glosses.sections) return glosses.words.length > 0;
	return glosses.sections.some((section) => section.start <= wordIndex && wordIndex <= section.end);
}

/**
 * True when the word's part of speech was already asked for: it has a label,
 * or its section's POS request completed (the model may have left it blank).
 * Meanings fetched before POS existed, or with the setting off, are absent
 * here and are fetched again when the learner hovers with POS on.
 *
 * @param glosses The text's saved meanings, or null.
 * @param wordIndex The word (`glossWords` index).
 */
export function hasPartOfSpeechAt(glosses: TextGlosses | null, wordIndex: number): boolean {
	if (!glosses) return false;
	if (glosses.pos?.[wordIndex]?.trim()) return true;
	return (
		glosses.posSections?.some(
			(section) => section.start <= wordIndex && wordIndex <= section.end
		) ?? false
	);
}
