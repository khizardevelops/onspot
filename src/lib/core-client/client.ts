// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One initialised core client per page.
 *
 * The first feature that needs the bridge boots it (the wasm package or the
 * Tauri commands) and every later caller shares the same client, event sink and
 * database connection. A failed boot is not cached, so switching the backend or
 * loading a missing wasm package can be retried without a reload.
 */

import type { CoreHost } from './coreHost';
import type { UiEvent } from './types.gen';
import { createCoreClient, type CoreClient } from './transport';

let booting: Promise<CoreClient> | null = null;
let host: CoreHost | null = null;

/**
 * Performs a core `host_request` with the driver-side adapters and replies.
 *
 * Every feature that reaches the core needs this, not only practice: sync
 * moves bytes through `http.sync`, export/restore use `fs.*`, language
 * downloads fetch weights, and Drive asks for an `oauth.*` token. Installing
 * the handler with the client (below) means a page that only opens Settings
 * can still sync.
 */
async function handleHostRequest(
	client: CoreClient,
	coreHost: CoreHost,
	event: Extract<UiEvent, { event: 'host_request' }>
): Promise<void> {
	try {
		const payload = JSON.parse(event.payload) as unknown;
		const result = await coreHost.handle(event.method, payload);
		await client.command('core.host_reply', { id: event.id, result });
	} catch (error) {
		const failure = error as { code?: unknown };
		await client
			.command('core.host_reply', {
				id: event.id,
				error: {
					code: typeof failure.code === 'string' ? failure.code : 'core.host_failed',
					message: error instanceof Error ? error.message : String(error)
				}
			})
			.catch(() => undefined);
	}
}

/**
 * Loads the driver host and wires it to the client's event stream.
 *
 * The import is dynamic so this module stays free of the speech, LLM and
 * database modules that the host needs; they load only when a core feature
 * boots, which is when the host is first required.
 */
async function installHost(client: CoreClient): Promise<CoreHost> {
	const { createCoreHost } = await import('./coreHost');
	const coreHost = createCoreHost(client);

	client.subscribe((event) => {
		if (event.event !== 'host_request') return;
		void handleHostRequest(client, coreHost, event);
	});

	return coreHost;
}

/** Boots the core once and returns the shared client. */
export function getCoreClient(): Promise<CoreClient> {
	if (!booting) {
		booting = (async () => {
			const client = createCoreClient();
			await client.init();
			host = await installHost(client);
			return client;
		})().catch((error: unknown) => {
			booting = null;
			host = null;
			throw error;
		});
	}
	return booting;
}

/**
 * Returns the driver host that answers the core's `host_request` events.
 *
 * Callers that drive an interactive flow (practice recording, language-data
 * cancel) keep it for their own cancellation.
 */
export async function getCoreHost(): Promise<CoreHost> {
	await getCoreClient();
	if (!host) throw new Error('The core host is not available.');
	return host;
}

/** Drops the cached client. Tests and full reloads only. */
export function resetCoreClient(): void {
	booting = null;
	host = null;
}
