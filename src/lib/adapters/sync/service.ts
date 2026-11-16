// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { syncNowCore, type SyncTarget } from '#lib/core-client/sync.js';
import { appSettings } from '#lib/stores/settings.js';
import { webdavPassword, webdavUsername } from '#lib/stores/secrets.js';
import {
	SyncError,
	type RemoteFile,
	type SyncChoice,
	type SyncProvider,
	type SyncResult
} from './types.js';

/**
 * Runs a whole-database snapshot sync.
 *
 * Both sides are compared before anything is written. An upload is
 * non-destructive; a download replaces the local database and therefore always
 * needs an explicit `download` choice.
 */

type ProgressCallback = (message: string) => void;

let activeSync: Promise<SyncResult> | null = null;

/**
 * Compares this device with the remote snapshot, then uploads, downloads, or asks.
 *
 * @param provider The configured cloud provider.
 * @param choice Explicit learner choice for a conflict. Omit it on the first
 *   call; supply `upload` or `download` after the comparison is shown.
 * @param onProgress Receives short status lines for the UI.
 * @returns The decision, the comparison, and whether anything was written.
 */
export function syncNow(
	provider: SyncProvider,
	choice?: SyncChoice,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	if (activeSync) {
		return Promise.reject(new SyncError('A sync is already running.'));
	}

	const running = runSync(provider, choice, onProgress).finally(() => {
		activeSync = null;
	});

	activeSync = running;
	return running;
}

function syncTargetOf(provider: SyncProvider): SyncTarget {
	if (provider.id === 'google-drive') return { provider: 'google-drive' };

	const settings = get(appSettings);

	return {
		provider: 'webdav',
		webdav: {
			baseUrl: settings.webdavUrl.trim(),
			path: settings.webdavPath.trim(),
			username: get(webdavUsername),
			password: get(webdavPassword)
		}
	};
}

async function runSyncThroughCore(
	provider: SyncProvider,
	choice: SyncChoice | undefined,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	onProgress?.('Checking the cloud backup…');
	const outcome = await syncNowCore(syncTargetOf(provider), choice);

	return {
		decision: outcome.decision,
		comparison: outcome.comparison,
		completed: outcome.completed
	};
}

async function runSync(
	provider: SyncProvider,
	choice: SyncChoice | undefined,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	return runSyncThroughCore(provider, choice, onProgress);
}
