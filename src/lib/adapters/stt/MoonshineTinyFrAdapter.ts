import { BaseSTTAdapter } from './BaseAdapter';
import { createASRPipeline, createDownloadProgress, windowedTranscribe, type ASRDevice } from './engine';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

/** Moonshine was trained on clips of 30s or less; longer input degrades badly. */
const WINDOW_SEC = 30;

/** Moonshine's own guidance for sizing the generation budget. */
const TOKENS_PER_SECOND = 6.5;

export class MoonshineTinyFrAdapter extends BaseSTTAdapter {
  private transcriber: any = null;
  private device: ASRDevice | null = null;
  private resolvedDtype: string | null = null;

  constructor(customConfig?: Partial<ModelConfig>) {
    const defaultConfig: ModelConfig = {
      id: 'moonshine-tiny-fr',
      name: 'Moonshine Tiny (French)',
      description: 'Ultra-lightweight ONNX Speech-to-Text model fine-tuned for French (27M parameters)',
      provider: 'Transformers.js',
      modelRepoId: 'onnx-community/moonshine-tiny-fr-ONNX',
      parameterCount: '27M',
      quantizedSize: '~109 MB (fp32)',
      language: 'French (fr)',
      status: 'unloaded'
    };
    super({ ...defaultConfig, ...customConfig });
  }

  public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
    if (onProgress) this.onProgressCallback = onProgress;
    if (this.transcriber) {
      this.setStatus('ready');
      return;
    }

    try {
      this.setStatus('loading');
      this.updateProgress('Initializing Transformers.js engine...', 2);

      const progress_callback = createDownloadProgress((status, percent, file) =>
        this.updateProgress(status, percent, file)
      );

      this.transcriber = await createASRPipeline(this.config.modelRepoId, {
        dtype: this.config.dtype,
        progress_callback,
        onDeviceResolved: (device, dtype) => {
          this.device = device;
          this.resolvedDtype = dtype;
          this.config.device = device;
          this.config.resolvedDtype = dtype;
        }
      });

      this.setStatus('ready');
      this.updateProgress(`Ready (${this.device} / ${this.resolvedDtype})`, 100);
    } catch (err: any) {
      console.error('Failed to load Moonshine Tiny FR model:', err);
      this.setStatus('error', err?.message || 'Failed to load model weights');
      throw err;
    }
  }

  public async doTranscribe(
    audio16kMono: Float32Array,
    durationSec: number,
    options?: TranscribeOptions
  ): Promise<string> {
    if (!this.transcriber) {
      await this.load();
    }

    // Moonshine ignores the pipeline's own `chunk_length_s`, so window it here.
    // The token budget is sized per window rather than from the clip's total
    // length, which previously let a long clip authorise a runaway generation.
    return windowedTranscribe(
      this.transcriber,
      audio16kMono,
      durationSec,
      WINDOW_SEC,
      (windowDurationSec) => ({
        max_new_tokens: Math.max(16, Math.ceil(windowDurationSec * TOKENS_PER_SECOND)),
        ...options
      })
    );
  }

  public async dispose(): Promise<void> {
    if (this.transcriber) {
      if (typeof this.transcriber.dispose === 'function') {
        await this.transcriber.dispose();
      }
      this.transcriber = null;
    }
    await super.dispose();
  }
}
