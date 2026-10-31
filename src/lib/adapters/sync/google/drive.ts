// SPDX-License-Identifier: AGPL-3.0-or-later

import { httpRequest, requireOk } from '../http.js';
import {
	SyncError,
	type RemoteFile,
	type SyncAccount,
	type SyncProvider
} from '../types.js';
import {
	connectGoogleDrive,
	disconnectGoogleDrive,
	googleAccessToken,
	googleAccount
} from './oauth.js';

/**
 * Google Drive storage in the app-private `appDataFolder`.
 *
 * The backup is one resumable upload, because the database carries base64
 * audio and can exceed the simple-upload size limit.
 */

const FILE_NAME = 'onspot.sqlite';
const FILE_FIELDS = 'id,name,modifiedTime,size,md5Checksum';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SQLITE_MIME = 'application/vnd.sqlite3';

interface DriveFile {
	id: string;
	name: string;
	modifiedTime: string;
	size?: string;
	md5Checksum?: string;
}

function toRemoteFile(file: DriveFile): RemoteFile {
	return {
		id: file.id,
		name: file.name,
		modifiedAt: file.modifiedTime,
		// Drive always returns md5Checksum for a completed binary upload. The
		// modification time is a safe fallback if a proxy strips the checksum.
		etag: file.md5Checksum ?? file.modifiedTime,
		size: file.size ? Number(file.size) : null
	};
}

function withAuthorization(headers: HeadersInit | undefined, token: string): Headers {
	const authorized = new Headers(headers);
	authorized.set('Authorization', `Bearer ${token}`);
	return authorized;
}

/**
 * Adds the bearer token and retries once after a refreshed token.
 *
 * @param url Absolute Drive API URL.
 * @param init Request options.
 * @returns The provider response, including non-2xx statuses.
 */
async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
	const token = await googleAccessToken();
	const response = await httpRequest(url, {
		...init,
		headers: withAuthorization(init.headers, token)
	});

	if (response.status !== 401) return response;

	const refreshedToken = await googleAccessToken(true);
	return httpRequest(url, {
		...init,
		headers: withAuthorization(init.headers, refreshedToken)
	});
}

async function findRemoteFile(): Promise<RemoteFile | null> {
	const query = new URLSearchParams({
		spaces: 'appDataFolder',
		q: `name = '${FILE_NAME}' and trashed = false`,
		fields: `files(${FILE_FIELDS})`
	});

	const response = await authorizedFetch(`${FILES_URL}?${query.toString()}`);
	await requireOk(response, 'Google Drive lookup');

	const data = (await response.json()) as { files?: DriveFile[] };
	const file = data.files?.[0];

	return file ? toRemoteFile(file) : null;
}

async function downloadFile(remote: RemoteFile): Promise<Uint8Array> {
	const fileId = encodeURIComponent(remote.id);
	const response = await authorizedFetch(`${FILES_URL}/${fileId}?alt=media`);
	await requireOk(response, 'Google Drive download');

	return new Uint8Array(await response.arrayBuffer());
}

async function startUploadSession(
	data: Uint8Array,
	remote: RemoteFile | null
): Promise<string> {
	const fileId = remote ? `/${encodeURIComponent(remote.id)}` : '';
	const query = new URLSearchParams({ uploadType: 'resumable', fields: FILE_FIELDS });
	const metadata = remote
		? { name: FILE_NAME }
		: { name: FILE_NAME, parents: ['appDataFolder'] };

	const response = await authorizedFetch(`${UPLOAD_URL}${fileId}?${query.toString()}`, {
		method: remote ? 'PATCH' : 'POST',
		headers: {
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Type': SQLITE_MIME,
			'X-Upload-Content-Length': String(data.byteLength)
		},
		body: JSON.stringify(metadata)
	});

	await requireOk(response, 'Google Drive upload');

	const sessionUrl = response.headers.get('Location');
	if (!sessionUrl) {
		throw new SyncError('Google Drive did not return an upload session. Try again.');
	}

	return sessionUrl;
}

async function uploadFile(
	data: Uint8Array,
	remote: RemoteFile | null
): Promise<RemoteFile> {
	const sessionUrl = await startUploadSession(data, remote);

	const body = data.buffer.slice(
		data.byteOffset,
		data.byteOffset + data.byteLength
	) as ArrayBuffer;

	const response = await authorizedFetch(sessionUrl, {
		method: 'PUT',
		headers: {
			'Content-Type': SQLITE_MIME,
			'Content-Length': String(data.byteLength)
		},
		body
	});

	await requireOk(response, 'Google Drive upload');

	const uploaded = (await response.json().catch(() => null)) as DriveFile | null;
	if (uploaded?.id) return toRemoteFile(uploaded);

	// A few proxies drop the final metadata body; re-read the file instead of
	// reporting a failed upload that actually succeeded.
	const refreshed = await findRemoteFile();
	if (!refreshed) {
		throw new SyncError('Google Drive finished the upload but the backup could not be found.');
	}

	return refreshed;
}

/** The Google Drive implementation of the sync provider contract. */
export class GoogleDriveProvider implements SyncProvider {
	readonly id = 'google-drive' as const;
	readonly label = 'Google Drive';

	getAccount(): SyncAccount | null {
		return googleAccount();
	}

	connect(): Promise<SyncAccount> {
		return connectGoogleDrive();
	}

	disconnect(): Promise<void> {
		disconnectGoogleDrive();
		return Promise.resolve();
	}

	getRemote(): Promise<RemoteFile | null> {
		return findRemoteFile();
	}

	download(remote: RemoteFile): Promise<Uint8Array> {
		return downloadFile(remote);
	}

	upload(data: Uint8Array, remote: RemoteFile | null): Promise<RemoteFile> {
		return uploadFile(data, remote);
	}
}
