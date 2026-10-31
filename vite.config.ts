// SPDX-License-Identifier: AGPL-3.0-or-later

import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';

/**
 * Cross-origin isolation is required for `SharedArrayBuffer`, which ORT-Web
 * uses for multi-threaded WASM inference. `credentialless` (rather than
 * `require-corp`) keeps third-party requests working without per-resource CORP
 * headers while still enabling `crossOriginIsolated`.
 *
 * SvelteKit's Vite plugin installs its own dev/preview servers and drops the
 * plain `server.headers` / `preview.headers` options, so the headers are set
 * with a middleware instead.
 *
 * A deployed static SPA must set the same two headers at the host/CDN. The
 * Tauri webview is already isolated. See references/commands.md.
 */
const CROSS_ORIGIN_HEADERS: Record<string, string> = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless'
};

function crossOriginIsolation(): Plugin {
	const apply = (server: ViteDevServer | PreviewServer) => {
		server.middlewares.use((_req, res, next) => {
			for (const [key, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
				res.setHeader(key, value);
			}
			next();
		});
	};

	return {
		name: 'onspot-cross-origin-isolation',
		configureServer: apply,
		configurePreviewServer: apply
	};
}

/**
 * Where the app is served from: '' at a domain's root (dev, preview, the
 * Tauri apps) or a sub-path, e.g. '/onspot' for the GitHub Pages project site
 * (set by its workflow). SvelteKit prefixes every route and asset with it;
 * `__BASE_PATH__` carries it into code that cannot import `$app/paths`.
 */
const BASE_PATH = basePath(process.env.BASE_PATH);

function basePath(value: string | undefined): '' | `/${string}` {
	if (!value) return '';
	if (!value.startsWith('/') || value.endsWith('/')) {
		throw new Error(`BASE_PATH must start with "/" and not end with one, e.g. "/onspot" (got "${value}").`);
	}
	return value as `/${string}`;
}

export default defineConfig({
	define: {
		__BASE_PATH__: JSON.stringify(BASE_PATH)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// Pure client-side SPA. `fallback` is the SPA entry point: any route the
			// static host does not have a file for is served index.html and the
			// client router takes over.
			adapter: adapter({ fallback: 'index.html' }),
			paths: { base: BASE_PATH }
		}),
		crossOriginIsolation()
	],
	server: {
		// OPFS is scoped to the exact origin. Never silently jump to :5174 and
		// make an existing database look empty when :5173 is already occupied.
		port: 5173,
		strictPort: true,
		headers: CROSS_ORIGIN_HEADERS,
		fs: {
			// The lab's eval/ clips live at the repo root and are pulled in by
			// `import.meta.glob` from the STT benchmark tooling.
			allow: ['..']
		}
	},
	preview: {
		port: 4173,
		strictPort: true,
		headers: CROSS_ORIGIN_HEADERS
	},
	optimizeDeps: {
		exclude: ['@huggingface/transformers']
	},
	css: {
		preprocessorOptions: {
			// neo-svelte's theme stylesheet still uses Sass `if()`; it is the
			// library's code, compiles correctly, and would warn on every start.
			scss: { silenceDeprecations: ['if-function'] }
		}
	}
});
