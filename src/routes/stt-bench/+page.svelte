<script lang="ts">
	/**
	 * STT runtime bench: the product engine (Transformers.js whisper-small q4,
	 * in the STT worker) over every scored eval clip.
	 *
	 * Dev tooling, like `ui-sandbox`: imports no stores and is not linked from
	 * the nav. `&auto=1` starts at mount; progress and results are mirrored to
	 * `window.__bench` so a driver can sample the browser's RAM around it.
	 * whisper.cpp was measured here too and rejected (8-12x slower in WASM);
	 * see docs/benchmarks/stt.md.
	 *
	 * Aggregate WER is total errors / total reference words, never a mean.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { PRESET_FRENCH_SAMPLES } from '$lib/utils/audio';
	import { calculateWER, normalizeFrenchText } from '$lib/utils/metrics';
	import { WorkerWhisperAdapter } from '$lib/adapters/stt/WorkerWhisperAdapter';

	interface ClipResult {
		id: string;
		words: number;
		errors: number;
		wer: number;
		durationSec: number;
		rtf: number;
		text: string;
	}

	interface BenchState {
		status: 'idle' | 'loading' | 'running' | 'done' | 'error';
		message: string;
		loadMs: number;
		downloadBytes: number;
		clips: ClipResult[];
		aggregate: { words: number; errors: number; wer: number; rtf: number } | null;
	}

	// `&limit=n` runs only the first n clips, for a quick speed probe.
	const limit = Number(page.url.searchParams.get('limit') ?? 0) || undefined;
	const clips = PRESET_FRENCH_SAMPLES.filter((sample) => sample.referenceText).slice(0, limit);

	let run = $state<BenchState>({
		status: 'idle',
		message: '',
		loadMs: 0,
		downloadBytes: 0,
		clips: [],
		aggregate: null
	});

	function publish() {
		(window as unknown as { __bench: BenchState }).__bench = $state.snapshot(run) as BenchState;
	}

	/** Word-count errors from the rounded WER; exact at these clip lengths. */
	function score(reference: string, hypothesis: string) {
		const words = normalizeFrenchText(reference).split(/\s+/).filter(Boolean).length;
		const wer = calculateWER(reference, hypothesis);
		return { words, wer, errors: Math.round((wer * words) / 100) };
	}

	interface Engine {
		transcribe(pcm: Float32Array): Promise<string>;
	}

	async function loadTjs(): Promise<Engine> {
		const adapter = new WorkerWhisperAdapter({
			id: 'bench-tjs',
			name: 'whisper-small q4 (Transformers.js)',
			modelRepoId: 'onnx-community/whisper-small',
			dtype: 'q4',
			language: 'french'
		});
		await adapter.load((progress) => {
			run.message = `${progress.status} ${Math.round(progress.progress)}%`;
		});
		run.downloadBytes = 299_000_000;
		return {
			transcribe: async (pcm) => (await adapter.transcribe(pcm, { language: 'french' })).text
		};
	}

	async function start() {
		run.status = 'loading';
		run.clips = [];
		run.aggregate = null;
		publish();
		try {
			const started = performance.now();
			const bench = await loadTjs();
			run.loadMs = Math.round(performance.now() - started);
			run.status = 'running';
			publish();

			for (const clip of clips) {
				run.message = `transcribing ${clip.id}`;
				publish();
				const { audioData, durationSec } = await clip.load();
				const t0 = performance.now();
				const text = await bench.transcribe(audioData);
				const elapsed = (performance.now() - t0) / 1000;
				run.clips.push({
					id: clip.id,
					...score(clip.referenceText, text),
					durationSec: Math.round(durationSec * 10) / 10,
					rtf: Math.round((elapsed / durationSec) * 100) / 100,
					text
				});
				publish();
			}

			const words = run.clips.reduce((sum, clip) => sum + clip.words, 0);
			const errors = run.clips.reduce((sum, clip) => sum + clip.errors, 0);
			const audio = run.clips.reduce((sum, clip) => sum + clip.durationSec, 0);
			const compute = run.clips.reduce((sum, clip) => sum + clip.rtf * clip.durationSec, 0);
			run.aggregate = {
				words,
				errors,
				wer: Math.round((errors / words) * 1000) / 10,
				rtf: Math.round((compute / audio) * 100) / 100
			};
			run.status = 'done';
			run.message = '';
		} catch (error) {
			run.status = 'error';
			run.message = error instanceof Error ? error.message : String(error);
		}
		publish();
	}

	onMount(() => {
		publish();
		if (page.url.searchParams.get('auto') === '1') void start();
	});
</script>

<main style="padding: 24px; font-family: ui-monospace, monospace; overflow: auto; height: 100%;">
	<h1>STT runtime bench — whisper-small q4</h1>
	<p>
		<button onclick={start} disabled={run.status === 'loading' || run.status === 'running'}>
			Run
		</button>
	</p>
	<p>{run.status} {run.message}</p>
	{#if run.loadMs}<p>load {run.loadMs} ms · download {run.downloadBytes} bytes</p>{/if}
	<table>
		<thead><tr><th>clip</th><th>words</th><th>errors</th><th>WER</th><th>rtf</th></tr></thead>
		<tbody>
			{#each run.clips as clip (clip.id)}
				<tr><td>{clip.id}</td><td>{clip.words}</td><td>{clip.errors}</td><td>{clip.wer}%</td><td>{clip.rtf}</td></tr>
			{/each}
			{#if run.aggregate}
				<tr>
					<th>aggregate</th><th>{run.aggregate.words}</th><th>{run.aggregate.errors}</th>
					<th>{run.aggregate.wer}%</th><th>{run.aggregate.rtf}</th>
				</tr>
			{/if}
		</tbody>
	</table>
	{#each run.clips as clip (clip.id)}
		<details><summary>{clip.id}</summary><p>{clip.text}</p></details>
	{/each}
</main>
