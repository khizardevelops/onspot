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

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), crossOriginIsolation()],
	server: {
		headers: CROSS_ORIGIN_HEADERS,
		fs: {
			// The lab's eval/ clips live at the repo root and are pulled in by
			// `import.meta.glob` from the STT benchmark tooling.
			allow: ['..']
		}
	},
	preview: {
		headers: CROSS_ORIGIN_HEADERS
	},
	optimizeDeps: {
		exclude: ['@huggingface/transformers']
	}
});
