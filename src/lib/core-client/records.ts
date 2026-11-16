// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Record reads and writes outside a practice run, through the core: a
 * session's setup, when the learner last practised, cached speech audio and a
 * sync provider's metadata. The driver never queries the database itself.
 */

import type { AudioAsset, SessionSetup, SyncMetadata } from '#lib/adapters/db/index.js';
import { getCoreClient } from './client.js';

/** The newest session and the setup it was practised with, or null before the first. */
export async function latestSessionSetup(): Promise<{ sessionId: string; setup: SessionSetup } | null> {
	const client = await getCoreClient();
	const latest = await client.command<{ sessionId: string | null; setup: SessionSetup | null }>(
		'sessions.latest_setup'
	);
	return latest.sessionId && latest.setup ? { sessionId: latest.sessionId, setup: latest.setup } : null;
}

/**
 * The setup a session opens with, saved on it when it changed.
 *
 * @param restore True to take the session's own setup; false to keep the settings.
 * @returns The setup, or null when no session has that id.
 */
export async function openSessionSetup(sessionId: string, restore: boolean): Promise<SessionSetup | null> {
	const client = await getCoreClient();
	const response = await client.command<{ setup: SessionSetup | null }>('sessions.open_setup', { sessionId, restore });
	return response.setup;
}

/** Saves a setup chosen while the session is open as its own. */
export async function saveSessionSetup(sessionId: string, setup: SessionSetup): Promise<void> {
	const client = await getCoreClient();
	await client.command('sessions.save_setup', { sessionId, setup, now: new Date().toISOString() });
}

/** When the learner last practised (ms since the epoch), or null before any practice. */
export async function lastPractisedAt(): Promise<number | null> {
	const client = await getCoreClient();
	const response = await client.command<{ atMs: number | null }>('reminders.last_practised');
	return response.atMs;
}

/** A cached speech clip, or null when nothing is stored under the key. */
export async function getAudio(key: string): Promise<AudioAsset | null> {
	const client = await getCoreClient();
	const response = await client.command<{ asset: AudioAsset | null }>('audio.get', { key });
	return response.asset;
}

/** Stores a speech clip under its key. */
export async function putAudio(asset: AudioAsset): Promise<void> {
	const client = await getCoreClient();
	await client.command('audio.put', { asset });
}

/** What this device last knew about a sync provider's copy, or null. */
export async function syncMetadata(provider: string): Promise<SyncMetadata | null> {
	const client = await getCoreClient();
	const response = await client.command<{ metadata: SyncMetadata | null }>('sync.metadata', { provider });
	return response.metadata;
}
