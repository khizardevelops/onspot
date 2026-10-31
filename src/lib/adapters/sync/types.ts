// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contracts for the BYOC sync adapters.
 *
 * Sync is whole-database snapshot based, matching export/import: each provider
 * moves one `.sqlite` image. A provider owns transport and authorization;
 * `service.ts` owns the conflict decision and every database write.
 */

/** A cloud destination the app can sync to. */
export type SyncProviderId = 'google-drive' | 'webdav';

/** The one remote file a provider keeps for this app. */
export interface RemoteFile {
	/** Provider identity: a Drive file id, or the WebDAV path. */
	id: string;
	name: string;
	/** Provider-reported modification time, ISO 8601. */
	modifiedAt: string;
	/** Drive `md5Checksum`, or a WebDAV `getetag`. Used to detect remote edits. */
	etag: string;
	size: number | null;
}

/** Human-readable connection state shown in Settings. */
export interface SyncAccount {
	label: string;
}

/** Transport and authorization for one cloud provider. */
export interface SyncProvider {
	readonly id: SyncProviderId;
	readonly label: string;
	/** Returns null when this device has no usable authorization yet. */
	getAccount(): SyncAccount | null;
	/** Runs the provider's authorization flow and returns the connected account. */
	connect(): Promise<SyncAccount>;
	/** Forgets this device's authorization. Remote data is untouched. */
	disconnect(): Promise<void>;
	/** Returns the current remote snapshot, or null when none exists yet. */
	getRemote(): Promise<RemoteFile | null>;
	/** Downloads the remote snapshot bytes. */
	download(remote: RemoteFile): Promise<Uint8Array>;
	/** Creates or replaces the remote snapshot and returns its new metadata. */
	upload(data: Uint8Array, remote: RemoteFile | null): Promise<RemoteFile>;
}

/** What the learner is asked to choose when both sides changed. */
export type SyncChoice = 'upload' | 'download';

/** What `syncNow` did, or needs the learner to decide. */
export type SyncDecision = 'up-to-date' | 'upload' | 'download' | 'needs-choice';

/** Both sides of the comparison, kept for the conflict dialog. */
export interface SyncComparison {
	/** This device's content revision at comparison time. */
	localRevision: number;
	/** The revision last synced with this provider, or null if never. */
	syncedRevision: number | null;
	/** Known only after an upload or download, when the snapshot is in memory. */
	localSize: number | null;
	remote: RemoteFile | null;
	lastSyncedAt: string | null;
	hasLocalChanges: boolean;
	hasRemoteChanges: boolean;
}

/** The outcome of one sync attempt. */
export interface SyncResult {
	decision: SyncDecision;
	comparison: SyncComparison;
	/** True only when the local or remote database was actually written. */
	completed: boolean;
}

/**
 * A sync failure whose message can be shown to the learner as-is.
 * `needsReconnect` tells the UI to offer the provider's Connect action again.
 */
export class SyncError extends Error {
	constructor(
		message: string,
		readonly needsReconnect = false
	) {
		super(message);
		this.name = 'SyncError';
	}
}
