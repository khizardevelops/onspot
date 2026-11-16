// SPDX-License-Identifier: AGPL-3.0-or-later

/** Whole-database sync through the Rust core (P7). */

import {
	SyncError,
	type SyncChoice,
	type SyncComparison,
	type SyncDecision,
	type SyncProviderId
} from '#lib/adapters/sync/types.js';
import { getCoreClient } from './client.js';

/** The WebDAV settings, passed in because credentials live in the webview. */
export interface SyncWebdavTarget {
	baseUrl: string;
	path: string;
	username: string;
	password: string;
}

/** The destination the core should use for one command. */
export interface SyncTarget {
	provider: SyncProviderId;
	webdav?: SyncWebdavTarget;
}

/** What one core sync did. */
export interface SyncCoreOutcome {
	decision: SyncDecision;
	comparison: SyncComparison;
	completed: boolean;
	/** True after a download: the driver must record the restored revision. */
	replacedLocal: boolean;
}

function syncErrorFrom(error: unknown): SyncError {
	const message = error instanceof Error ? error.message : String(error);

	// The bridge reports the driver an expired authorization with a stable
	// code, which the client wraps into the message.
	return new SyncError(
		message.replace(/^sync\.[a-z_]+ failed: /, ''),
		/sync\.(reconnect_required|unauthorized)/.test(message)
	);
}

/**
 * Runs one whole-database sync in the core.
 *
 * @param target The configured destination.
 * @param revision This device's content revision before the transfer.
 * @param syncedRevision The revision last synced with this provider.
 * @param choice An explicit learner choice after a conflict.
 * @returns The decision, the comparison and whether anything was written.
 */
export async function syncNowCore(
	target: SyncTarget,
	revision: number,
	syncedRevision: number | null,
	choice?: SyncChoice
): Promise<SyncCoreOutcome> {
	const client = await getCoreClient();

	try {
		return await client.command<SyncCoreOutcome>('sync.now', {
			...target,
			revision,
			syncedRevision,
			choice: choice ?? null
		});
	} catch (error) {
		throw syncErrorFrom(error);
	}
}

/**
 * Runs the provider's authorization flow through the core.
 *
 * @param target The configured destination.
 * @returns The connected account's display label.
 */
export async function connectSyncCore(target: SyncTarget): Promise<{ label: string }> {
	const client = await getCoreClient();

	try {
		return await client.command<{ label: string }>('sync.connect', target);
	} catch (error) {
		throw syncErrorFrom(error);
	}
}

/**
 * Reports the connected account for a destination.
 *
 * @param target The configured destination.
 * @returns The label, or null when this device must connect again.
 */
export async function accountSyncCore(
	target: SyncTarget
): Promise<{ label: string | null }> {
	const client = await getCoreClient();

	try {
		return await client.command<{ label: string | null }>('sync.account', target);
	} catch (error) {
		throw syncErrorFrom(error);
	}
}

/**
 * Forgets this device's authorization for a destination.
 *
 * @param target The configured destination.
 */
export async function disconnectSyncCore(target: SyncTarget): Promise<void> {
	const client = await getCoreClient();

	try {
		await client.command('sync.disconnect', target);
	} catch (error) {
		throw syncErrorFrom(error);
	}
}
