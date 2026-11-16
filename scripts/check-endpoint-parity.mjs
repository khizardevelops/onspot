#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Endpoint-resolution parity between the core and the web driver.
 *
 *   bun run endpoint:capture   rewrite tests/fixtures/request-endpoints.json
 *   bun run endpoint:check     fail when the file is stale
 *
 * The fixture holds settings + the driver-side key + the endpoint each must
 * resolve to. The Rust test `endpoint_fixture` replays the settings through
 * `providers::resolve_endpoint`; this script does the same through the
 * TypeScript `resolveLlmEndpoint`. Both compare to `expected`, so either side
 * drifting fails a gate. Each side computes independently.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(REPO_ROOT, 'crates/onspot-app/tests/fixtures/request-endpoints.json');

const providersJson = JSON.parse(
	readFileSync(join(REPO_ROOT, 'crates/onspot-app/assets/providers.json'), 'utf8')
);
const languagesJson = JSON.parse(
	readFileSync(join(REPO_ROOT, 'crates/onspot-app/assets/languages.json'), 'utf8')
);
const AUTOMATIC = providersJson.automaticModel;
const LEVELS = ['high', 'medium', 'low'];

import { resolveLlmEndpointPolicy } from '../src/lib/adapters/llm/providers.ts';
import { getLanguage, getInstructionLanguage, resourceLevelOf } from '../src/lib/languages/index.ts';

function languageLevel(settings) {
	const studied = getLanguage(settings.targetLanguage);
	const instruction = getInstructionLanguage(settings.instructionLanguage);
	const least = Math.min(
		studied ? studied.webTextPercent : Infinity,
		instruction.webTextPercent
	);
	return resourceLevelOf(least);
}

function providerIdFor(baseUrl) {
	const host = (baseUrl || '').replace(/^[a-z]+:\/\//i, '').split('/')[0].toLowerCase();
	if (host === 'api.groq.com') return 'groq';
	if (host === 'api.deepseek.com') return 'deepseek';
	return 'custom';
}

function resolveEndpoint(settings) {
	const endpoint = resolveLlmEndpointPolicy({
		correctionMode: settings.correctionMode,
		localLlmUrl: settings.localLlmUrl,
		localLlmModel: settings.localLlmModel,
		llmProvider: settings.llmProvider,
		llmModel: settings.llmModel,
		customBaseUrl: settings.customBaseUrl,
		customModel: settings.customModel,
		languageLevel: languageLevel(settings)
	});
	return {
		baseUrl: endpoint.baseUrl,
		provider: providerIdFor(endpoint.baseUrl),
		model: endpoint.model,
		fallbackModels: endpoint.fallbackModels ?? []
	};
}

const base = {
	correctionMode: 'cloud',
	localLlmUrl: '',
	localLlmModel: '',
	llmProvider: 'groq',
	llmModel: AUTOMATIC,
	customBaseUrl: '',
	customModel: '',
	targetLanguage: 'fr',
	instructionLanguage: 'en'
};

const NAMES = [
	['groq automatic, fr/en', {}],
	['groq automatic, fa instruction', { instructionLanguage: 'fa' }],
	['groq pinned model', { llmModel: 'openai/gpt-oss-20b' }],
	['deepseek automatic', { llmProvider: 'deepseek' }],
	['custom provider', { llmProvider: 'custom', customBaseUrl: 'http://127.0.0.1:1234/v1', customModel: 'local-model' }],
	['local server mode', { correctionMode: 'local', localLlmUrl: 'http://127.0.0.1:4330/v1', localLlmModel: 'stub' }]
];

const cases = NAMES.map(([name, overrides]) => ({
	name,
	settings: { ...base, ...overrides },
	apiKey: 'sk-test'
}));
const expected = cases.map((entry) => resolveEndpoint(entry.settings));
const output = { cases, expected };

if (process.argv.includes('--check')) {
	const checkedIn = JSON.parse(readFileSync(FIXTURE, 'utf8'));
	if (JSON.stringify(checkedIn) !== JSON.stringify(output)) {
		console.error(`${FIXTURE} is stale; run \`bun run endpoint:capture\`.`);
		process.exit(1);
	}
	console.log(`${FIXTURE} matches the TypeScript endpoint resolver`);
} else {
	writeFileSync(FIXTURE, `${JSON.stringify(output, null, '\t')}\n`);
	console.log(`wrote ${FIXTURE} (${cases.length} cases)`);
}
