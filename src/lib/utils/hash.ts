// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FNV-1a plus length: short, stable, collision-resistant enough for a cache or
 * bookkeeping key. Not a cryptographic hash.
 *
 * @param text Any string.
 * @returns Eight hex digits, a dash, and the length in base 36.
 */
export function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}
