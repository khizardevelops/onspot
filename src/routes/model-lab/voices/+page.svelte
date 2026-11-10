<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * Voice check: loads every on-device voice in the voice table
	 * (`#lib/languages/voices.ts`) on the product voice worker, speaks one
	 * sentence in its language, and checks that the voice produced speech: not
	 * silent, a plausible length for the sentence, and how fast it was made.
	 * The project rule is that no voice ships before it has loaded and spoken
	 * in a browser; this page runs that check for all of them. Whether a voice
	 * sounds good is still a listening decision.
	 *
	 * Dev tooling like `model-lab`: not linked from the nav, and imports no
	 * stores or database, so nothing here touches saved sessions. Voices
	 * download into the TTS cache, as they would in the app.
	 */
	import { onDestroy } from 'svelte';
	import { VOICE_SAMPLE_SENTENCES, VOICES_BY_LANGUAGE } from '#lib/languages/voices.js';
	import type { LanguageVoice } from '#lib/languages/index.js';
	import { LocalVoiceWorker } from '#lib/speech/tts/local/LocalVoiceWorker.js';
	import { pcmToWavUrl } from '#lib/utils/wav.js';


	/** Below this peak a clip is silence (the same threshold the read-back uses). */
	const SILENCE_PEAK = 0.001;

	/**
	 * Plausible speech length per written character. Latin-script sentences
	 * take about 0.07 s a character, Chinese and Japanese about 0.2 s; outside
	 * this range the voice skipped the text or stalled on it.
	 */
	const MIN_SECONDS_PER_CHARACTER = 0.02;
	const MAX_SECONDS_PER_CHARACTER = 0.35;

	type CheckStatus = 'idle' | 'working' | 'pass' | 'fail';

	interface VoiceCheck {
		status: CheckStatus;
		message: string;
		loadSeconds: number;
		audioSeconds: number;
		realTimeFactor: number;
		peak: number;
		url: string;
	}

	const languageCodes = Object.keys(VOICES_BY_LANGUAGE).sort();
	const worker = new LocalVoiceWorker();

	let languageFilter = $state('all');
	/** All ten Supertonic styles per language; by default one, since the styles share the weights. */
	let everySupertonicStyle = $state(false);
	let running = $state(false);
	let checks = $state<Record<string, VoiceCheck>>({});

	const selectedVoices = $derived(
		languageCodes
			.filter((code) => languageFilter === 'all' || code === languageFilter)
			.flatMap((code) => VOICES_BY_LANGUAGE[code].map((voice) => ({ code, voice })))
			.filter(({ voice }) => everySupertonicStyle || voice.engine !== 'supertonic' || voice.style === 0)
	);

	const finished = $derived(Object.values(checks).filter((check) => check.status === 'pass' || check.status === 'fail'));
	const failed = $derived(finished.filter((check) => check.status === 'fail'));

	/** Why a clip is not plausible speech for the sentence, or null when it is. */
	function implausibility(sentence: string, audioSeconds: number, peak: number): string | null {
		if (peak < SILENCE_PEAK) return `silent (peak ${peak})`;

		const secondsPerCharacter = audioSeconds / [...sentence].length;
		if (secondsPerCharacter < MIN_SECONDS_PER_CHARACTER) return `too short (${audioSeconds.toFixed(2)} s)`;
		if (secondsPerCharacter > MAX_SECONDS_PER_CHARACTER) return `too long (${audioSeconds.toFixed(2)} s)`;
		return null;
	}

	async function checkVoice(code: string, voice: LanguageVoice): Promise<void> {
		const previous = checks[voice.id];
		if (previous?.url) URL.revokeObjectURL(previous.url);

		checks[voice.id] = { status: 'working', message: 'loading', loadSeconds: 0, audioSeconds: 0, realTimeFactor: 0, peak: 0, url: '' };
		const check = checks[voice.id];
		const sentence = VOICE_SAMPLE_SENTENCES[code];

		try {
			if (!sentence) throw new Error(`No check sentence for "${code}".`);

			const loadStarted = performance.now();
			await worker.preload(voice.id, (progress) => {
				check.message = `${progress.status} ${Math.round(progress.progress)}%`;
			});
			check.loadSeconds = (performance.now() - loadStarted) / 1000;

			check.message = 'speaking';
			const speakStarted = performance.now();
			const speech = await worker.synthesize(voice.id, sentence);
			const speakSeconds = (performance.now() - speakStarted) / 1000;

			check.audioSeconds = speech.durationSec;
			check.realTimeFactor = speech.durationSec > 0 ? speakSeconds / speech.durationSec : 0;
			check.peak = speech.peak;
			check.url = pcmToWavUrl(speech.audio, speech.samplingRate);

			const problem = implausibility(sentence, speech.durationSec, speech.peak);
			check.status = problem ? 'fail' : 'pass';
			check.message = problem ?? '';
		} catch (error) {
			check.status = 'fail';
			check.message = error instanceof Error ? error.message : String(error);
		}
	}

	async function checkSelected(): Promise<void> {
		running = true;
		try {
			for (const { code, voice } of selectedVoices) await checkVoice(code, voice);
		} finally {
			running = false;
		}
	}

	onDestroy(() => {
		for (const check of Object.values(checks)) if (check.url) URL.revokeObjectURL(check.url);
		worker.dispose();
	});
</script>

<main class="lab">
	<header>
		<h1>Voice check</h1>
		<p class="muted">
			Loads each on-device voice, speaks one sentence in its language and checks that it produced
			speech. Listening is still how a voice is approved. Voices download on first use.
		</p>
	</header>

	<section>
		<div class="row wrap">
			<label class="row">
				Language
				<select bind:value={languageFilter} disabled={running}>
					<option value="all">All ({languageCodes.length})</option>
					{#each languageCodes as code (code)}
						<option value={code}>{code} · {VOICES_BY_LANGUAGE[code].length} voices</option>
					{/each}
				</select>
			</label>
			<label class="row">
				<input type="checkbox" bind:checked={everySupertonicStyle} disabled={running} />
				Every Supertonic style (otherwise F1 only)
			</label>
			<button class="primary" onclick={checkSelected} disabled={running} data-action="check-selected">
				{running ? 'Checking…' : `Check ${selectedVoices.length} voices`}
			</button>
		</div>
		<p class="muted" data-summary>
			{finished.length} checked · {finished.length - failed.length} passed · {failed.length} failed
		</p>

		<table>
			<thead>
				<tr>
					<th>Language</th>
					<th>Voice</th>
					<th>Result</th>
					<th>Load</th>
					<th>Audio</th>
					<th>rtf</th>
					<th>Peak</th>
					<th>Listen</th>
				</tr>
			</thead>
			<tbody>
				{#each selectedVoices as { code, voice } (voice.id)}
					{@const check = checks[voice.id]}
					<tr data-voice-id={voice.id} data-status={check?.status ?? 'idle'}>
						<td>{code}</td>
						<td>{voice.name}</td>
						<td class:error={check?.status === 'fail'}>
							{check ? `${check.status}${check.message ? ` · ${check.message}` : ''}` : ''}
						</td>
						<td>{check?.loadSeconds ? `${check.loadSeconds.toFixed(1)} s` : ''}</td>
						<td>{check?.audioSeconds ? `${check.audioSeconds.toFixed(2)} s` : ''}</td>
						<td data-rtf>{check?.realTimeFactor ? check.realTimeFactor.toFixed(2) : ''}</td>
						<td>{check?.peak ? check.peak.toFixed(3) : ''}</td>
						<td>{#if check?.url}<audio controls src={check.url}></audio>{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</main>

<style>
	.lab {
		height: 100%;
		overflow: auto;
		padding: 24px 16px 64px;
		max-width: 1100px;
		margin: 0 auto;
		display: grid;
		gap: 24px;
		align-content: start;
	}
	section {
		display: grid;
		gap: 12px;
	}
	h1 {
		font-size: 1.6rem;
		font-weight: 700;
		margin: 0 0 4px;
	}
	p {
		margin: 0;
	}
	.muted {
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.error {
		color: #c0392b;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.wrap {
		flex-wrap: wrap;
	}
	table {
		border-collapse: collapse;
		font-size: 0.85rem;
		display: block;
		overflow-x: auto;
	}
	th,
	td {
		text-align: left;
		padding: 6px 8px;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		vertical-align: middle;
	}
	button,
	select {
		font: inherit;
		color: inherit;
		background: color-mix(in srgb, currentColor 6%, transparent);
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 8px;
		padding: 6px 12px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.primary {
		font-weight: 600;
		background: color-mix(in srgb, currentColor 14%, transparent);
	}
	audio {
		width: 220px;
		height: 32px;
	}
</style>
