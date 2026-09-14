import { ort } from '../../ort';
import { BaseTTSAdapter } from './BaseTTSAdapter';
import { cachedFetch, isCached } from './cachedFetch';
import { phonemize } from './phonemize';
import type { ModelProgress, TtsChoice, TtsModelConfig } from '../../types';

const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

interface PiperVoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers?: number;
  speaker_id_map?: Record<string, number>;
}

/**
 * One Piper voice = one card, because each voice is a separate download.
 *
 * Speakers within a voice are configuration rather than separate cards: a
 * multi-speaker checkpoint holds every speaker in the same weights, so choosing
 * one costs nothing extra.
 *
 * Runs against `onnxruntime-web` directly instead of `piper-tts-web`, which
 * pins its own ORT and Transformers copies.
 */
export class PiperAdapter extends BaseTTSAdapter {
  private session: any = null;
  private voiceConfig: PiperVoiceConfig | null = null;
  private readonly voicePath: string;

  constructor(config: Partial<TtsModelConfig> & { id: string; name: string; voicePath: string }) {
    super({
      description: 'Piper VITS French voice',
      provider: 'Piper',
      modelRepoId: 'rhasspy/piper-voices',
      downloadSize: '~63 MB',
      language: 'French (fr)',
      sampleRate: 22050,
      status: 'unloaded',
      ...config,
    } as TtsModelConfig);
    this.voicePath = config.voicePath;
  }

  private get modelUrl() {
    return `${VOICES_BASE}${this.voicePath}`;
  }

  /** Lets the card show "cached" instead of implying a fresh download. */
  public async checkCached(): Promise<boolean> {
    return isCached(this.modelUrl);
  }

  public setSpeaker(speakerId: string) {
    this.config.selectedSpeaker = speakerId;
  }

  public async load(onProgress?: (p: ModelProgress) => void): Promise<void> {
    if (onProgress) this.onProgressCallback = onProgress;
    if (this.session) { this.setStatus('ready'); return; }

    try {
      this.setStatus('loading');
      this.updateProgress('Fetching voice config...', 2);
      const cfg: PiperVoiceConfig = await (await fetch(`${this.modelUrl}.json`)).json();
      this.voiceConfig = cfg;

      const map = cfg.speaker_id_map ?? {};
      if ((cfg.num_speakers ?? 1) > 1 && Object.keys(map).length) {
        this.config.speakers = Object.entries(map)
          .sort((a, b) => a[1] - b[1])
          .map(([name, id]) => ({ id: String(id), label: `${name} (#${id})` }) as TtsChoice);
        this.config.selectedSpeaker ??= this.config.speakers[0].id;
      }

      // Cache-backed: a refresh reuses the bytes instead of re-downloading.
      const buffer = await cachedFetch(this.modelUrl, (loaded, total) => {
        this.updateProgress(
          total
            ? `Downloading ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`
            : `Downloading ${(loaded / 1e6).toFixed(0)} MB`,
          total ? Math.min(95, (loaded / total) * 95) : 50
        );
      });

      this.updateProgress('Preparing inference session...', 96);
      this.session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });

      this.config.sampleRate = cfg.audio.sample_rate;
      this.config.device = 'wasm';
      this.setStatus('ready');
      this.updateProgress('Ready (wasm)', 100);
    } catch (err: any) {
      console.error(`Failed to load ${this.config.name}:`, err);
      this.setStatus('error', err?.message || 'Failed to load voice');
      throw err;
    }
  }

  protected async doSynthesize(text: string) {
    const cfg = this.voiceConfig!;
    const ids = await phonemize(text, cfg.espeak.voice);
    if (!ids.length) throw new Error('Phonemizer returned no tokens');

    const { noise_scale, length_scale, noise_w } = cfg.inference;
    const feeds: Record<string, any> = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map((n) => BigInt(n))), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale, noise_w]), [3]),
    };

    // Multi-speaker graphs declare `sid`; single-speaker ones reject it.
    if (this.session.inputNames.includes('sid')) {
      feeds.sid = new ort.Tensor('int64',
        BigInt64Array.from([BigInt(Number(this.config.selectedSpeaker ?? 0) || 0)]), [1]);
    }

    const result = await this.session.run(feeds);
    const raw = result[this.session.outputNames[0]].data as Float32Array;
    return {
      audio: raw instanceof Float32Array ? raw : Float32Array.from(raw),
      samplingRate: cfg.audio.sample_rate,
    };
  }

  public async dispose(): Promise<void> {
    if (this.session?.release) await this.session.release();
    this.session = null;
    await super.dispose();
  }
}
