// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which implementation drives the app while the Rust core is being built up
 * (decision: `docs/architecture/adr/002-core-backend-toggle.md`).
 *
 * `legacy` is today's TypeScript path; `core` sends the features whose parity
 * gates have passed through the bridge. The global switch only enables a
 * feature that is also on the allowlist below, so a half-migrated screen cannot
 * be sent to the core by a stray environment value.
 *
 * This is the only module that reads `VITE_CORE_BACKEND`.
 */

import { browser } from '$app/env';

/** The two implementations a feature can run on. */
export type CoreBackend = 'legacy' | 'core';

/** Features with a bridge implementation. Grows one commit at a time. */
export type CoreFeature = 'probe' | 'settings' | 'history' | 'practice';

const STORAGE_KEY = 'onspot.core-backend.v1';

/**
 * Features whose Rust path has passed its parity gates. P1 had the probe; P2
 * adds settings and history after their gates (data compatibility on both
 * drivers, search parity, secrets regression) passed.
 */
const FEATURES_WITH_CORE: ReadonlySet<CoreFeature> = new Set<CoreFeature>([
	'probe',
	'settings',
	'history',
	'practice'
]);

function isBackend(value: unknown): value is CoreBackend {
	return value === 'legacy' || value === 'core';
}

/**
 * Reads the build-time default. Empty means `core` since P2 (settings and
 * history flipped after their gates); `legacy` remains selectable through the
 * environment or this browser's override. A typo fails loudly rather than
 * silently running the old path.
 */
function fromEnvironment(value: string | undefined): CoreBackend {
	if (value === undefined || value === '') return 'core';
	if (isBackend(value)) return value;

	throw new Error(`VITE_CORE_BACKEND must be "legacy" or "core" (got "${value}").`);
}

/**
 * Resolves the active backend. A value stored in this browser wins over the
 * build default, for comparing the two paths without rebuilding.
 *
 * @param environment The build-time value, injectable for tests.
 * @param stored The browser override, injectable for tests.
 * @returns `legacy` unless something valid asks for `core`.
 */
export function resolveCoreBackend(
	environment: string | undefined = import.meta.env.VITE_CORE_BACKEND,
	stored: string | null = browser ? localStorage.getItem(STORAGE_KEY) : null
): CoreBackend {
	if (isBackend(stored)) return stored;
	return fromEnvironment(environment);
}

/** The backend this page load uses. */
export const coreBackend: CoreBackend = resolveCoreBackend();

/**
 * Whether `feature` should run on the Rust core right now: it must be on the
 * allowlist and the backend must be `core`.
 *
 * @param feature A feature that has or is gaining a bridge implementation.
 * @returns True when the caller should use `CoreClient` for it.
 */
export function useCore(feature: CoreFeature): boolean {
	return FEATURES_WITH_CORE.has(feature) && coreBackend === 'core';
}
