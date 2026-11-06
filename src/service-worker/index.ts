// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The web app's service worker: precache the app shell so onspot opens
 * offline, and serve navigations from the cached shell when the network is
 * gone.
 *
 * It deliberately does not cache:
 * - model or voice downloads (Transformers.js and Piper already keep those in
 *   the Cache API);
 * - API traffic (Groq, DeepSeek, ElevenLabs, OpenAI-compatible servers,
 *   Google, WebDAV) — stale answers or private data in a cache would be wrong;
 * - the large `piper-wasm` data or the hashed sample audio, so installing the
 *   app does not pull tens of megabytes it may never need.
 *
 * Updates wait. The page shows a Reload prompt and only then asks this worker
 * to take over, so a new version never replaces the app mid-take.
 */
import { self } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { resolve } from '$app/paths';

/** One cache per build, so a new version can be cleaned up as a whole. */
const PRECACHE = `onspot-${version}`;

/** Assets that belong to the small app shell, not to optional local models. */
const NOT_PRECACHED = [
	/\/piper-wasm\//,
	/\/pwa\/splash\//,
	// The ORT runtimes are tens of megabytes each and load only when a local model is used.
	/ort-wasm/i,
	/\.(?:mp3|wav|ogg|oga|m4a|mp4|webm|map)$/i
];

function isPrecachable(path: string): boolean {
	if (path.endsWith('/service-worker.js')) return false;
	// Host configuration files are not app assets; some hosts do not serve them.
	if (path.endsWith('/_headers') || path.endsWith('/_redirects')) return false;
	return !NOT_PRECACHED.some((pattern) => pattern.test(path));
}

/*
 * `$app/manifest`'s paths are relative to the base path. `resolve` is the
 * public way to prefix them, but its generated argument type only names app
 * routes; this local alias accepts the manifest's file paths.
 */
const toAbsolute = resolve as unknown as (path: string) => string;

const APP_SHELL: string[] = [...immutable, ...assets]
	.map((entry) => toAbsolute(entry.path))
	.filter(isPrecachable);
const APP_PATHS = new Set<string>(APP_SHELL);
const INDEX = toAbsolute('/');

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(PRECACHE);
			// One missing optional file must not fail the whole install.
			await Promise.all(
				APP_SHELL.map((asset) =>
					cache.add(asset).catch((error: unknown) => {
						console.warn('[service-worker] could not precache', asset, error);
					})
				)
			);
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith('onspot-') && key !== PRECACHE)
					.map((key) => caches.delete(key))
			);
		})()
	);
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
	// The page asks for this only after the learner presses Reload.
	const message = event.data as { type?: string } | null;
	if (message?.type === 'SKIP_WAITING') void self.skipWaiting();
});

/**
 * Pins the SPA shell's relative URLs to the app base. Some static hosts and
 * Vite preview rewrite `/asset.js` to `./asset.js` for a deep-link fallback;
 * cached and later served at `/history/`, that would look for
 * `/history/asset.js`. Absolute paths in the production build are unaffected.
 */
async function withAppBase(response: Response): Promise<Response> {
	const type = response.headers.get('content-type') ?? '';
	if (!type.includes('text/html')) return response;

	const html = await response.text();
	const existingBase = html.match(/<base[^>]*>/i);
	if (existingBase) {
		// Hosts rewrite the base for the requested path (`./`, `../`); cached
		// and served at another path those stop pointing at the app root.
		const withBase = html.replace(existingBase[0], `<base href="${INDEX}">`);
		return shellResponse(withBase, response);
	}

	const head = html.match(/<head[^>]*>/i);
	if (!head) return new Response(html, response);

	const withBase = html.replace(head[0], `${head[0]}<base href="${INDEX}">`);
	return shellResponse(withBase, response);
}

function shellResponse(html: string, original: Response): Response {
	const headers = new Headers(original.headers);
	// The body changed; do not carry the original length or encoding with it.
	headers.delete('content-length');
	headers.delete('content-encoding');
	headers.delete('etag');

	return new Response(html, {
		status: original.status,
		statusText: original.statusText,
		headers
	});
}

async function navigationResponse(request: Request): Promise<Response> {
	try {
		const response = await fetch(request);
		if (!response.ok) return response;

		const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
		const shell = await withAppBase(response);
		if (isHtml) {
			// The same SPA shell answers every route; keep the newest one for offline deep links.
			const cache = await caches.open(PRECACHE);
			await cache.put(INDEX, shell.clone());
		}
		return shell;
	} catch {
		const cached = await caches.match(INDEX);
		if (cached) return cached;

		return new Response('onspot is offline and its app shell is not cached yet.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
}

async function cachedAsset(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	return cached ?? fetch(request);
}

/**
 * WASM runtimes are referenced from inside workers, so Vite does not put them
 * in `$app/manifest`. Keep each one after it is first fetched: the database
 * must open offline, and local speech should not need the network again. They
 * are never precached, so a learner who only uses cloud speech never pays for
 * the 23 MB ORT runtimes or the 18 MB Piper data.
 */
async function runtimeCached(request: Request): Promise<Response> {
	const cache = await caches.open(PRECACHE);
	const cached = await cache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Model files, API calls and sync targets are cross-origin. Let them go
	// straight to the network; the app owns their caches.
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(navigationResponse(request));
		return;
	}

	if (!APP_PATHS.has(url.pathname)) {
		if (/\.wasm$/.test(url.pathname)) {
			event.respondWith(runtimeCached(request));
		}
		return;
	}
	event.respondWith(cachedAsset(request));
});
