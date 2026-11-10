// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseTTSAdapter } from '../BaseTtsAdapter';
import { holdSupertonicModel, releaseSupertonicModel } from './supertonicModel';
import { readableRuntimeError, type SherpaOfflineTts } from './sherpaRuntime';
import { SUPERTONIC_SPEED, SUPERTONIC_STEPS } from '#lib/languages/voices.js';
import type { ModelProgress, TtsModelConfig } from '#lib/types.js';

/**
 * Supertonic's raw output can overshoot full scale (peaks up to 1.7 were
 * measured at fewer steps, and 0.98 at 4). Louder output is scaled down to
 * this peak so a clip never clips; quieter output is left as it is.
 */
const PEAK_CEILING = 0.95;

const SUPERTONIC_SAMPLE_RATE = 44_100;

/**
 * One Supertonic voice: a language and a preset style on the shared
 * Supertonic 3 model (`./supertonicModel.ts`). Loading a voice holds the
 * model; disposing it lets go, and the last voice to go frees the model.
 */
export class SupertonicAdapter extends BaseTTSAdapter {
	private model: SherpaOfflineTts | null = null;
	private readonly language: string;
	private readonly style: number;

	constructor(config: { id: string; name: string; downloadSize: string; language: string; style: number }) {
		super({
			id: config.id,
			name: config.name,
			description: 'Supertonic 3 voice on the prebuilt sherpa-onnx runtime',
			provider: 'sherpa-onnx',
			modelRepoId: 'Supertone/supertonic-3',
			downloadSize: config.downloadSize,
			language: config.language,
			sampleRate: SUPERTONIC_SAMPLE_RATE,
			status: 'unloaded'
		} satisfies TtsModelConfig);
		this.language = config.language;
		this.style = config.style;
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (onProgress) this.onProgressCallback = onProgress;
		if (this.model) {
			this.setStatus('ready');
			return;
		}

		try {
			this.setStatus('loading');
			this.updateProgress('Preparing the Supertonic voices...', 1);

			this.model = await holdSupertonicModel((loadedBytes, totalBytes) => {
				const loadedMegabytes = (loadedBytes / 1e6).toFixed(0);
				const totalMegabytes = (totalBytes / 1e6).toFixed(0);
				this.updateProgress(`Downloading ${loadedMegabytes} / ${totalMegabytes} MB`, Math.min(95, (loadedBytes / totalBytes) * 95));
			});

			this.config.device = 'wasm';
			this.setStatus('ready');
			this.updateProgress('Ready (wasm)', 100);
		} catch (error) {
			console.error(`Failed to load ${this.config.name}:`, error);
			this.setStatus('error', error instanceof Error ? error.message : 'Failed to load the voice');
			throw error;
		}
	}

	protected async doSynthesize(text: string, pace: number): Promise<{ audio: Float32Array; samplingRate: number }> {
		if (!this.model) throw new Error(`${this.config.name} is not loaded.`);

		let generated: { samples: Float32Array; sampleRate: number };
		try {
			generated = this.model.generateWithConfig(text, {
				sid: this.style,
				speed: SUPERTONIC_SPEED * pace,
				numSteps: SUPERTONIC_STEPS,
				extra: { lang: this.language }
			});
		} catch (error) {
			console.error(`[supertonic] ${this.config.id} failed on ${text.length} characters`);
			throw readableRuntimeError(error, 'speaking');
		}
		if (generated.samples.length === 0) {
			throw new Error('The Supertonic voice could not speak this text.');
		}

		return { audio: limitPeak(generated.samples), samplingRate: generated.sampleRate };
	}

	public async dispose(): Promise<void> {
		if (this.model) {
			this.model = null;
			await releaseSupertonicModel();
		}
		await super.dispose();
	}
}

/** Scales the samples down when they overshoot `PEAK_CEILING`; otherwise returns them unchanged. */
function limitPeak(samples: Float32Array): Float32Array {
	let peak = 0;
	for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
	if (peak <= PEAK_CEILING) return samples;

	const gain = PEAK_CEILING / peak;
	for (let index = 0; index < samples.length; index++) samples[index] *= gain;
	return samples;
}
