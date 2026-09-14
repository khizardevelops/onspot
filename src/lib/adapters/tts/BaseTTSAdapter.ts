import type { ModelProgress, STTAdapterStatus, TtsModelConfig, TtsSynthesis } from '../../types';

export interface ITTSAdapter {
  config: TtsModelConfig;
  status: STTAdapterStatus;
  progress: ModelProgress | null;

  load(onProgress?: (p: ModelProgress) => void): Promise<void>;
  synthesize(text: string): Promise<TtsSynthesis>;
  dispose(): Promise<void>;
  isSupported(): boolean;
}

/**
 * Mirrors BaseSTTAdapter: same status/progress lifecycle, so the model cards
 * render identically for both labs.
 */
export abstract class BaseTTSAdapter implements ITTSAdapter {
  public config: TtsModelConfig;
  public status: STTAdapterStatus = 'unloaded';
  public progress: ModelProgress | null = null;
  protected onProgressCallback?: (p: ModelProgress) => void;

  constructor(config: TtsModelConfig) {
    this.config = { ...config, status: 'unloaded' };
  }

  public abstract load(onProgress?: (p: ModelProgress) => void): Promise<void>;
  protected abstract doSynthesize(text: string): Promise<{ audio: Float32Array; samplingRate: number }>;

  public async synthesize(text: string): Promise<TtsSynthesis> {
    if (this.status !== 'ready') await this.load();

    const started = performance.now();
    const { audio, samplingRate } = await this.doSynthesize(text);
    const synthesisMs = Math.round(performance.now() - started);
    const durationSec = audio.length / samplingRate;

    // A model can return a correctly-sized buffer of silence; peak is the only
    // cheap way to tell that apart from real speech.
    let peak = 0;
    for (let i = 0; i < audio.length; i++) {
      const v = Math.abs(audio[i]);
      if (v > peak) peak = v;
    }

    return {
      id: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      modelId: this.config.id,
      modelName: this.config.name,
      text,
      audio,
      samplingRate,
      durationSec: Math.round(durationSec * 100) / 100,
      synthesisMs,
      realTimeFactor: durationSec > 0 ? Math.round((synthesisMs / (durationSec * 1000)) * 1000) / 1000 : 0,
      peak: Math.round(peak * 1000) / 1000,
      timestamp: new Date().toLocaleTimeString(),
    };
  }

  public async dispose(): Promise<void> {
    this.status = 'unloaded';
    this.config.status = 'unloaded';
    this.progress = null;
  }

  public isSupported(): boolean {
    return true;
  }

  protected updateProgress(status: string, progress: number, file?: string) {
    this.progress = { status, progress: Math.min(100, Math.max(0, Math.round(progress))), file };
    this.config.progress = this.progress;
    this.onProgressCallback?.(this.progress);
  }

  protected setStatus(status: STTAdapterStatus, error?: string) {
    this.status = status;
    this.config.status = status;
    if (error) this.config.error = error;
  }
}
