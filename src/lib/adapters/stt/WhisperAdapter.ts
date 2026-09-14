import { BaseSTTAdapter } from './BaseAdapter';
import { createASRPipeline, createDownloadProgress, whisperTranscribe, type ASRDevice } from './engine';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

export class WhisperAdapter extends BaseSTTAdapter {
  private transcriber: any = null;
  private device: ASRDevice | null = null;
  private resolvedDtype: string | null = null;

  constructor(customConfig: Partial<ModelConfig> & { id: string; name: string; modelRepoId: string }) {
    const defaultConfig: ModelConfig = {
      id: customConfig.id,
      name: customConfig.name,
      description: customConfig.description || 'Whisper ONNX speech recognition model',
      provider: 'Transformers.js',
      modelRepoId: customConfig.modelRepoId,
      parameterCount: customConfig.parameterCount || '39M',
      quantizedSize: customConfig.quantizedSize || '~40 MB',
      language: 'Multilingual / French',
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
      console.error(`Failed to load ${this.config.name}:`, err);
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

    return whisperTranscribe(this.transcriber, audio16kMono, durationSec, options);
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
