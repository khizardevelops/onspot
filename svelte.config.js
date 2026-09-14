import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Pure client-side SPA. `fallback` is the SPA entry point: any route the
		// static host does not have a file for is served index.html and the
		// client router takes over.
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
