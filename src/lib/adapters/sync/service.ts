// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDatabaseAdapter, type SyncMetadata } from '#lib/adapters/db/index.js';
import { currentRevision, getSyncedRevision, setSyncedRevision } from '#lib/adapters/db/revision.js';
import { importSqliteBytes } from '#lib/utils/export.js';
import {
	SyncError,
	type RemoteFile,
	type SyncChoice,
	type SyncComparison,
	type SyncDecision,
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

/**
 * Decides what a sync should do without performing any I/O.
 *
 * @param comparison Current local/remote state.
 * @returns `up-to-date`, a safe automatic `upload`, or `needs-choice`.
 */
export function decideSync(comparison: SyncComparison): SyncDecision {
	// No remote file: uploading creates it and cannot lose local data.
	if (!comparison.remote) return 'upload';

	// A remote file this device has never synced with: the two databases were
	// created independently, so neither side is safe to pick automatically.
	if (!comparison.lastSyncedAt) return 'needs-choice';

	if (comparison.hasLocalChanges && comparison.hasRemoteChanges) return 'needs-choice';
	if (comparison.hasLocalChanges) return 'upload';
	if (comparison.hasRemoteChanges) return 'needs-choice';

	return 'up-to-date';
}

function compareSync(
	metadata: SyncMetadata | null,
	remote: RemoteFile | null,
	revision: number,
	syncedRevision: number | null
): SyncComparison {
	const hasLocalChanges = syncedRevision === null || syncedRevision !== revision;
	const hasRemoteChanges = remote
		? !metadata?.etag || metadata.etag !== remote.etag
		: Boolean(metadata?.remoteFileId);

	return {
		localRevision: revision,
		syncedRevision,
		localSize: null,
		remote,
		lastSyncedAt: metadata?.lastSyncedAt ?? null,
		hasLocalChanges,
		hasRemoteChanges
	};
}

async function rememberSync(
	provider: SyncProvider,
	remote: RemoteFile,
	revision: number
): Promise<void> {
	const database = await getDatabaseAdapter();
	const now = new Date().toISOString();

	await database.setSyncMetadata({
		provider: provider.id,
		remoteFileId: remote.id,
		etag: remote.etag,
		lastSyncedAt: now,
		cursor: String(revision),
		updatedAt: now
	});

	setSyncedRevision(provider.id, revision);
}

async function uploadSnapshot(
	provider: SyncProvider,
	remote: RemoteFile | null,
	comparison: SyncComparison,
	revision: number,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	onProgress?.('Preparing this device’s backup…');

	const database = await getDatabaseAdapter();
	const localBytes = await database.exportSqliteFile();

	onProgress?.('Uploading this device’s backup…');

	const uploaded = await provider.upload(localBytes, remote);
	await rememberSync(provider, uploaded, revision);

	return {
		decision: 'upload',
		completed: true,
		comparison: {
			...comparison,
			localSize: localBytes.byteLength,
			remote: uploaded,
			syncedRevision: revision,
			hasLocalChanges: false,
			hasRemoteChanges: false,
			lastSyncedAt: new Date().toISOString()
		}
	};
}

async function downloadSnapshot(
	provider: SyncProvider,
	remote: RemoteFile | null,
	comparison: SyncComparison,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	if (!remote) {
		throw new SyncError('There is no cloud backup to download yet. Upload this device first.');
	}

	onProgress?.('Downloading the cloud backup…');
	const cloudBytes = await provider.download(remote);

	onProgress?.('Replacing this device’s database…');
	await importSqliteBytes(cloudBytes);

	// The import is a content write, so the restored database has a new
	// revision. Mark exactly that revision as synced.
	const revision = currentRevision();
	await rememberSync(provider, remote, revision);

	return {
		decision: 'download',
		completed: true,
		comparison: {
			...comparison,
			localRevision: revision,
			syncedRevision: revision,
			localSize: cloudBytes.byteLength,
			remote,
			hasLocalChanges: false,
			hasRemoteChanges: false,
			lastSyncedAt: new Date().toISOString()
		}
	};
}

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

async function runSync(
	provider: SyncProvider,
	choice: SyncChoice | undefined,
	onProgress?: ProgressCallback
): Promise<SyncResult> {
	const database = await getDatabaseAdapter();
	const metadata = await database.getSyncMetadata(provider.id);
	const remote = await provider.getRemote();

	// Capture the revision before exporting or uploading. A write that happens
	// during the transfer then makes the next comparison see unsynced content.
	const revision = currentRevision();
	const comparison = compareSync(
		metadata,
		remote,
		revision,
		getSyncedRevision(provider.id)
	);
	const decision = decideSync(comparison);

	if (!choice) {
		if (decision === 'up-to-date' || decision === 'needs-choice') {
			return { decision, comparison, completed: false };
		}

		return uploadSnapshot(provider, remote, comparison, revision, onProgress);
	}

	if (choice === 'download') {
		return downloadSnapshot(provider, remote, comparison, onProgress);
	}

	return uploadSnapshot(provider, remote, comparison, revision, onProgress);
}
