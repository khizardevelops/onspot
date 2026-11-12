// SPDX-License-Identifier: AGPL-3.0-or-later

import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "onspot-prompt-submissions",
		compatibilityDate: "2026-11-11",
		entrypoint: "src/index.ts",
		env: {
			DB: bindings.d1({
				name: "onspot-prompts",
				id: "0f2fd610-3719-4fb6-bdc7-9db4191a1a65",
			}),
		},
	},
});
