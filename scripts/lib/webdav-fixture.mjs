// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An in-memory WebDAV destination for the sync smokes.
 *
 * Answers only what the app's adapter uses (OPTIONS, PROPFIND, MKCOL, PUT,
 * GET, HEAD, DELETE) with Basic auth and permissive CORS, so the browser check
 * exercises the same requests the desktop and mobile apps send.
 */

function corsHeaders() {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'OPTIONS, PROPFIND, MKCOL, PUT, GET, HEAD, DELETE',
		'access-control-allow-headers': 'Authorization, Depth, Content-Type, Content-Length',
		'access-control-expose-headers': 'ETag, Last-Modified'
	};
}

/**
 * Starts the fixture server.
 *
 * @param {{ port: number, username?: string, password?: string }} options
 * @returns {{ stop: () => void, credentials: string }}
 */
export function startWebdavServer({ port, username = 'tester', password = 'secret' }) {
	const files = new Map();
	const collections = new Set(['/dav']);
	const credentials = `Basic ${btoa(`${username}:${password}`)}`;
	let etagCounter = 0;

	const server = Bun.serve({
		port,
		hostname: '127.0.0.1',
		async fetch(request) {
			if (request.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders() });
			}
			if (request.headers.get('authorization') !== credentials) {
				return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
			}

			const path = new URL(request.url).pathname;

			if (request.method === 'PROPFIND') {
				const file = files.get(path);
				if (!file) return new Response('Not found', { status: 404, headers: corsHeaders() });
				const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${path}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"${file.etag}"</d:getetag>
        <d:getlastmodified>${file.modified}</d:getlastmodified>
        <d:getcontentlength>${file.bytes.byteLength}</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
				return new Response(body, {
					status: 207,
					headers: { ...corsHeaders(), 'content-type': 'application/xml; charset=utf-8' }
				});
			}

			if (request.method === 'MKCOL') {
				if (collections.has(path)) {
					return new Response('Already exists', { status: 405, headers: corsHeaders() });
				}
				const parent = path.slice(0, path.lastIndexOf('/')) || '/';
				if (!collections.has(parent)) {
					return new Response('Missing parent', { status: 409, headers: corsHeaders() });
				}
				collections.add(path);
				return new Response(null, { status: 201, headers: corsHeaders() });
			}

			if (request.method === 'PUT') {
				const parent = path.slice(0, path.lastIndexOf('/')) || '/';
				if (!collections.has(parent)) {
					return new Response('Missing parent', { status: 409, headers: corsHeaders() });
				}
				const bytes = new Uint8Array(await request.arrayBuffer());
				etagCounter += 1;
				files.set(path, {
					bytes,
					etag: `e${etagCounter}`,
					modified: new Date().toUTCString()
				});
				return new Response(null, { status: 201, headers: corsHeaders() });
			}

			if (request.method === 'GET' || request.method === 'HEAD') {
				const file = files.get(path);
				if (!file) return new Response('Not found', { status: 404, headers: corsHeaders() });
				return new Response(request.method === 'HEAD' ? null : file.bytes, {
					status: 200,
					headers: {
						...corsHeaders(),
						'content-type': 'application/vnd.sqlite3',
						etag: `"${file.etag}"`,
						'last-modified': file.modified
					}
				});
			}

			if (request.method === 'DELETE') {
				files.delete(path);
				return new Response(null, { status: 204, headers: corsHeaders() });
			}

			return new Response('Unsupported', { status: 405, headers: corsHeaders() });
		}
	});

	return { stop: () => server.stop(true), credentials };
}
