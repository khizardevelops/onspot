// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { isTauri } from '#lib/platform/runtime.js';
import { appSettings } from '#lib/stores/settings.js';
import { webdavPassword, webdavUsername } from '#lib/stores/secrets.js';
import { httpRequest, readErrorBody, requireOk } from './http.js';
import {
	SyncError,
	type RemoteFile,
	type SyncAccount,
	type SyncProvider
} from './types.js';

/**
 * A plain WebDAV destination: Nextcloud, ownCloud, pCloud and anything else
 * that speaks the protocol.
 *
 * The browser uses the `webdav` package and therefore needs the server to allow
 * this origin (CORS). The desktop and Android apps route the same requests
 * through the Tauri HTTP plugin, which has no browser origin policy.
 */

const SNAPSHOT_NAME = 'onspot.sqlite';
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:getlastmodified/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>`;

interface WebdavConfig {
	baseUrl: string;
	path: string;
	username: string;
	password: string;
}

interface WebdavStat {
	etag: string | null;
	lastModified: string | null;
	size: number | null;
}

interface WebdavTransport {
	/** Returns null when the file does not exist. */
	stat(): Promise<WebdavStat | null>;
	download(): Promise<Uint8Array>;
	upload(data: Uint8Array): Promise<WebdavStat>;
	/** Throws unless the destination is reachable and authorized. */
	test(): Promise<void>;
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

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

function relativePath(path: string): string {
	return path.replace(/^\/+/, '');
}

function parentPath(path: string): string {
	const segments = relativePath(path).split('/');
	segments.pop();
	return segments.join('/');
}

function joinUrl(baseUrl: string, path: string): string {
	return `${normalizeBaseUrl(baseUrl)}/${relativePath(path)}`;
}

function basicAuthorization(username: string, password: string): string {
	const credentials = `${username}:${password}`;
	const bytes = new TextEncoder().encode(credentials);

	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return `Basic ${btoa(binary)}`;
}

function normalizeEtag(etag: string | null): string {
	if (!etag) return '';

	return etag.replace(/^W\//, '').replaceAll('"', '');
}

function statToRemoteFile(path: string, stat: WebdavStat): RemoteFile {
	const etag = normalizeEtag(stat.etag) || stat.lastModified || String(stat.size ?? '');

	return {
		id: path,
		name: path.split('/').pop() ?? SNAPSHOT_NAME,
		modifiedAt: stat.lastModified ?? new Date().toISOString(),
		etag,
		size: stat.size
	};
}

function isNotFound(error: unknown): boolean {
	const candidate = error as {
		status?: number;
		response?: { status?: number };
	};

	const status = candidate?.status ?? candidate?.response?.status;
	return status === 404;
}

function firstText(response: Element, tagName: string): string | null {
	const namespaced = response.getElementsByTagNameNS('DAV:', tagName)[0];
	if (namespaced?.textContent) return namespaced.textContent.trim();

	const plain = response.getElementsByTagName(tagName)[0];
	return plain?.textContent?.trim() ?? null;
}

function parsePropfind(xml: string): WebdavStat {
	const document = new DOMParser().parseFromString(xml, 'application/xml');
	const response = document.getElementsByTagNameNS('DAV:', 'response')[0];

	if (!response) {
		throw new SyncError('The WebDAV server returned an unreadable response.');
	}

	const sizeText = firstText(response, 'getcontentlength');
	const size = sizeText ? Number(sizeText) : null;

	return {
		etag: firstText(response, 'getetag'),
		lastModified: firstText(response, 'getlastmodified'),
		size: size !== null && Number.isFinite(size) ? size : null
	};
}

/** WebDAV over the Tauri HTTP plugin: no CORS, arbitrary methods. */
class NativeWebdavTransport implements WebdavTransport {
	constructor(private readonly config: WebdavConfig) {}

	private url(): string {
		return joinUrl(this.config.baseUrl, this.config.path);
	}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		return {
			Authorization: basicAuthorization(this.config.username, this.config.password),
			...extra
		};
	}

	async stat(): Promise<WebdavStat | null> {
		const response = await httpRequest(this.url(), {
			method: 'PROPFIND',
			headers: this.headers({
				Depth: '0',
				'Content-Type': 'application/xml; charset=utf-8'
			}),
			body: PROPFIND_BODY
		});

		if (response.status === 404) return null;

		await requireOk(response, 'WebDAV lookup');
		return parsePropfind(await response.text());
	}

	async download(): Promise<Uint8Array> {
		const response = await httpRequest(this.url(), {
			method: 'GET',
			headers: this.headers()
		});

		await requireOk(response, 'WebDAV download');
		return new Uint8Array(await response.arrayBuffer());
	}

	async upload(data: Uint8Array): Promise<WebdavStat> {
		await this.ensureParent();

		const body = data.buffer.slice(
			data.byteOffset,
			data.byteOffset + data.byteLength
		) as ArrayBuffer;

		const response = await httpRequest(this.url(), {
			method: 'PUT',
			headers: this.headers({
				'Content-Type': 'application/vnd.sqlite3',
				'Content-Length': String(data.byteLength)
			}),
			body
		});

		await requireOk(response, 'WebDAV upload');

		const stat = await this.stat();
		if (!stat) {
			throw new SyncError('WebDAV accepted the upload but the backup could not be found.');
		}

		return stat;
	}

	async test(): Promise<void> {
		// A missing file is a reachable destination; an auth or network failure throws.
		await this.stat();
	}

	private async ensureParent(): Promise<void> {
		const parent = parentPath(this.config.path);
		if (!parent) return;

		const segments = parent.split('/');
		let current = '';

		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;

			const response = await httpRequest(joinUrl(this.config.baseUrl, current), {
				method: 'MKCOL',
				headers: this.headers()
			});

			// 405 means the collection already exists.
			if (!response.ok && response.status !== 405) {
				await requireOk(response, 'WebDAV folder creation');
			}
		}
	}
}

/** WebDAV through the `webdav` package, subject to the server's CORS policy. */
class BrowserWebdavTransport implements WebdavTransport {
	constructor(private readonly config: WebdavConfig) {}

	private async client() {
		const { createClient } = await import('webdav');

		return createClient(normalizeBaseUrl(this.config.baseUrl), {
			username: this.config.username,
			password: this.config.password
		});
	}

	async stat(): Promise<WebdavStat | null> {
		const client = await this.client();

		try {
			const stat = await client.stat(relativePath(this.config.path));
			// `details: true` wraps the result, but the option is not set here.
			const file = stat as unknown as {
				etag?: string;
				lastmod?: string;
				size?: number;
			};

			return {
				etag: file.etag ?? null,
				lastModified: file.lastmod ?? null,
				size: typeof file.size === 'number' ? file.size : null
			};
		} catch (error) {
			if (isNotFound(error)) return null;
			throw browserError(error);
		}
	}

	async download(): Promise<Uint8Array> {
		const client = await this.client();

		try {
			const contents = await client.getFileContents(relativePath(this.config.path), {
				format: 'binary'
			});

			return toBytes(contents);
		} catch (error) {
			throw browserError(error);
		}
	}

	async upload(data: Uint8Array): Promise<WebdavStat> {
		const client = await this.client();
		const body = data.buffer.slice(
			data.byteOffset,
			data.byteOffset + data.byteLength
		) as ArrayBuffer;

		const parent = parentPath(this.config.path);
		if (parent) {
			try {
				await client.createDirectory(parent, { recursive: true });
			} catch (error) {
				// 405 means the collection already exists.
				const status = (error as { status?: number })?.status;
				if (status !== 405) throw browserError(error);
			}
		}

		try {
			await client.putFileContents(relativePath(this.config.path), body, {
				overwrite: true
			});
		} catch (error) {
			throw browserError(error);
		}

		const stat = await this.stat();
		if (!stat) {
			throw new SyncError('WebDAV accepted the upload but the backup could not be found.');
		}

		return stat;
	}

	async test(): Promise<void> {
		await this.stat();
	}
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);

	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	throw new SyncError('The WebDAV server returned an unexpected response.');
}

function browserError(error: unknown): SyncError {
	if (error instanceof SyncError) return error;

	if (error instanceof TypeError) {
		return new SyncError(
			`Could not reach the WebDAV server from this browser. It may be offline, or its CORS policy may block this origin. The desktop app is not affected.`
		);
	}

	const status = (error as { status?: number })?.status;
	const message = error instanceof Error ? error.message : String(error);

	if (status === 401 || status === 403) {
		return new SyncError(`WebDAV rejected the username or password (HTTP ${status}).`, true);
	}

	return new SyncError(message || 'The WebDAV request failed.');
}

/** One configured WebDAV destination. */
export class WebdavProvider implements SyncProvider {
	readonly id = 'webdav' as const;
	readonly label = 'WebDAV';

	private transport(): WebdavTransport {
		const config = configOf();

		if (!config.baseUrl) {
			throw new SyncError('Add the WebDAV server URL in Settings first.');
		}

		if (!config.username) {
			throw new SyncError('Add the WebDAV username in Settings first.');
		}

		return isTauri()
			? new NativeWebdavTransport(config)
			: new BrowserWebdavTransport(config);
	}

	getAccount(): SyncAccount | null {
		const config = configOf();
		if (!config.baseUrl || !config.username) return null;

		try {
			return { label: new URL(config.baseUrl).host };
		} catch {
			return { label: config.baseUrl };
		}
	}

	async connect(): Promise<SyncAccount> {
		await this.transport().test();

		const account = this.getAccount();
		if (!account) {
			throw new SyncError('Add the WebDAV server URL and username first.');
		}

		return account;
	}

	disconnect(): Promise<void> {
		webdavUsername.set('');
		webdavPassword.set('');
		return Promise.resolve();
	}

	async getRemote(): Promise<RemoteFile | null> {
		const config = configOf();
		const stat = await this.transport().stat();

		return stat ? statToRemoteFile(config.path, stat) : null;
	}

	download(): Promise<Uint8Array> {
		return this.transport().download();
	}

	async upload(data: Uint8Array): Promise<RemoteFile> {
		const config = configOf();
		const stat = await this.transport().upload(data);

		return statToRemoteFile(config.path, stat);
	}
}
