#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Golden-fixture capture (P0, invariant I4).
 *
 * Runs today's TypeScript helpers on synthetic inputs and writes
 * `{ input, expected }` cases into `crates/**​/tests/golden/*.json`. Every port
 * of one of these functions must reproduce the same answers before the
 * TypeScript module may be deleted.
 *
 * Refresh a capture only when the legacy TypeScript behaviour is deliberately
 * changed, never during a port: a changed fixture during a port is proof that
 * the Rust implementation drifted.
 *
 * Runs on bun (`bun run golden:capture`) because it imports `.ts` modules
 * directly; no bundler or `#lib/` alias is involved. Isolated module code is
 * imported straight from source, so the store modules that pull in the Svelte
 * runtime and Web Workers are not touched.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repairJson } from '../src/lib/adapters/llm/jsonRepair.ts';
import { MAX_ATTEMPT_WORDS, capWords } from '../src/lib/config.ts';
import { sameWords } from '../src/lib/utils/words.ts';
import { sentenceChunks } from '../src/lib/utils/textChunks.ts';
import { compileMatcher } from '../src/lib/utils/historySearch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE_LABEL = 'v0.2.4 working tree, 2026-11-12 (P0)';

/**
 * `isSilent` is private to `stores/practice.ts`, and that module cannot be
 * imported here: it pulls in the Svelte store runtime, Web Workers and the
 * database. Its source is plain JavaScript, so P0 reads the function out of the
 * file and evaluates it. The lookup fails loudly if it is renamed or moved;
 * the capture then changes to a normal import once the function lands in
 * `onspot-dsp` (P3).
 */
function readPrivateFunction(relativePath, name) {
	const source = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
	const start = source.indexOf(`function ${name}(`);
	if (start === -1) throw new Error(`${relativePath}: function ${name} not found`);

	let depth = 0;
	let end = -1;
	for (let index = source.indexOf('{', start); index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) {
				end = index + 1;
				break;
			}
		}
	}
	if (end === -1) throw new Error(`${relativePath}: function ${name} has no closing brace`);

	const functionSource = source.slice(start, end);

	// The function has typed parameters, so it is TypeScript, not JavaScript:
	// strip the annotations with Bun's transpiler before evaluating it.
	const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(functionSource);
	return new Function(`return (${javascript});`)();
}

const isSilent = readPrivateFunction('src/lib/stores/practice.ts', 'isSilent');

/** A sine tone, rounded so the fixture stays small and byte-stable across runs. */
function tone({ samples, amplitude, sampleRate, frequency = 440 }) {
	const pcm = new Array(samples);
	for (let index = 0; index < samples; index += 1) {
		const value = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
		pcm[index] = Number(value.toFixed(6));
	}
	return pcm;
}

function words(count, prefix = 'mot') {
	return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

const searchSessions = [
	{ title: 'Bonjour à Paris', transcripts: ['Bonjour, je m\'appelle Ana.', 'Je vais au marché.'] },
	{ title: 'Le marché du samedi', transcripts: ['Hier j\'ai lu un livre.'] },
	{ title: 'Café et croissants', transcripts: ['Un café, s\'il vous plaît.', 'Merci beaucoup !'] }
];

const captures = [
	{
		crate: 'crates/onspot-app',
		module: 'history_search',
		source: 'src/lib/utils/historySearch.ts',
		fn: 'compileMatcher',
		cases: [
			{ name: 'empty query matches everything', input: { query: '   ', regex: false, caseSensitive: false } },
			{ name: 'literal text matches a title and a transcript case-insensitively', input: { query: 'bonjour', regex: false, caseSensitive: false } },
			{ name: 'case-sensitive literal text misses the other case', input: { query: 'bonjour', regex: false, caseSensitive: true } },
			{ name: 'a dot is literal, not a wildcard', input: { query: 'm.', regex: false, caseSensitive: false } },
			{ name: 'a regex alternation applies to titles and transcripts', input: { query: 'marché|café', regex: true, caseSensitive: false } },
			{ name: 'a regex character class is honoured', input: { query: 'caf[ée]', regex: true, caseSensitive: false } },
			{ name: 'an anchored regex only matches the start', input: { query: '^le ', regex: true, caseSensitive: false } },
			{ name: 'a word boundary matches whole words', input: { query: '\\bmerci\\b', regex: true, caseSensitive: false } },
			{ name: 'an invalid regex reports an error', input: { query: '[', regex: true, caseSensitive: false } },
			{ name: 'unicode text matches without folding', input: { query: 'café', regex: false, caseSensitive: false } }
		],
		run: ({ query, regex, caseSensitive }) => {
			const { re, error } = compileMatcher(query, { regex, caseSensitive });
			return {
				error: Boolean(error),
				matchedTitles: re
					? searchSessions
							.filter((session) => re.test(session.title) || session.transcripts.some((text) => re.test(text)))
							.map((session) => session.title)
					: []
			};
		},
		context: { sessions: searchSessions }
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'jsonRepair',
		source: 'src/lib/adapters/llm/jsonRepair.ts',
		fn: 'repairJson',
		cases: [
			{ name: 'valid JSON is returned unchanged', input: '{"a":1,"b":[2,3]}' },
			{ name: 'stray quote between two closing brackets', input: '{"items":[{"source":"a","target":"b"}]"}' },
			{ name: 'trailing comma before two closers', input: '{"items":[1,2,],"done":true,}' },
			{
				name: 'colon inside a key',
				input: '{"wordBreakdown":[{"source:".","target":"."}]}'
			},
			{ name: 'punctuation value missing its closing quote', input: '{"wordBreakdown":[{"source":".","target":".}]}' },
			{ name: 'closing brace and stray quote inside a string', input: '{"text":"a } \\" b"}' },
			{ name: 'truncated reply cannot be repaired', input: '{"a":[1,2' },
			{ name: 'prose instead of JSON cannot be repaired', input: 'I cannot help with that.' }
		],
		run: (input) => repairJson(input)
	},
	{
		crate: 'crates/onspot-dsp',
		module: 'capWords',
		source: 'src/lib/config.ts',
		fn: 'capWords',
		cases: [
			{ name: 'text below the cap is unchanged', input: { text: 'Bonjour, je vais bien.', maxWords: MAX_ATTEMPT_WORDS } },
			{ name: 'exactly at the cap is unchanged', input: { text: words(MAX_ATTEMPT_WORDS).join(' '), maxWords: MAX_ATTEMPT_WORDS } },
			{ name: 'above the cap is cut', input: { text: words(MAX_ATTEMPT_WORDS + 5).join(' '), maxWords: MAX_ATTEMPT_WORDS } },
			{ name: 'a custom cap cuts with a single space', input: { text: 'un deux trois quatre cinq six', maxWords: 4 } },
			{ name: 'line breaks and repeated spaces collapse when cutting', input: { text: 'un  deux\ntrois\tquatre cinq', maxWords: 2 } },
			{ name: 'empty text stays empty', input: { text: '', maxWords: 5 } }
		],
		run: ({ text, maxWords }) => capWords(text, maxWords)
	},
	{
		crate: 'crates/onspot-dsp',
		module: 'isSilent',
		source: 'src/lib/stores/practice.ts',
		fn: 'isSilent',
		cases: [
			{ name: 'digital silence', input: { pcm: new Array(160).fill(0), sampleRate: 16000 } },
			{ name: 'an empty recording is silent', input: { pcm: [], sampleRate: 16000 } },
			{ name: 'a tone below the -46 dBFS floor', input: { pcm: tone({ samples: 160, amplitude: 0.004, sampleRate: 16000 }), sampleRate: 16000 } },
			{ name: 'a tone above the -46 dBFS floor', input: { pcm: tone({ samples: 160, amplitude: 0.01, sampleRate: 16000 }), sampleRate: 16000 } },
			{
				// A 1 kHz rate keeps the fixture small; the 100ms window is then 100 samples.
				name: 'one loud 100ms window among silence is not silent',
				input: {
					pcm: new Array(300).fill(0).map((value, index) => (index >= 200 ? 0.2 * Math.sin(index / 4) : value)),
					sampleRate: 1000
				}
			},
			{
				name: 'the 100ms window follows the sample rate',
				input: { pcm: tone({ samples: 80, amplitude: 0.01, sampleRate: 8000 }), sampleRate: 8000 }
			}
		],
		run: ({ pcm, sampleRate }) => isSilent(Float32Array.from(pcm), sampleRate)
	},
	{
		crate: 'crates/onspot-dsp',
		module: 'sameWords',
		source: 'src/lib/utils/words.ts',
		fn: 'sameWords',
		cases: [
			{ name: 'punctuation and case do not matter', input: { first: 'Je vais bien merci', second: 'je vais bien, merci.' } },
			{ name: 'curly and straight apostrophes are equal', input: { first: "j'ai préféré", second: 'J’ai préféré.' } },
			{ name: 'hyphenated words stay one word', input: { first: 'un rendez-vous', second: 'Un rendez-vous !' } },
			{ name: 'an extra word is a difference', input: { first: 'je vais bien', second: 'je vais très bien' } },
			{ name: 'two empty texts are equal', input: { first: '', second: '   ' } },
			{ name: 'Japanese punctuation does not matter', input: { first: '元気です', second: '元気です。' } },
			{ name: 'different kanji are different words', input: { first: '元気です', second: '天気です' } }
		],
		run: ({ first, second }) => sameWords(first, second)
	},
	{
		crate: 'crates/onspot-dsp',
		module: 'sentenceChunks',
		source: 'src/lib/utils/textChunks.ts',
		fn: 'sentenceChunks',
		cases: [
			{ name: 'empty text has no chunk', input: { text: '', maxWords: 40 } },
			{ name: 'a text that fits is one chunk', input: { text: 'Bonjour. Je vais bien.', maxWords: 40 } },
			{ name: 'sentences are packed evenly into the requested number of parts', input: { text: 'Un deux trois. Quatre cinq six. Sept huit neuf.', maxWords: 3 } },
			{
				name: 'a sentence over the limit is cut at its clauses',
				input: { text: 'Un deux trois, quatre cinq six, sept huit neuf. Fin.', maxWords: 3 }
			},
			{
				name: 'a clause still over the limit is cut into word runs',
				input: { text: 'Un deux trois quatre cinq six sept huit. Fin.', maxWords: 3 }
			},
			{ name: 'a long unpunctuated transcript is cut into word runs', input: { text: words(20).join(' '), maxWords: 6 } }
		],
		run: ({ text, maxWords }) => sentenceChunks(text, maxWords)
	}
];

function serialiseCapture(capture) {
	const cases = capture.cases.map((testCase) => ({
		name: testCase.name,
		input: testCase.input,
		expected: capture.run(testCase.input)
	}));

	return `${JSON.stringify(
		{
			capturedFrom: CAPTURE_LABEL,
			source: capture.source,
			function: capture.fn,
			...(capture.context ? { context: capture.context } : {}),
			cases
		},
		null,
		'\t'
	)}\n`;
}

for (const capture of captures) {
	const directory = join(REPO_ROOT, capture.crate, 'tests/golden');
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${capture.module}.json`);
	writeFileSync(path, serialiseCapture(capture));
	console.log(`wrote ${capture.crate}/tests/golden/${capture.module}.json (${capture.cases.length} cases)`);
}
