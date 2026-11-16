// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { appSettings } from '#lib/stores/settings.js';
import { webdavPassword, webdavUsername } from '#lib/stores/secrets.js';
import { connectSyncCore, disconnectSyncCore, type SyncTarget } from '#lib/core-client/sync.js';
import { type SyncAccount, type SyncProvider } from './types.js';

/**
 * A plain WebDAV destination: Nextcloud, ownCloud, pCloud and anything else
 * that speaks the protocol.
 *
 * The transfer itself lives in the core (`SyncProvider` behind `sync.now`);
 * this driver-side provider only builds the target from Settings and forwards
 * the account actions.
 */

const SNAPSHOT_NAME = 'onspot.sqlite';

interface WebdavConfig {
	baseUrl: string;
	path: string;
	username: string;
	password: string;
}

function configOf(): WebdavConfig {
	const settings = get(appSettings);

	return {
		baseUrl: settings.webdavUrl.trim(),
		path: settings.webdavPath.trim() || `/${SNAPSHOT_NAME}`,
		username: get(webdavUsername),
		password: get(webdavPassword)
	};
}

/** One configured WebDAV destination. */
export class WebdavProvider implements SyncProvider {
	readonly id = 'webdav' as const;
	readonly label = 'WebDAV';

	getAccount(): SyncAccount | null {
		const config = configOf();
		if (!config.baseUrl || !config.username) return null;

		try {
			return { label: new URL(config.baseUrl).host };
		} catch {
			return { label: config.baseUrl };
		}
	}

	private target(): SyncTarget {
		const config = configOf();

		return {
			provider: 'webdav',
			webdav: {
				baseUrl: config.baseUrl,
				path: config.path,
				username: config.username,
				password: config.password
			}
		};
	}

	async connect(): Promise<SyncAccount> {
		return connectSyncCore(this.target());
	}

	async disconnect(): Promise<void> {
		await disconnectSyncCore(this.target());
		webdavUsername.set('');
		webdavPassword.set('');
	}
}
