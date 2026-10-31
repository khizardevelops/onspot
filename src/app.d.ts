// SPDX-License-Identifier: AGPL-3.0-or-later

// See https://svelte.dev/docs/kit/types#app
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface ImportMetaEnv {
		/** Google OAuth client id for the Tauri desktop build (installed app, loopback). */
		readonly VITE_GOOGLE_CLIENT_ID_DESKTOP?: string;
		/** Google OAuth client id for the browser build (authorized JavaScript origin). */
		readonly VITE_GOOGLE_CLIENT_ID_WEB?: string;
	}

	/**
	 * Where the app is served from: '' at a domain's root, or e.g. '/onspot' on
	 * a GitHub Pages project site. Defined by vite.config.ts, for code that
	 * cannot import `$app/paths` (workers).
	 */
	const __BASE_PATH__: string;
}

export {};
