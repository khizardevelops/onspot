// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Repairs for the small slips models make in otherwise complete JSON replies.
 * Groq validates JSON-mode replies itself and rejects the whole reply with
 * `json_validate_failed` over a single stray character (GPT-OSS was seen to
 * write `…}]"}}`), handing the text back as `failed_generation`; local servers
 * pass such replies straight through. A general-purpose repair library
 * (jsonrepair) reads that stray quote as the start of a new key and fails, so
 * the known slips are fixed here, narrowly, and anything else is left to a
 * retry.
 */

/** A quote stranded between two closing brackets: `]"}`, `}"}`, `]"]`, `}"]`. */
const STRAY_QUOTE_BETWEEN_CLOSERS = /([\]}])\s*"(?=\s*[\]}])/g;

/** A comma right before a closing bracket: `[1, 2,]`, `{"a": 1,}`. */
const TRAILING_COMMA = /,(?=\s*[\]}])/g;

function parses(text: string): boolean {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Returns `text` as valid JSON text: unchanged if it already parses, or with
 * the known slips fixed if that makes it parse.
 *
 * @param text A model's JSON reply.
 * @returns The parsable JSON text, or null when it cannot be repaired.
 */
export function repairJson(text: string): string | null {
	if (parses(text)) return text;

	const repaired = text.replace(STRAY_QUOTE_BETWEEN_CLOSERS, '$1').replace(TRAILING_COMMA, '');
	return parses(repaired) ? repaired : null;
}
