#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Writes the bundled prompt catalogue as the core's checked-in JSON. */

import { writeFileSync } from 'node:fs';
import { PROMPT_CATALOGUE } from '../src/lib/practice/promptCatalogue.ts';

writeFileSync(
	'crates/onspot-app/assets/prompts.json',
	`${JSON.stringify({ capturedFrom: 'src/lib/practice/promptCatalogue.ts', prompts: PROMPT_CATALOGUE }, null, '\t')}\n`
);
console.log(`wrote ${PROMPT_CATALOGUE.length} prompts`);
