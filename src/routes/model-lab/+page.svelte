<script lang="ts">
	/**
	 * Model lab: hands-on comparison of model variants, rated by ear/eye.
	 *
	 * STT: the product engine (Transformers.js whisper-small q4, via the
	 * product STT worker) side by side with whisper.cpp small q5_1 / q8_0
	 * (`@transcribe/shout`, in `whispercpp.worker.ts`). TTS: every voice the
	 * selected language offers, on the product Piper worker.
	 *
	 * Dev tooling like `ui-sandbox` / `stt-bench`: not linked from the nav, and
	 * imports no stores or database, so nothing here touches saved sessions or
	 * the TTS cache.
	 */
	import { onDestroy } from 'svelte';
	import { OFFERED_LANGUAGES, NEUTRAL_TUNING } from '#lib/languages/index.js';
	import { PRESET_FRENCH_SAMPLES, AudioRecorder, resampleAudioTo16kHz } from '#lib/utils/audio.js';
	import { calculateWER } from '#lib/utils/metrics.js';
	import { processPcm } from '#lib/utils/audioEffects.js';
	import { WorkerWhisperAdapter } from '#lib/adapters/stt/WorkerWhisperAdapter.js';
	import { WorkerPiperAdapter } from '#lib/adapters/tts/WorkerPiperAdapter.js';
	import { pcmToWavUrl } from '#lib/adapters/tts/roundTrip.js';
	import WhisperCppWorker from './whispercpp.worker?worker';

	const GGML_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
	// The thread budget ORT gets in `adapters/stt/engine.ts`, so speeds compare fairly.
	const THREADS = 2;

	let languageId = $state(OFFERED_LANGUAGES[0]?.id ?? 'fr');
	const language = $derived(OFFERED_LANGUAGES.find((entry) => entry.id === languageId)!);

	// ---------------------------------------------------------------- STT ---

	type EngineStatus = 'unloaded' | 'loading' | 'ready' | 'busy' | 'error';

	interface SttEngine {
		id: string;
		label: string;
		detail: string;
		status: EngineStatus;
		progress: number;
		message: string;
		loadMs: number;
	}

	let engines = $state<SttEngine[]>([
		{
			id: 'tjs',
			label: 'Transformers.js · whisper-small q4',
			detail: 'Current app engine · 299 MB · ~1.9 GB RAM loaded',
			status: 'unloaded',
			progress: 0,
			message: '',
			loadMs: 0
		},
		{
			id: 'q5_1',
			label: 'whisper.cpp · small q5_1',
			detail: '190 MB · ~0.6 GB RAM · measured ~8× slower',
			status: 'unloaded',
			progress: 0,
			message: '',
			loadMs: 0
		},
		{
			id: 'q8_0',
			label: 'whisper.cpp · small q8_0',
			detail: '264 MB · ~0.6 GB RAM · measured ~12× slower',
			status: 'unloaded',
			progress: 0,
			message: '',
			loadMs: 0
		}
	]);

	let tjs: WorkerWhisperAdapter | null = null;
	const cppWorkers = new Map<string, { worker: Worker; nextId: number }>();

	function cppRequest(
		engineId: string,
		payload: Record<string, unknown>,
		onProgress?: (progress: number, status: string) => void
	): Promise<Record<string, unknown>> {
		const entry = cppWorkers.get(engineId)!;
		const id = entry.nextId++;
		return new Promise((resolve, reject) => {
			const listener = (event: MessageEvent<Record<string, unknown>>) => {
				const message = event.data;
				if (message.id !== id) return;
				if (message.type === 'progress') {
					onProgress?.(Number(message.progress), String(message.status));
					return;
				}
				entry.worker.removeEventListener('message', listener);
				if (message.type === 'error') reject(new Error(String(message.message)));
				else resolve(message);
			};
			entry.worker.addEventListener('message', listener);
			entry.worker.postMessage({ id, ...payload });
		});
	}

	async function loadEngine(engine: SttEngine) {
		engine.status = 'loading';
		engine.message = '';
		engine.progress = 0;
		const started = performance.now();
		try {
			if (engine.id === 'tjs') {
				tjs = new WorkerWhisperAdapter({
					id: 'lab-tjs',
					name: 'whisper-small q4',
					modelRepoId: 'onnx-community/whisper-small',
					dtype: 'q4'
				});
				await tjs.load((progress) => {
					engine.progress = Math.round(progress.progress);
					engine.message = progress.status;
				});
			} else {
				cppWorkers.set(engine.id, { worker: new WhisperCppWorker(), nextId: 1 });
				await cppRequest(
					engine.id,
					{ type: 'load', url: `${GGML_BASE}/ggml-small-${engine.id}.bin`, threads: THREADS },
					(progress, status) => {
						engine.progress = progress;
						engine.message = status;
					}
				);
			}
			engine.loadMs = Math.round(performance.now() - started);
			engine.status = 'ready';
			engine.message = '';
		} catch (error) {
			engine.status = 'error';
			engine.message = error instanceof Error ? error.message : String(error);
			unloadEngine(engine, false);
		}
	}

	/** Terminates the engine's worker, which is the only way to give WASM memory back. */
	function unloadEngine(engine: SttEngine, reset = true) {
		if (engine.id === 'tjs') {
			void tjs?.dispose();
			tjs = null;
		} else {
			cppWorkers.get(engine.id)?.worker.terminate();
			cppWorkers.delete(engine.id);
		}
		if (reset) {
			engine.status = 'unloaded';
			engine.progress = 0;
			engine.message = '';
		}
	}

	async function transcribeWith(engine: SttEngine, pcm: Float32Array): Promise<string> {
		if (engine.id === 'tjs') {
			const result = await tjs!.transcribe(pcm, { language: language.stt.decoderLanguage });
			return result.text;
		}
		const copy = pcm.slice();
		const message = await cppRequest(engine.id, {
			type: 'transcribe',
			pcm: copy,
			lang: language.stt.code
		});
		return String(message.text ?? '');
	}

	// Audio sources: record, upload, or a scored eval clip (French only).
	const evalClips = PRESET_FRENCH_SAMPLES.filter((sample) => sample.referenceText);
	let clipId = $state('');
	let audio = $state<{ pcm: Float32Array; durationSec: number; url: string; label: string } | null>(
		null
	);
	let reference = $state('');
	let recorder: AudioRecorder | null = null;
	let recording = $state(false);
	let sourceError = $state('');

	function setAudio(pcm: Float32Array, durationSec: number, url: string, label: string) {
		if (audio?.url.startsWith('blob:')) URL.revokeObjectURL(audio.url);
		audio = { pcm, durationSec, url, label };
	}

	async function toggleRecording() {
		sourceError = '';
		try {
			if (!recording) {
				recorder = new AudioRecorder();
				await recorder.start();
				recording = true;
				return;
			}
			const { blob, url } = await recorder!.stop();
			recording = false;
			const { audioData, durationSec } = await resampleAudioTo16kHz(blob);
			setAudio(audioData, durationSec, url, 'Your recording');
			clipId = '';
			reference = '';
		} catch (error) {
			recording = false;
			sourceError = error instanceof Error ? error.message : String(error);
		}
	}

	async function uploadFile(event: Event) {
		sourceError = '';
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			const { audioData, durationSec } = await resampleAudioTo16kHz(file);
			setAudio(audioData, durationSec, URL.createObjectURL(file), file.name);
			clipId = '';
			reference = '';
		} catch (error) {
			sourceError = `Could not decode ${file.name}: ${error instanceof Error ? error.message : error}`;
		}
	}

	async function pickClip() {
		sourceError = '';
		const clip = evalClips.find((entry) => entry.id === clipId);
		if (!clip) return;
		const { audioData, durationSec } = await clip.load();
		setAudio(audioData, durationSec, clip.audioUrl ?? '', clip.title);
		reference = clip.referenceText;
	}

	interface SttResult {
		engine: string;
		text: string;
		seconds: number;
		rtf: number;
		wer: number | null;
		error: string;
	}

	interface SttRun {
		id: number;
		source: string;
		language: string;
		durationSec: number;
		results: SttResult[];
	}

	let runs = $state<SttRun[]>([]);
	let running = $state(false);
	const loadedEngines = $derived(engines.filter((engine) => engine.status === 'ready'));

	async function runAll() {
		if (!audio || running) return;
		running = true;
		const run: SttRun = {
			id: Date.now(),
			source: audio.label,
			language: language.name,
			durationSec: Math.round(audio.durationSec * 10) / 10,
			results: []
		};
		runs = [run, ...runs];
		const current = runs[0];
		// Sequential, so one engine's timing is not slowed by another's.
		for (const engine of loadedEngines) {
			engine.status = 'busy';
			const started = performance.now();
			try {
				const text = await transcribeWith(engine, audio.pcm);
				const seconds = (performance.now() - started) / 1000;
				current.results.push({
					engine: engine.label,
					text,
					seconds: Math.round(seconds * 10) / 10,
					rtf: Math.round((seconds / audio.durationSec) * 100) / 100,
					// WER needs spaced words; Japanese is unspaced, so it is not scored.
					wer: reference && language.writing === 'spaced' ? calculateWER(reference, text) : null,
					error: ''
				});
			} catch (error) {
				current.results.push({
					engine: engine.label,
					text: '',
					seconds: 0,
					rtf: 0,
					wer: null,
					error: error instanceof Error ? error.message : String(error)
				});
			}
			engine.status = 'ready';
		}
		running = false;
	}

	// ---------------------------------------------------------------- TTS ---

	const SAMPLE_TEXT: Record<string, string> = {
		fr: "Bonjour ! Je m'appelle Claire. Ce week-end, je suis allée au marché avec mes amis, et on a acheté des fraises délicieuses.",
		ja: 'こんにちは。私の名前はさくらです。週末は友達と市場に行って、おいしいいちごを買いました。'
	};

	let ttsText = $state(SAMPLE_TEXT[OFFERED_LANGUAGES[0]?.id ?? 'fr'] ?? '');
	let applyProfile = $state(true);

	interface VoiceResult {
		status: 'idle' | 'working' | 'done' | 'error';
		url: string;
		seconds: number;
		rtf: number;
		message: string;
	}

	let voiceResults = $state<Record<string, VoiceResult>>({});
	const piper = new WorkerPiperAdapter();

	function changeLanguage(id: string) {
		languageId = id;
		ttsText = SAMPLE_TEXT[id] ?? '';
		voiceResults = {};
	}

	async function speak(voiceId: string) {
		const previous = voiceResults[voiceId];
		if (previous?.url) URL.revokeObjectURL(previous.url);
		voiceResults[voiceId] = { status: 'working', url: '', seconds: 0, rtf: 0, message: '' };
		const result = voiceResults[voiceId];
		try {
			// Download/initialise first so the timing below is synthesis only.
			await piper.preload(voiceId, (progress) => {
				result.message = `${progress.status} ${Math.round(progress.progress)}%`;
			});
			result.message = 'synthesising';
			const started = performance.now();
			const speech = await piper.synthesize(voiceId, ttsText);
			const seconds = (performance.now() - started) / 1000;
			const voice = language.voices.find((entry) => entry.id === voiceId);
			const pcm = applyProfile
				? await processPcm(speech.audio, speech.samplingRate, voice?.processing, NEUTRAL_TUNING)
				: speech.audio;
			result.url = pcmToWavUrl(pcm, speech.samplingRate);
			result.seconds = Math.round(seconds * 10) / 10;
			result.rtf = speech.durationSec ? Math.round((seconds / speech.durationSec) * 100) / 100 : 0;
			result.message = '';
			result.status = 'done';
		} catch (error) {
			result.status = 'error';
			result.message = error instanceof Error ? error.message : String(error);
		}
	}

	async function speakAll() {
		for (const voice of language.voices) await speak(voice.id);
	}

	onDestroy(() => {
		for (const engine of engines) unloadEngine(engine, false);
		piper.dispose();
	});
</script>

<main class="lab">
	<header>
		<h1>Model lab</h1>
		<p class="muted">
			Try model variants yourself and judge them by ear and eye. Nothing here is saved to your
			sessions. Models download on first load; the whisper.cpp files are cached afterwards.
		</p>
		<label class="row">
			Language
			<select value={languageId} onchange={(event) => changeLanguage(event.currentTarget.value)}>
				{#each OFFERED_LANGUAGES as entry (entry.id)}
					<option value={entry.id}>{entry.name} · {entry.nativeName}</option>
				{/each}
			</select>
		</label>
	</header>

	<section>
		<h2>Speech-to-text</h2>
		<p class="muted">
			Load the engines you want to compare, give them audio, then run. They run one after another
			so the timings are fair. Loading all three needs roughly 3 GB of RAM; unload one to free its
			memory. <strong>rtf</strong> = processing time ÷ audio length (below 1 is faster than real
			time).
		</p>

		<div class="cards">
			{#each engines as engine (engine.id)}
				<div class="card">
					<strong>{engine.label}</strong>
					<span class="muted">{engine.detail}</span>
					<span>
						{engine.status}{#if engine.status === 'loading'} · {engine.message} {engine.progress}%{/if}
						{#if engine.status === 'ready' && engine.loadMs} · loaded in {(engine.loadMs / 1000).toFixed(1)} s{/if}
					</span>
					{#if engine.status === 'error'}<span class="error">{engine.message}</span>{/if}
					{#if engine.status === 'unloaded' || engine.status === 'error'}
						<button onclick={() => loadEngine(engine)}>Load</button>
					{:else}
						<button onclick={() => unloadEngine(engine)} disabled={engine.status !== 'ready'}>
							Unload
						</button>
					{/if}
				</div>
			{/each}
		</div>

		<h3>Audio</h3>
		<div class="row wrap">
			<button onclick={toggleRecording}>{recording ? '■ Stop recording' : '● Record'}</button>
			<label class="file">
				Upload audio
				<input type="file" accept="audio/*,video/*" onchange={uploadFile} />
			</label>
			{#if language.id === 'fr'}
				<select bind:value={clipId} onchange={pickClip}>
					<option value="">Eval clip (scored)…</option>
					{#each evalClips as clip (clip.id)}
						<option value={clip.id}>{clip.title}</option>
					{/each}
				</select>
			{/if}
		</div>
		{#if sourceError}<p class="error">{sourceError}</p>{/if}
		{#if audio}
			<div class="row wrap">
				<span>{audio.label} · {audio.durationSec.toFixed(1)} s</span>
				{#if audio.url}<audio controls src={audio.url}></audio>{/if}
			</div>
			{#if reference}
				<details><summary>Reference transcript</summary><p>{reference}</p></details>
			{/if}
		{/if}

		<button
			class="primary"
			onclick={runAll}
			disabled={!audio || running || loadedEngines.length === 0}
		>
			{running ? 'Transcribing…' : `Transcribe with ${loadedEngines.length} loaded engine(s)`}
		</button>

		{#each runs as run (run.id)}
			<div class="run">
				<p class="muted">{run.source} · {run.language} · {run.durationSec} s</p>
				{#each run.results as result (result.engine)}
					<div class="result">
						<div class="row wrap">
							<strong>{result.engine}</strong>
							{#if !result.error}
								<span class="muted">
									{result.seconds} s · rtf {result.rtf}{#if result.wer !== null} · WER {result.wer}%{/if}
								</span>
							{/if}
						</div>
						{#if result.error}<p class="error">{result.error}</p>{:else}<p>{result.text}</p>{/if}
					</div>
				{/each}
				{#if running && run === runs[0]}<p class="muted">Working…</p>{/if}
			</div>
		{/each}
	</section>

	<section>
		<h2>Text-to-speech</h2>
		<p class="muted">
			There is no GGUF / whisper.cpp-style alternative runtime for these voices (Piper and
			piper-plus are ONNX-only), so the variants here are the voices {language.name} offers. Each
			downloads on first use.
		</p>
		<textarea bind:value={ttsText} rows="3"></textarea>
		<div class="row wrap">
			<label class="row">
				<input type="checkbox" bind:checked={applyProfile} />
				Apply each voice's approved EQ/loudness profile (what the app plays)
			</label>
			<button class="primary" onclick={speakAll} disabled={!ttsText.trim()}>Generate all</button>
		</div>

		<div class="cards">
			{#each language.voices as voice (voice.id)}
				{@const result = voiceResults[voice.id]}
				<div class="card">
					<strong>{voice.name}</strong>
					<span class="muted">{voice.downloadSize}</span>
					{#if voice.id === language.defaultVoice}<span class="muted">App default</span>{/if}
					<button
						onclick={() => speak(voice.id)}
						disabled={!ttsText.trim() || result?.status === 'working'}
					>
						{result?.status === 'working' ? `Generating… ${result.message}` : 'Generate'}
					</button>
					{#if result?.status === 'done'}
						<audio controls src={result.url}></audio>
						<span class="muted">{result.seconds} s · rtf {result.rtf}</span>
					{:else if result?.status === 'error'}
						<span class="error">{result.message}</span>
					{/if}
				</div>
			{/each}
		</div>
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
		gap: 32px;
		align-content: start;
	}
	section {
		display: grid;
		gap: 12px;
	}
	.lab h1 {
		font-size: 1.6rem;
		font-weight: 700;
		margin: 0 0 4px;
	}
	.lab h2 {
		font-size: 1.25rem;
		font-weight: 650;
		margin: 0;
	}
	.lab h3 {
		font-size: 1rem;
		font-weight: 600;
		margin: 8px 0 0;
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
		font-size: 0.9rem;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.wrap {
		flex-wrap: wrap;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 12px;
	}
	.card,
	.run {
		display: grid;
		gap: 6px;
		align-content: start;
		padding: 12px;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 12px;
	}
	.result {
		padding-top: 8px;
		border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}
	button,
	select,
	.file,
	textarea {
		font: inherit;
		color: inherit;
		background: color-mix(in srgb, currentColor 6%, transparent);
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 8px;
		padding: 6px 12px;
		cursor: pointer;
	}
	textarea {
		cursor: text;
		width: 100%;
		box-sizing: border-box;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.primary {
		justify-self: start;
		font-weight: 600;
		background: color-mix(in srgb, currentColor 14%, transparent);
	}
	.file input {
		display: none;
	}
	audio {
		width: 100%;
		max-width: 360px;
	}
</style>
