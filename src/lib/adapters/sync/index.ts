// SPDX-License-Identifier: AGPL-3.0-or-later

import { GoogleDriveProvider } from './google/drive.js';
import { WebdavProvider } from './webdav.js';
import type { SyncProvider, SyncProviderId } from './types.js';

export * from './types.js';
export { decideSync, syncNow } from './service.js';

/**
 * Builds the provider for a configured destination.
 *
 * @param id Provider id from settings.
 * @returns The provider, or null when sync is off.
 */
export function createSyncProvider(id: SyncProviderId | 'off'): SyncProvider | null {
	switch (id) {
		case 'google-drive':
			return new GoogleDriveProvider();
		case 'webdav':
			return new WebdavProvider();
		default:
			return null;
	}
}
