// SPDX-License-Identifier: AGPL-3.0-or-later

/** A download or storage size for people: `1.2 GB`, `63 MB`, `512 KB` (decimal units, as stores and networks count). */
export function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
	return `${Math.round(bytes / 1_000)} KB`;
}
