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

import { plugin } from 'bun';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repairJson } from '../deprecated/src/lib/adapters/llm/jsonRepair.ts';
import { MAX_ATTEMPT_WORDS, capWords } from '../src/lib/config.ts';
import { sameWords } from '../src/lib/utils/words.ts';
import { sentenceChunks } from '../src/lib/utils/textChunks.ts';
import { compileMatcher } from '../src/lib/utils/historySearch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The LLM modules use the app's `#lib/*` package import. Bun does not map the
// `.js` suffix to a `.ts` source, so resolve it here before importing them.
plugin({
	name: 'onspot-lib-alias',
	setup(build) {
		build.onResolve({ filter: /^#lib\// }, (args) => ({
			path: join(REPO_ROOT, 'src/lib', args.path.slice('#lib/'.length).replace(/\.js$/, '.ts'))
		}));
	}
});

const { buildEvaluationMessages } = await import('../deprecated/src/lib/adapters/llm/prompt.ts');
const { normalizeEvaluation, extractJson } = await import('../deprecated/src/lib/adapters/llm/evaluate.ts');
const { stripThinking } = await import('../deprecated/src/lib/adapters/llm/client.ts');
const { computeInsights } = await import('../deprecated/src/lib/insights.ts');
const { translationRules } = await import('../deprecated/src/lib/adapters/llm/translationPrompt.ts');
const { parseDuration, parseRefusal } = await import('../deprecated/src/lib/usage/rateLimits.ts');
const { GROQ_PUBLISHED_MODELS, groqPublishedLimits, groqKnownLimits } = await import('../deprecated/src/lib/usage/publishedLimits.ts');
const usageFormat = await import('../src/lib/usage/format.ts');
const usageLedger = await import('../deprecated/src/lib/usage/ledger.ts');
const { composeExplanation, normalizeExplanation, separateFollowUp } = await import(
	'../src/lib/adapters/llm/explanation.ts'
);
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

const isSilent = readPrivateFunction('deprecated/src/lib/stores/practice.ts', 'isSilent');

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
		source: 'deprecated/src/lib/stores/practice.ts',
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
		crate: 'crates/adapters/llm-openai',
		module: 'evaluationPrompt',
		source: 'deprecated/src/lib/adapters/llm/prompt.ts',
		fn: 'buildEvaluationMessages',
		cases: [
			...['exam', 'casual', 'freeflow'].flatMap((mode) =>
				['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].flatMap((level) =>
					['French', 'Japanese', 'Persian'].flatMap((language) =>
						['English', 'Spanish'].map((translationTarget) => ({
							name: `${mode} · ${level} · ${language} · ${translationTarget}`,
							input: {
								transcript: 'Bonjour, je vais au marché.',
								prompt: 'Racontez votre matinée.',
								mode,
								level,
								language,
								translationTarget
							}
						}))
					)
				)
			),
			{ name: 'part two of three', input: { transcript: 'Deuxième partie.', prompt: 'Racontez.', mode: 'casual', level: 'B1', language: 'French', translationTarget: 'English', part: { number: 2, count: 3 } } }
		],
		run: ({ transcript, prompt, mode, level, language, translationTarget, part }) =>
			buildEvaluationMessages({ transcript, prompt, mode, level, language, translationTarget }, part)
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'evaluationParse',
		source: 'deprecated/src/lib/adapters/llm/evaluate.ts',
		fn: 'normalizeEvaluation',
		cases: [
			{
				name: 'clean evaluation',
				input: {
					transcript: 'je vais au marché',
					language: 'French',
					raw: {
						correctedText: 'Je vais au marché.',
						spokenLanguage: 'French',
						explanation: { note: 'Bien.', mistakes: [] },
						followUp: { question: 'Et ensuite ?', translation: 'And then?' },
						corrections: [],
						vocabulary: [],
						connectors: []
					}
				}
			},
			{
				name: 'unknown category and severity are dropped',
				input: {
					transcript: 'je vais',
					language: 'French',
					raw: {
						correctedText: 'Je vais.',
						spokenLanguage: 'French',
						explanation: null,
						followUp: null,
						corrections: [
							{ category: 'unknown', severity: 'error', original: 'je', replacement: 'Je' },
							{ category: 'grammar', severity: 'wrong', original: 'vais', replacement: 'vais' },
							{ category: 'grammar', severity: 'error', original: 'je vais', replacement: 'je vais.' }
						],
						vocabulary: [{ original: 'vais', suggestion: 'me rends' }],
						connectors: [{ connector: 'ensuite' }]
					}
				}
			},
			{
				name: 'wrong language becomes one correction',
				input: {
					transcript: 'I went to the market',
					language: 'French',
					raw: {
						correctedText: 'Je suis allé au marché.',
						spokenLanguage: 'English',
						explanation: { note: 'Answer in French.', mistakes: [] },
						followUp: null,
						corrections: [],
						vocabulary: [],
						connectors: []
					}
				}
			},
			{
				name: 'many vocabulary suggestions all survive',
				input: {
					transcript: 'bonjour',
					language: 'French',
					raw: {
						correctedText: 'Bonjour.',
						spokenLanguage: 'French',
						explanation: { note: 'Bien.', mistakes: [] },
						followUp: null,
						corrections: [],
						vocabulary: [
							{ original: 'a', suggestion: 'b', why: 'c' },
							{ original: 'd', suggestion: 'e', why: 'f' },
							{ original: 'g', suggestion: 'h', why: 'i' },
							{ original: 'j', suggestion: 'k', why: 'l' }
						],
						connectors: []
					}
				}
			},
			{
				name: 'missing follow-up and mismatched replacement',
				input: {
					transcript: 'bonjour',
					language: 'French',
					raw: {
						correctedText: 'Bonjour.',
						spokenLanguage: 'French',
						explanation: 'Bonjour.',
						followUp: { question: 'Ça va ?' },
						corrections: [],
						vocabulary: [],
						connectors: []
					}
				}
			}
		],
		run: ({ transcript, language, raw }) => normalizeEvaluation(raw, transcript, language)
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'explanation',
		source: 'src/lib/adapters/llm/explanation.ts',
		fn: 'composeExplanation',
		cases: [
			{ name: 'all correct note', input: { note: 'Nice, that was all correct.', mistakes: [] } },
			{
				name: 'model line is kept when it names the fix',
				input: {
					note: 'You described that trip vividly.',
					mistakes: [
						{ said: 'dans Paris', say: 'à Paris', line: 'You said <wrong>dans Paris</wrong>, but with a city we say <right>à Paris</right>.' }
					]
				}
			},
			{
				name: 'missing fix names falls back',
				input: { note: '', mistakes: [{ said: 'j’ai allé', say: 'je suis allé', line: 'That one is wrong.' }] }
			},
			{
				name: 'unchanged word is dropped and max mistakes apply',
				input: {
					note: '',
					mistakes: [
						{ said: 'bonjour', say: 'Bonjour', line: '' },
						{ said: 'je', say: '', line: 'Leave it out.' },
						{ said: 'vais', say: 'irai', line: '' },
						{ said: 'au', say: 'à', line: '' },
						{ said: 'marché', say: 'marché', line: '' }
					]
				}
			}
		],
		run: (input) => composeExplanation(input)
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'explanationMarkup',
		source: 'src/lib/adapters/llm/explanation.ts',
		fn: 'normalizeExplanation / separateFollowUp',
		cases: [
			{ name: 'unknown tags are dropped', input: { markup: 'Bonjour <b>tout</b> le monde.' } },
			{ name: 'nested and unclosed tags leave plain text', input: { markup: 'Un <wrong>deux <x>trois</wrong> quatre' } },
			{ name: 'legacy ask is separated', input: { markup: 'Bien. <ask>Et ensuite ?</ask>' } }
		],
		run: ({ markup }) => {
			const separated = separateFollowUp(normalizeExplanation(markup));
			return {
				markup: normalizeExplanation(markup),
				parts: separated.parts,
				askedQuestion: separated.askedQuestion
			};
		}
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'jsonExtract',
		source: 'deprecated/src/lib/adapters/llm/evaluate.ts / src/lib/adapters/llm/client.ts',
		fn: 'extractJson / stripThinking',
		cases: [
			{ name: 'thinking block is removed', input: { text: '<think>secret {curly}</think>{"a":1}' } },
			{ name: 'fenced JSON is unwrapped', input: { text: '```json\n{"a":1}\n```' } },
			{ name: 'first balanced object wins', input: { text: 'prefix {"a":{"b":1}} suffix {"c":2}' } },
			{ name: 'truncated object fails', input: { text: '{"a": [1, 2' } },
			{ name: 'duplicate keys keep the last value', input: { text: '{"a":1,"a":2}' } }
		],
		run: ({ text }) => {
			try {
				return { thinking: stripThinking(text), parsed: extractJson(text) };
			} catch (error) {
				return { thinking: stripThinking(text), error: error instanceof Error ? error.message : String(error) };
			}
		}
	},
	{
		crate: 'crates/onspot-app',
		module: 'usageLedger',
		source: 'src/lib/usage/ledger.ts',
		fn: 'keyIdOf / scopeKey / totalsWithin',
		cases: [
			{ name: 'key id', input: { key: 'secret' } },
			{ name: 'empty key id', input: { key: '  ' } },
			{ name: 'scope key', input: { key: 'secret' } },
			{
				name: 'totals scope and window',
				input: {
					key: 'secret',
					now: 59999,
					windowMs: 60000,
					scope: { host: 'api.groq.com', model: 'm' },
					calls: [
						{ host: 'api.groq.com', model: 'm', keyId: usageLedger.keyIdOf('secret'), at: 0, tokens: 10, reservedTokens: 20, audioSeconds: 1.5, characters: 3 },
						{ host: 'api.groq.com', model: 'm', keyId: usageLedger.keyIdOf('secret'), at: 30000, tokens: 10, reservedTokens: 20, audioSeconds: 1.5, characters: 3 },
						{ host: 'api.groq.com', model: 'other', keyId: usageLedger.keyIdOf('secret'), at: 0, tokens: 99, reservedTokens: 0, audioSeconds: 0, characters: 0 }
					]
				}
			}
		],
		run: ({ key, now, windowMs, scope, calls }) => {
			if (calls) {
				const keyId = usageLedger.keyIdOf(key);
				return {
					keyId,
					scopeKey: usageLedger.scopeKey({ ...scope, keyId }),
					totals: usageLedger.totalsWithin({ calls, live: {}, reported: {} }, { ...scope, keyId }, windowMs, now)
				};
			}
			return { keyId: usageLedger.keyIdOf(key) };
		}
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
		crate: 'crates/onspot-app',
		module: 'usageLimits',
		source: 'src/lib/usage/publishedLimits.ts',
		fn: 'groqPublishedLimits / groqKnownLimits',
		cases: [
			...GROQ_PUBLISHED_MODELS.flatMap((model) =>
				['free', 'developer'].map((plan) => ({
					name: `${model} · ${plan}`,
					input: { model, plan }
				}))
			),
			{ name: 'unknown model', input: { model: 'unknown/model', plan: 'free' } }
		],
		run: ({ model, plan }) => ({
			published: groqPublishedLimits(model, plan),
			known: groqKnownLimits(model, plan)
		})
	},
	{
		crate: 'crates/onspot-app',
		module: 'usageRateLimits',
		source: 'src/lib/usage/rateLimits.ts',
		fn: 'parseDuration / parseRefusal',
		cases: [
			...['1m26.4s', '547ms', '7.66s', '2h0m0s', '15', '', 'abc', '1.5m'].map((value) => ({
				name: `duration ${JSON.stringify(value)}`,
				input: { duration: value }
			})),
			{ name: 'TPM refusal with used and retry', input: { body: 'Rate limit reached for model on tokens per minute (TPM): Limit 8000, Used 7843, Requested 2416. Please try again in 16.9s.', now: 1000 } },
			{ name: 'TPD refusal without retry', input: { body: 'on tokens per day (TPD): Limit 200000, Used 199052, Requested 2410', now: 500 } },
			{ name: 'no limit named', input: { body: 'invalid key', now: 0 } }
		],
		run: ({ duration, body, now }) => {
			if (duration !== undefined) return { duration: parseDuration(duration) };
			const refusal = parseRefusal(body, now);
			return refusal ? { refusal } : { refusal: null };
		}
	},
	{
		crate: 'crates/adapters/llm-openai',
		module: 'translationPrompt',
		source: 'deprecated/src/lib/adapters/llm/translationPrompt.ts',
		fn: 'translationRules',
		cases: ['French', 'Japanese', 'Persian'].flatMap((language) =>
			['English', 'Spanish'].map((translationTarget) => ({
				name: `${language} → ${translationTarget}`,
				input: { language, translationTarget }
			}))
		),
		run: ({ language, translationTarget }) => translationRules({ language, translationTarget })
	},
	{
		crate: 'crates/onspot-app',
		module: 'insights',
		source: 'deprecated/src/lib/insights.ts',
		fn: 'computeInsights',
		cases: [
			{
				name: 'patterns group across sessions and style is excluded',
				input: {
					sessions: [
						{ id: 's1', title: 'Un', mode: 'exam', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', setup: null },
						{ id: 's2', title: 'Deux', mode: 'casual', startedAt: '2026-01-02T00:00:00.000Z', endedAt: null, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', setup: null }
					],
					attempts: [
						{ id: 'a1', sessionId: 's1', promptId: null, promptText: 'p', transcript: 't', correctedText: null, translation: null, translations: null, ttsVoice: null, explanation: null, followUp: null, wordGlosses: null, durationSec: 2.5, wordCount: 4, audioKey: null, createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
						{ id: 'a2', sessionId: 's2', promptId: null, promptText: 'p', transcript: 't', correctedText: null, translation: null, translations: null, ttsVoice: null, explanation: null, followUp: null, wordGlosses: null, durationSec: 3.3, wordCount: 6, audioKey: null, createdAt: '2026-01-02T00:01:00.000Z', updatedAt: '2026-01-02T00:01:00.000Z' }
					],
					corrections: [
						{ id: 'c1', attemptId: 'a1', category: 'grammar', severity: 'error', label: 'Elision', original: 'le', replacement: "l'", replacementTranslation: null, start: null, end: null, explanation: '', speakText: null, examStatus: null, formalAlternatives: [], sortOrder: 0, createdAt: '2026-01-01T00:01:00.000Z' },
						{ id: 'c2', attemptId: 'a2', category: 'grammar', severity: 'warning', label: '  elision  ', original: 'la', replacement: "l'", replacementTranslation: null, start: null, end: null, explanation: '', speakText: null, examStatus: null, formalAlternatives: [], sortOrder: 0, createdAt: '2026-01-02T00:01:00.000Z' },
						{ id: 'c3', attemptId: 'a2', category: 'style', severity: 'suggestion', label: 'Upgrade', original: 'a', replacement: 'b', replacementTranslation: null, start: null, end: null, explanation: '', speakText: null, examStatus: null, formalAlternatives: [], sortOrder: 1, createdAt: '2026-01-02T00:01:00.000Z' },
						{ id: 'c4', attemptId: 'missing', category: 'grammar', severity: 'error', label: 'Ignored', original: 'a', replacement: 'b', replacementTranslation: null, start: null, end: null, explanation: '', speakText: null, examStatus: null, formalAlternatives: [], sortOrder: 0, createdAt: '2026-01-03T00:00:00.000Z' }
					]
				}
			},
			{
				name: 'empty database',
				input: { sessions: [], attempts: [], corrections: [] }
			}
		],
		run: ({ sessions, attempts, corrections }) => computeInsights(sessions, attempts, corrections)
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
