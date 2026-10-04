import {
	DEFAULT_HOP_SIZE,
	adjustScalesForShortInput,
	padPhonemeIds,
	trimEosRegion,
	trimPaddingByDurations
} from 'piper-plus';
import { ort } from '#lib/ort.js';
import { BaseTTSAdapter } from '../BaseTtsAdapter';
import { cachedFetch } from './cachedFetch';
import { createPhonemizer, loadJapaneseG2p, type WasmPhonemizer } from './japaneseG2p';
import type { ModelProgress, TtsModelConfig } from '#lib/types.js';

interface PiperPlusConfig {
	audio?: { sample_rate?: number; hop_size?: number };
	inference?: { noise_scale?: number; length_scale?: number; noise_w?: number };
	language_id_map?: Record<string, number>;
	prosody_id_map?: unknown;
}

/** piper-plus runtime defaults, used when a voice config does not set them. */
const DEFAULT_NOISE_SCALE = 0.4;
const DEFAULT_LENGTH_SCALE = 1.0;
const DEFAULT_NOISE_W = 0.5;
const DEFAULT_SAMPLE_RATE = 22050;

/**
 * A piper-plus voice (VITS) with the OpenJTalk/jpreprocess WASM phonemizer —
 * the Japanese counterpart of `PiperAdapter`, on the same worker, lifecycle
 * and onnxruntime-web instance.
 *
 * piper-plus's own `PiperPlus` class is not used as a whole: it downloads the
 * model itself (no cache, no progress) and silently drops Japanese when its
 * phonemizer fails to load. This adapter keeps onspot's download cache,
 * progress and idle release, drives the phonemizer directly, and reuses
 * piper-plus's short-text helpers so padding/trimming match its tested
 * behaviour. Feeds follow `PiperPlus._infer` (piper-plus@0.7.0).
 */
export class PiperPlusAdapter extends BaseTTSAdapter {
	private session: any = null;
	private phonemizer: WasmPhonemizer | null = null;
	private voiceConfig: PiperPlusConfig | null = null;
	private readonly modelUrl: string;
	private readonly language: string;

	constructor(config: Partial<TtsModelConfig> & { id: string; name: string; voicePath: string; modelLanguage?: string }) {
		super({
			description: 'piper-plus VITS voice with OpenJTalk phonemization',
			provider: 'piper-plus',
			modelRepoId: config.voicePath,
			downloadSize: '~40 MB',
			language: 'Japanese (ja)',
			sampleRate: DEFAULT_SAMPLE_RATE,
			status: 'unloaded',
			...config
		} as TtsModelConfig);
		this.modelUrl = config.voicePath;
		this.language = config.modelLanguage ?? 'ja';
	}

	private get configUrl(): string {
		return this.modelUrl.slice(0, this.modelUrl.lastIndexOf('/') + 1) + 'config.json';
	}

	public async load(onProgress?: (p: ModelProgress) => void): Promise<void> {
		if (onProgress) this.onProgressCallback = onProgress;
		if (this.session && this.phonemizer) {
			this.setStatus('ready');
			return;
		}

		try {
			this.setStatus('loading');
			this.updateProgress('Fetching voice config...', 1);
			const configBytes = await cachedFetch(this.configUrl);
			const configJson = new TextDecoder().decode(configBytes);
			const config = JSON.parse(configJson) as PiperPlusConfig;
			if (config.language_id_map?.[this.language] === undefined) {
				throw new Error(`${this.config.name} has no "${this.language}" voice.`);
			}
			this.voiceConfig = config;

			// Japanese dictionary first (shared by every Japanese voice), then the voice.
			await loadJapaneseG2p((loaded, total) => {
				this.updateProgress(
					`Downloading Japanese dictionary ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
					2 + Math.min(1, loaded / total) * 58
				);
			});
			this.phonemizer = createPhonemizer(configJson, this.language);

			const buffer = await cachedFetch(this.modelUrl, (loaded, total) => {
				this.updateProgress(
					total
						? `Downloading voice ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`
						: `Downloading voice ${(loaded / 1e6).toFixed(0)} MB`,
					60 + (total ? Math.min(1, loaded / total) : 0.5) * 35
				);
			});

			this.updateProgress('Preparing inference session...', 96);
			// int64 inputs rule out WebGPU (WGSL has no i64); WASM, like every Piper voice.
			this.session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });

			this.config.sampleRate = config.audio?.sample_rate ?? DEFAULT_SAMPLE_RATE;
			this.config.device = 'wasm';
			this.setStatus('ready');
			this.updateProgress('Ready (wasm)', 100);
		} catch (err: any) {
			console.error(`Failed to load ${this.config.name}:`, err);
			await this.release();
			this.setStatus('error', err?.message || 'Failed to load voice');
			throw err;
		}
	}

	protected async doSynthesize(text: string) {
		const config = this.voiceConfig!;
		const encoded = this.phonemizer!.phonemize(text, this.language);
		let phonemeIds: number[];
		let prosody: number[][] | null = null;
		try {
			phonemeIds = Array.from(encoded.phonemeIds);
			const flat = encoded.prosodyFeatures;
			if (flat?.length) {
				prosody = [];
				for (let i = 0; i < flat.length; i += 3) prosody.push([flat[i], flat[i + 1], flat[i + 2]]);
			}
		} finally {
			encoded.free();
		}
		if (phonemeIds.length < 3) throw new Error('Nothing to say: the phonemizer returned no phonemes.');

		// piper-plus short-text handling: quieter noise for tiny inputs, silence
		// padding up to its minimum length, then a durations-based trim.
		const scales = adjustScalesForShortInput(
			phonemeIds.length,
			config.inference?.noise_scale ?? DEFAULT_NOISE_SCALE,
			config.inference?.noise_w ?? DEFAULT_NOISE_W
		);
		const padded = padPhonemeIds(phonemeIds, prosody);
		const ids: number[] = padded.phonemeIds;
		const length = ids.length;

		const inputs = new Set<string>(this.session.inputNames);
		const feeds: Record<string, any> = {
			input: new ort.Tensor('int64', BigInt64Array.from(ids, (id) => BigInt(id)), [1, length]),
			input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(length)]), [1]),
			scales: new ort.Tensor(
				'float32',
				Float32Array.from([scales.noiseScale, config.inference?.length_scale ?? DEFAULT_LENGTH_SCALE, scales.noiseW]),
				[3]
			)
		};
		if (inputs.has('lid')) {
			feeds.lid = new ort.Tensor('int64', BigInt64Array.from([BigInt(config.language_id_map![this.language])]), [1]);
		}
		if (inputs.has('sid')) {
			feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
		}
		if (inputs.has('prosody_features') && padded.prosodyFeatures && config.prosody_id_map) {
			feeds.prosody_features = new ort.Tensor(
				'int64',
				BigInt64Array.from(padded.prosodyFeatures.flat(), (value: number) => BigInt(value)),
				[1, length, 3]
			);
		}
		if (inputs.has('speaker_embedding')) {
			// Zero-shot exports require an embedding; none is used here (piper-plus
			// does the same). Its width varies by export (192 or 256), so it is read
			// from the model rather than assumed.
			const width = this.embeddingWidth();
			feeds.speaker_embedding = new ort.Tensor('float32', new Float32Array(width), [1, width]);
			if (inputs.has('speaker_embedding_mask')) {
				feeds.speaker_embedding_mask = new ort.Tensor('int64', BigInt64Array.from([0n]), [1, 1]);
			}
		}

		const result = await this.session.run(feeds);
		const output = result.output ?? result[this.session.outputNames[0]];
		let audio = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
		const durations = result.durations?.data ? Float32Array.from(result.durations.data) : null;

		const hop = config.audio?.hop_size && config.audio.hop_size > 0 ? config.audio.hop_size : DEFAULT_HOP_SIZE;
		if (durations) {
			audio = padded.wasPadded
				? trimPaddingByDurations(audio, durations, padded.frontPad, padded.backPad, hop)
				: trimEosRegion(audio, durations, hop);
		}

		return { audio, samplingRate: config.audio?.sample_rate ?? DEFAULT_SAMPLE_RATE };
	}

	private embeddingWidth(): number {
		const meta = (this.session.inputMetadata ?? []).find(
			(entry: { name: string }) => entry.name === 'speaker_embedding'
		) as { shape?: ReadonlyArray<number | string> } | undefined;
		const width = meta?.shape?.[1];
		return typeof width === 'number' && width > 0 ? width : 256;
	}

	private async release(): Promise<void> {
		if (this.session?.release) await this.session.release();
		this.session = null;
		this.phonemizer?.free();
		this.phonemizer = null;
	}

	public async dispose(): Promise<void> {
		await this.release();
		await super.dispose();
	}
}
