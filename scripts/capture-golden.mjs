#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Golden fixtures for the TypeScript helpers that are still live next to
 * their Rust ports (invariant I4).
 *
 * Runs each helper on synthetic inputs and writes `{ input, expected }` cases
 * into `crates/<crate>/tests/golden/*.json`; the Rust tests replay them, and CI
 * fails when a capture changes, so the two implementations cannot drift.
 *
 * Fixtures of code that moved to Rust and was retired from the app are
 * frozen: their P0 capture (v0.2.4) is the record of the behaviour the port
 * keeps, and nothing regenerates them: jsonRepair, isSilent,
 * evaluationPrompt, evaluationParse, explanation, explanationMarkup,
 * jsonExtract, usageLedger, usageLimits, usageRateLimits, translationPrompt
 * and insights. Change one only together with a deliberate change in Rust.
 *
 * Runs on bun (`bun run golden:capture`) because it imports `.ts` modules
 * straight from source.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_ATTEMPT_WORDS, capWords } from '../src/lib/config.ts';
import { sameWords } from '../src/lib/utils/words.ts';
import { sentenceChunks } from '../src/lib/utils/textChunks.ts';
import { compileMatcher } from '../src/lib/utils/historySearch.ts';
import * as usageFormat from '../src/lib/usage/format.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CAPTURE_LABEL = 'v0.2.4 working tree, 2026-11-12 (P0)';

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
		crate: 'crates/onspot-app',
		module: 'usageFormat',
		source: 'src/lib/usage/format.ts',
		fn: 'formatCount / formatDuration / formatQuantity / formatPortion / formatReset',
		cases: [
			{ name: 'count 0', input: { kind: 'count', value: 0 } },
			{ name: 'count 999', input: { kind: 'count', value: 999 } },
			{ name: 'count 196400', input: { kind: 'count', value: 196400 } },
			{ name: 'duration 45s', input: { kind: 'duration', value: 45 } },
			{ name: 'duration 1h', input: { kind: 'duration', value: 3600 } },
			{ name: 'duration 7h58', input: { kind: 'duration', value: 28680 } },
			{ name: 'quantity 1 request', input: { kind: 'quantity', value: 1, unit: 'requests' } },
			{ name: 'quantity 8000 tokens', input: { kind: 'quantity', value: 8000, unit: 'tokens' } },
			{ name: 'portion tokens', input: { kind: 'portion', value: 196400, whole: 200000, unit: 'tokens' } },
			{ name: 'portion audio', input: { kind: 'portion', value: 28680, whole: 28800, unit: 'seconds' } },
			{ name: 'reset now', input: { kind: 'reset', value: 1000, now: 1000 } },
			{ name: 'reset in 1m', input: { kind: 'reset', value: 61000, now: 1000 } }
		],
		run: ({ kind, value, whole, unit, now }) => {
			if (kind === 'count') return usageFormat.formatCount(value);
			if (kind === 'duration') return usageFormat.formatDuration(value);
			if (kind === 'quantity') return usageFormat.formatQuantity(value, unit);
			if (kind === 'portion') return usageFormat.formatPortion(value, whole, unit);
			return usageFormat.formatReset(value, now);
		}
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
