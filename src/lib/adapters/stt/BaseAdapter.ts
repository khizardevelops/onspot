import type { ModelConfig, STTAdapterStatus, ModelProgress, TranscriptionResult, TranscribeOptions } from '../../types';
import { resampleAudioTo16kHz } from '../../utils/audio';

export interface ISTTAdapter {
  config: ModelConfig;
  status: STTAdapterStatus;
  progress: ModelProgress | null;
  
  load(onProgress?: (progress: ModelProgress) => void): Promise<void>;
  transcribe(
    audioData: ArrayBuffer | Blob | AudioBuffer | Float32Array,
    options?: TranscribeOptions
  ): Promise<TranscriptionResult>;
  dispose(): Promise<void>;
  isSupported(): boolean;
}

export abstract class BaseSTTAdapter implements ISTTAdapter {
  public config: ModelConfig;
  public status: STTAdapterStatus = 'unloaded';
  public progress: ModelProgress | null = null;
  protected onProgressCallback?: (progress: ModelProgress) => void;

  constructor(config: ModelConfig) {
    this.config = { ...config, status: 'unloaded' };
  }

  public abstract load(onProgress?: (progress: ModelProgress) => void): Promise<void>;
  public abstract doTranscribe(audio16kMono: Float32Array, durationSec: number, options?: TranscribeOptions): Promise<string>;

  public async transcribe(
    audioInput: ArrayBuffer | Blob | AudioBuffer | Float32Array,
    options?: TranscribeOptions
  ): Promise<TranscriptionResult> {
    if (this.status !== 'ready') {
      throw new Error(`Model ${this.config.name} is not ready (current status: ${this.status})`);
    }

    let audio16kMono: Float32Array;
    let durationSec: number;

    if (audioInput instanceof Float32Array) {
      audio16kMono = audioInput;
      durationSec = audioInput.length / 16000;
    } else {
      const resampled = await resampleAudioTo16kHz(audioInput);
      audio16kMono = resampled.audioData;
      durationSec = resampled.durationSec;
    }

    const startTime = performance.now();
    const text = await this.doTranscribe(audio16kMono, durationSec, options);
    const endTime = performance.now();

    const executionTimeMs = Math.round(endTime - startTime);
    const audioDurationSec = Math.round(durationSec * 100) / 100;
    const realTimeFactor = audioDurationSec > 0 
      ? Math.round((executionTimeMs / (audioDurationSec * 1000)) * 1000) / 1000 
      : 0;

    return {
      id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      modelId: this.config.id,
      modelName: this.config.name,
      text: text.trim(),
      executionTimeMs,
      audioDurationSec,
      realTimeFactor,
      timestamp: new Date().toLocaleTimeString()
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
    if (this.onProgressCallback) {
      this.onProgressCallback(this.progress);
    }
  }

  protected setStatus(status: STTAdapterStatus, error?: string) {
    this.status = status;
    this.config.status = status;
    if (error) {
      this.config.error = error;
    }
  }
}
