#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * P3 browser contract check.
 *
 * Starts the dev server on its own port with the core practice backend, boots
 * the wasm bridge in real Chrome with a fake microphone, and proves the core
 * loop over the host shims: prompt selection, start, cancel, a silent take
 * rejected before transcription, and no page errors.
 *
 * Prerequisites: `bun run bridge:wasm`. Set `CHROME_PATH` when Chrome is not in
 * a standard location.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright-core';

const PORT = 4320;
const BASE = `http://127.0.0.1:${PORT}`;

function chromePath() {
	const candidates = [
		process.env.CHROME_PATH,
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/opt/google/chrome/chrome',
		'/usr/bin/chromium',
		'/snap/bin/chromium'
	].filter(Boolean);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error('Chrome not found; set CHROME_PATH.');
	return found;
}

function waitForServer(timeoutMs = 60_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tick = async () => {
			try {
				const response = await fetch(BASE);
				if (response.ok) return resolve();
			} catch {
				// not listening yet
			}
			if (Date.now() - started > timeoutMs) return reject(new Error('dev server did not start'));
			setTimeout(tick, 300);
		};
		void tick();
	});
}

/** A two-second silent 16 kHz mono WAV for Chrome's fake microphone. */
function silenceWav(path) {
	const samples = 32_000;
	const buffer = Buffer.alloc(44 + samples * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + samples * 2, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(16_000, 24);
	buffer.writeUInt32LE(32_000, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(samples * 2, 40);
	writeFileSync(path, buffer);
}

/** A two-second 220 Hz tone 16 kHz mono WAV, so the take is not silent. */
function toneWav(path) {
	const samples = 32_000;
	const buffer = Buffer.alloc(44 + samples * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + samples * 2, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(16_000, 24);
	buffer.writeUInt32LE(32_000, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i += 1) {
		buffer.writeInt16LE(Math.round(12_000 * Math.sin((2 * Math.PI * 220 * i) / 16_000)), 44 + i * 2);
	}
	writeFileSync(path, buffer);
}

/** The full STT → evaluation → persistence loop with the network stubbed. */
async function fullLoopCheck(tone) {
	const browser = await chromium.launch({
		executablePath: chromePath(),
		headless: true,
		args: [
			'--no-sandbox',
			'--mute-audio',
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			`--use-file-for-fake-audio-capture=${tone}`,
			'--autoplay-policy=no-user-gesture-required'
		]
	});
	try {
		const context = await browser.newContext({ permissions: ['microphone'] });
		await context.addInitScript(() => localStorage.setItem('onspot.key.llm.groq', 'test-key'));
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			// The driver's read-back needs a cloud key; this smoke stubs the LLM,
			// not text-to-speech, so that playback failure is expected.
			if (message.type() === 'error' && !message.text().includes('speech failed')) {
				errors.push(message.text());
			}
		});
		let sttCalls = 0;
		let evaluationCalls = 0;
		let glossCalls = 0;
		await page.route('https://api.groq.com/**', async (route) => {
			const url = route.request().url();
			if (url.includes('/audio/transcriptions')) {
				sttCalls += 1;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ text: 'Bonjour je vais au marché ce matin' })
				});
				return;
			}
			if (url.includes('/chat/completions')) {
				evaluationCalls += 1;
				const post = route.request().postData() ?? '';
				if (post.includes('word meanings')) {
					glossCalls += 1;
					const gloss = { glosses: { '1': 'Hello', '2': 'I', '3': 'go' }, expressions: [{ from: 2, to: 3, meaning: 'I go' }] };
					await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(gloss) } }] }) });
					return;
				}
				if (post.includes('phrases into')) {
					await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ meaning: 'Hello, I' }) } }] }) });
					return;
				}
				if (post.includes('translation engine')) {
					const translations = {
						translations: {
							idiomatic: 'Bonjour, je vais au marché ce matin.',
							idiomaticVariants: ['Salut, je vais au marché ce matin.'],
							literal: 'Bonjour, je vais au marché ce matin.',
							wordForWord: 'Bonjour je vais au marché ce matin.',
							wordBreakdown: [{ source: 'Bonjour', target: 'Hello' }]
						}
					};
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(translations) }, finish_reason: 'stop' }] })
					});
					return;
				}
				const content = JSON.stringify({
					correctedText: 'Bonjour, je vais au marché ce matin.',
					spokenLanguage: 'French',
					explanation: 'Très bien. Attention au futur.',
					followUp: { question: 'Et ensuite ?', translation: 'And then?' },
					corrections: [
						{
							category: 'grammar',
							severity: 'error',
							label: 'Futur',
							original: 'je vais',
							replacement: "j'irai",
							explanation: 'Use the future here.',
							formalAlternatives: []
						}
					],
					vocabulary: [],
					connectors: []
				});
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 'stub',
						model: 'stub',
						choices: [{ message: { content }, finish_reason: 'stop' }],
						usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
					})
				});
				return;
			}
			await route.fulfill({ status: 404, body: 'not found' });
		});
		await page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => Boolean(document.querySelector('.prompt-text')?.textContent?.trim()),
			undefined,
			{ timeout: 120_000 }
		);

		const { snapshot, translation: _translation, insights, glosses, phrase, usage, exported, sync, reminder, prompts, onboarding, language, catalog, recordedCalls } = await page.evaluate(async () => {
			const find = (name) =>
				performance
					.getEntriesByType('resource')
					.map((entry) => entry.name)
					.find((entry) => entry.includes(name));
			const settings = await import(find('/src/lib/stores/settings.ts'));
			let current;
			const stop = settings.appSettings.subscribe((value) => (current = value));
			stop();
			settings.appSettings.set({
				...current,
				sttMode: 'cloud',
				ttsMode: 'cloud',
				correctionMode: 'cloud',
				llmProvider: 'groq'
			});

			const { getCoreClient } = await import(find('/src/lib/core-client/client.ts'));
			const client = await getCoreClient();
			const config = {
				targetLanguageId: 'fr',
				targetLanguageName: 'French',
				instructionLanguageId: 'en',
				instructionLanguageName: 'English',
				level: 'b1',
				mode: 'exam',
				ttsMode: 'cloud',
				sttMode: 'cloud',
				ttsVoice: 'fr_FR-siwis',
				explanationVoice: 'en_US-amy',
				pace: 1,
				explanationAudioAvailable: false,
				llmEndpoint: {
					baseUrl: 'https://api.groq.com/openai/v1',
					provider: 'groq',
					model: 'openai/gpt-oss-120b',
					fallbackModels: []
				},
				maxSeconds: 60
			};
			await client.command('practice.configure', { config });
			const usage = await client.command('usage.snapshot', {
				input: {
					sttMode: 'cloud', correctionMode: 'cloud', llmProvider: 'groq',
					llmHost: 'api.groq.com', llmModel: 'openai/gpt-oss-120b', llmFallbackModels: [],
					llmKeyId: 'test-key', ttsMode: 'cloud', ttsCloudProvider: 'elevenlabs',
					ttsHost: 'api.elevenlabs.io', ttsModel: 'eleven_multilingual_v2', ttsKeyId: 'no-key',
					groqKeyId: 'test-key', deepseekKeyId: 'no-key', elevenlabsKeyId: 'no-key',
					isTauri: false, now: Date.now(), ledger: { calls: [], live: {}, reported: {} },
					elevenlabs: null, deepseek: null, groqModels: ['openai/gpt-oss-120b'],
					labels: { 'openai/gpt-oss-120b': 'GPT-OSS 120B' }
				}
			});
			const connection = await client.command('evaluation.test_connection', {
				endpoint: config.llmEndpoint
			});
			if (!connection.reply) throw new Error('the connection test returned no reply');
			await client.command('practice.set_prompt', {
				prompt: {
					id: 'p-1',
					title: 'Le marché',
					text: 'Racontez votre matinée au marché.',
					englishFallback: false
				}
			});
			await client.command('practice.start_recording');
			await new Promise((resolve) => setTimeout(resolve, 1_200));
			const snapshot = (await client.command('practice.stop_and_analyze')).snapshot;
			const translation = await client.command('translations.ensure', {
				attemptId: snapshot.attempts[0].attempt.id
			});
			const insights = await client.command('insights.build', null);
			const glossRequest = {
				attemptId: snapshot.attempts[0].attempt.id,
				text: 'Bonjour je vais',
				wordIndex: 0
			};
			const glosses = await client.command('glosses.ensure', glossRequest);
			await client.command('glosses.ensure', glossRequest);
			const phrase = await client.command('phrases.ensure', {
				attemptId: snapshot.attempts[0].attempt.id,
				text: 'Bonjour je vais',
				start: 0,
				end: 1,
				phrase: 'Bonjour je'
			});
			const exported = await client.command('export.session_markdown', { sessionId: snapshot.sessionId });
			const onboarding = await client.command('onboarding.decide', { stored: null });
			const catalog = await client.command('language.catalog', null);
			const language = await client.command('language.plan', {
				input: {
					languageId: 'fr', instructionLanguageId: 'en', native: true,
					required: { stt: true, voice: true, explanationVoice: false },
					installed: { stt: false, voice: false, explanationVoice: false },
					voiceId: null, explanationVoiceId: null
				}
			});
			const prompts = await client.command('prompts.catalogue', {
				instructionLanguage: 'en', targetLanguage: 'fr'
			});
			const reminder = await client.command('reminders.state', {
				enabled: true, lastPractisedAtMs: Date.now() - 2 * 86_400_000,
				snoozedUntilMs: null, frequency: 'frequent', nowMs: Date.now()
			});
			const sync = await client.command('sync.decide', {
				comparison: {
					localRevision: 2, syncedRevision: 1, localSize: null, remote: null,
					lastSyncedAt: null, hasLocalChanges: true, hasRemoteChanges: false
				}
			});
			if (!usage.services?.length) throw new Error('usage snapshot returned no services');
			const llmUsage = usage.services.find((service) => service.capability === 'LLM');
			if (!llmUsage?.meters.length) throw new Error('usage snapshot returned no LLM meters');
			const view = await import('/src/lib/usage/view.ts');
			let monitored = [];
			const stopView = view.usageServicesStore.subscribe((value) => (monitored = value));
			const deadline = Date.now() + 5_000;
			while (!monitored.some((service) => service.capability === 'LLM' && service.meters.length) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			stopView();
			if (!monitored.some((service) => service.capability === 'LLM' && service.meters.length)) {
				throw new Error('core usage monitor did not publish meters');
			}
			// The core counts its own LLM requests and Groq's speech recognition
			// reports through it: both must land in the device's ledger.
			const ledger = JSON.parse(localStorage.getItem('onspot.usage.v1') ?? '{"calls":[]}');
			const recordedCalls = ledger.calls.filter((call) => call.host === 'api.groq.com');
			return { snapshot, translation, insights, glosses, phrase, usage, exported, sync, reminder, prompts, onboarding, language, catalog, recordedCalls };
		});

		if (snapshot.phase !== 'idle' || snapshot.attempts.length !== 1) {
			throw new Error(`full loop did not persist a take: ${JSON.stringify(snapshot)}`);
		}
		if (snapshot.attempts[0].attempt.transcript !== 'Bonjour je vais au marché ce matin') {
			throw new Error(`unexpected transcript: ${snapshot.attempts[0].attempt.transcript}`);
		}
		if (snapshot.attempts[0].corrections.length !== 1) {
			throw new Error('the evaluation corrections were not persisted');
		}
		if (sttCalls < 1 || evaluationCalls < 1) {
			throw new Error(`host calls were not made: stt=${sttCalls}, evaluation=${evaluationCalls}`);
		}
		if (_translation.translations.idiomatic !== 'Bonjour, je vais au marché ce matin.') {
			throw new Error('the Rust translation command did not return the idiomatic view');
		}
		if (insights.data.totals.attempts !== 1 || insights.data.patterns.length !== 1) {
			throw new Error('the Rust insights aggregation did not include the new take');
		}
		if (glosses.glosses.words[0] !== 'Hello' || glosses.glosses.phrases.length !== 1) {
			throw new Error('the Rust gloss command did not return word meanings');
		}
		if (glossCalls !== 1) throw new Error(`gloss cache did not coalesce: ${glossCalls} calls`);
		if (phrase.meaning !== 'Hello, I') throw new Error('the Rust phrase command did not return a meaning');
		if (!exported.markdown.startsWith('# Le marché') || !exported.markdown.includes('Bonjour je vais au marché ce matin')) {
			throw new Error(`the Rust session Markdown did not contain the take: ${JSON.stringify(exported)}`);
		}
		if (sync.decision !== 'upload') throw new Error(`unexpected sync decision: ${sync.decision}`);
		if (!reminder.due || !reminder.nextAt) throw new Error('the Rust reminder was not due');
		if (!prompts.prompts.some((prompt) => prompt.id === 'en-morning-routine')) throw new Error('the Rust prompt catalogue was empty');
		if (!onboarding.shouldOffer) throw new Error('the Rust onboarding decision should offer the guide');
		if (!language.pending?.stt || language.ready) throw new Error('the Rust language plan did not report missing data');
		if (!catalog.languages.some((entry) => entry.id === 'fr')) throw new Error('the Rust language catalog was empty');
		const sttModels = new Set(['whisper-large-v3', 'whisper-large-v3-turbo']);
		const recordedLlm = recordedCalls.filter((call) => !sttModels.has(call.model)).length;
		const recordedStt = recordedCalls.length - recordedLlm;
		if (recordedLlm !== evaluationCalls || recordedStt !== sttCalls) {
			throw new Error(`usage ledger missed calls: llm ${recordedLlm}/${evaluationCalls}, stt ${recordedStt}/${sttCalls}`);
		}
		if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
		return `stt=${sttCalls}, eval=${evaluationCalls} (all counted in the usage ledger), attempt ${snapshot.attempts[0].attempt.id}, translations ready`;
	} finally {
		await browser.close();
	}
}

if (!existsSync('static/core-bridge/onspot_bridge.js')) {
	console.error('Missing static/core-bridge/onspot_bridge.js — run `bun run bridge:wasm` first.');
	process.exit(1);
}

const server = spawn('bun', ['run', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
	// Its own dependency cache, so a running `bun run dev` is never re-optimised under it.
	env: { ...process.env, ONSPOT_VITE_CACHE_DIR: 'node_modules/.vite-checks' },
	stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

const profile = mkdtempSync(join(tmpdir(), 'onspot-practice-check-'));
const wav = join(profile, 'silence.wav');
const tone = join(profile, 'tone.wav');
silenceWav(wav);
toneWav(tone);
let browser;
try {
	await waitForServer();
	browser = await chromium.launch({
		executablePath: chromePath(),
		headless: true,
		args: [
			'--no-sandbox',
			'--mute-audio',
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			`--use-file-for-fake-audio-capture=${wav}`,
			'--autoplay-policy=no-user-gesture-required'
		]
	});
	const context = await browser.newContext({ permissions: ['microphone'] });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(BASE, { waitUntil: 'domcontentloaded' });

	await page.waitForFunction(
		() => {
			const prompt = document.querySelector('.prompt-text');
			return Boolean(prompt?.textContent?.trim());
		},
		undefined,
		{ timeout: 120_000 }
	);

	await page.evaluate(async () => {
		const url = performance
			.getEntriesByType('resource')
			.map((entry) => entry.name)
			.find((name) => name.includes('/src/lib/stores/practice.ts'));
		const { practice } = await import(url);
		globalThis.__practiceSnapshot = () => {
			let value;
			const stop = practice.subscribe((snapshot) => (value = snapshot));
			stop();
			return value;
		};
	});

	const snapshot = await page.evaluate(() => globalThis.__practiceSnapshot());
	if (snapshot.phase !== 'idle' || !snapshot.prompt.text) {
		throw new Error(`practice did not settle on a prompt: ${JSON.stringify(snapshot)}`);
	}

	const command = (name, payload = null) =>
		page.evaluate(
			async ({ name, payload }) => {
				const url = performance
					.getEntriesByType('resource')
					.map((entry) => entry.name)
					.find((entry) => entry.includes('/src/lib/core-client/client.ts'));
				const { getCoreClient } = await import(url);
				const client = await getCoreClient();
				return client.command(name, payload);
			},
			{ name, payload }
		);

	const started = await command('practice.start_recording');
	if (started.snapshot.phase !== 'recording') {
		throw new Error(`start did not record: ${JSON.stringify(started.snapshot)}`);
	}
	await page.waitForTimeout(700);
	const cancelled = await command('practice.cancel_recording');
	if (cancelled.snapshot.phase !== 'idle') {
		throw new Error(`cancel did not return to idle: ${JSON.stringify(cancelled.snapshot)}`);
	}

	await command('practice.start_recording');
	await page.waitForTimeout(900);
	const stopped = await command('practice.stop_and_analyze');
	if (stopped.snapshot.phase !== 'error' || stopped.snapshot.error?.code !== 'practice.take_silent') {
		throw new Error(`silence was not rejected: ${JSON.stringify(stopped.snapshot)}`);
	}

	if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
	const full = await fullLoopCheck(tone);
	console.log(
		`practice check passed: prompt ${snapshot.prompt.id}, start → cancel → silent take rejected; ${full}`
	);
} catch (error) {
	console.error(String(error));
	if (serverLog) console.error(serverLog.slice(-4_000));
	process.exitCode = 1;
} finally {
	await browser?.close();
	server.kill('SIGTERM');
	rmSync(profile, { recursive: true, force: true });
}
