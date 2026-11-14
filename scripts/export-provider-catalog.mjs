#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Writes the TypeScript LLM provider/model catalog as the core's checked-in
 * JSON, mirroring `scripts/export-language-catalog.mjs`.
 *
 * Pass `--check` to verify the checked-in file without writing: the parity
 * gate fails when the Rust catalog and the TypeScript registry have drifted.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
	AUTOMATIC_MODELS,
	AUTOMATIC_MODEL,
	LLM_MODELS,
	LLM_PROVIDERS
} from '../src/lib/adapters/llm/providers.ts';

const OUTPUT = 'crates/onspot-app/assets/providers.json';

const output = {
	capturedFrom: 'src/lib/adapters/llm/providers.ts',
	automaticModel: AUTOMATIC_MODEL,
	providers: Object.values(LLM_PROVIDERS),
	models: LLM_MODELS,
	automaticModels: AUTOMATIC_MODELS
};
const json = `${JSON.stringify(output, null, '\t')}\n`;

if (process.argv.includes('--check')) {
	const checkedIn = readFileSync(OUTPUT, 'utf8');
	if (checkedIn !== json) {
		console.error(`${OUTPUT} is stale; run \`bun run providers:export\`.`);
		process.exit(1);
	}
	console.log(`${OUTPUT} matches the TypeScript provider catalog`);
} else {
	writeFileSync(OUTPUT, json);
	console.log(`wrote ${output.providers.length} providers and ${Object.keys(output.models).length} model lists`);
}
