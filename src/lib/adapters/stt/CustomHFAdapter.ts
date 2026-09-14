import { BaseSTTAdapter } from './BaseAdapter';
import { createASRPipeline, createDownloadProgress, whisperTranscribe, type ASRDevice } from './engine';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

export class CustomHFAdapter extends BaseSTTAdapter {
  private transcriber: any = null;
  private device: ASRDevice | null = null;
  private resolvedDtype: string | null = null;

  constructor(repoId: string, customName?: string) {
    const cleanId = repoId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const config: ModelConfig = {
      id: `custom-${cleanId}`,
      name: customName || repoId,
      description: `Custom Hugging Face ONNX Speech-to-Text Model (${repoId})`,
      provider: 'Custom ONNX',
      modelRepoId: repoId,
      parameterCount: 'Custom',
      quantizedSize: 'Dynamic',
      language: 'French / Custom',
      isCustom: true,
      status: 'unloaded'
    };
    super(config);
  }

  public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
    if (onProgress) this.onProgressCallback = onProgress;
    if (this.transcriber) {
      this.setStatus('ready');
      return;
    }

    try {
      this.setStatus('loading');
      this.updateProgress('Initializing engine...', 5);

      this.updateProgress(`Loading ${this.config.modelRepoId}...`, 2);

      this.transcriber = await createASRPipeline(this.config.modelRepoId, {
        dtype: this.config.dtype,
        progress_callback: createDownloadProgress((status, percent, file) =>
          this.updateProgress(status, percent, file)
        ),
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
      console.error(`Failed to load custom model ${this.config.modelRepoId}:`, err);
      this.setStatus('error', err?.message || 'Failed to load custom ONNX model');
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
