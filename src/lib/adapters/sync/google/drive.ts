// SPDX-License-Identifier: AGPL-3.0-or-later

import { connectSyncCore, disconnectSyncCore } from '#lib/core-client/sync.js';
import {
	disconnectGoogleDrive,
	googleAccount
} from './oauth.js';
import { type SyncAccount, type SyncProvider } from '../types.js';

/**
 * Google Drive storage in the app-private `appDataFolder`.
 *
 * The transfer itself lives in the core (`sync.now`, reusing the shared
 * `HttpClient` port); this driver-side provider only forwards the account
 * actions, because the OAuth tokens stay in the webview.
 */
export class GoogleDriveProvider implements SyncProvider {
	readonly id = 'google-drive' as const;
	readonly label = 'Google Drive';

	getAccount(): SyncAccount | null {
		return googleAccount();
	}

	connect(): Promise<SyncAccount> {
		return connectSyncCore({ provider: 'google-drive' });
	}

	async disconnect(): Promise<void> {
		await disconnectSyncCore({ provider: 'google-drive' });
		disconnectGoogleDrive();
	}
}
