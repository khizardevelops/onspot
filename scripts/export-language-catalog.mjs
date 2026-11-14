#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Writes the TypeScript language registry as the core's checked-in JSON.
 *
 * Pass `--check` to verify the checked-in file without writing: the parity
 * gate fails when the Rust catalog and the TypeScript registry have drifted.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { LANGUAGES, INSTRUCTION_LANGUAGES, DEFAULT_LANGUAGE_ID } from '../src/lib/languages/index.ts';
import { VOICES_BY_LANGUAGE, voiceAssets } from '../src/lib/languages/voices.ts';

const OUTPUT = 'crates/onspot-app/assets/languages.json';

const voicesByLanguage = Object.fromEntries(
	Object.entries(VOICES_BY_LANGUAGE).map(([languageId, voices]) => [
		languageId,
		voices.map((voice) => ({ ...voice, assets: voiceAssets(voice) }))
	])
);

const output = {
	capturedFrom: 'src/lib/languages/index.ts',
	languages: LANGUAGES,
	instructionLanguages: INSTRUCTION_LANGUAGES,
	voicesByLanguage,
	defaultLanguageId: DEFAULT_LANGUAGE_ID
};
const json = `${JSON.stringify(output, null, '\t')}\n`;

if (process.argv.includes('--check')) {
	const checkedIn = readFileSync(OUTPUT, 'utf8');
	if (checkedIn !== json) {
		console.error(`${OUTPUT} is stale; run \`bun run catalog:export\`.`);
		process.exit(1);
	}
	console.log(`${OUTPUT} matches the TypeScript language registry`);
} else {
	writeFileSync(OUTPUT, json);
	console.log(`wrote ${LANGUAGES.length} languages`);
}
