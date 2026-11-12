// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One initialised core client per page.
 *
 * The first feature that needs the bridge boots it (the wasm package or the
 * Tauri commands) and every later caller shares the same client, event sink and
 * database connection. A failed boot is not cached, so switching the backend or
 * loading a missing wasm package can be retried without a reload.
 */

import { createCoreClient, type CoreClient } from './transport';

let booting: Promise<CoreClient> | null = null;

/** Boots the core once and returns the shared client. */
export function getCoreClient(): Promise<CoreClient> {
	if (!booting) {
		booting = (async () => {
			const client = createCoreClient();
			await client.init();
			return client;
		})().catch((error: unknown) => {
			booting = null;
			throw error;
		});
	}
	return booting;
}

/** Drops the cached client. Tests and full reloads only. */
export function resetCoreClient(): void {
	booting = null;
}
