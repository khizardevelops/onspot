import type { ISTTAdapter } from './BaseAdapter';
import { MoonshineTinyFrAdapter } from './MoonshineTinyFrAdapter';
import { WhisperAdapter } from './WhisperAdapter';
import { WebSpeechAdapter } from './WebSpeechAdapter';
import { CustomHFAdapter } from './CustomHFAdapter';
import type { ModelConfig, ModelProgress, TranscriptionResult } from '../../types';

class STTRegistry {
  private adapters: Map<string, ISTTAdapter> = new Map();

  constructor() {
    this.initDefaultAdapters();
  }

  private initDefaultAdapters() {
    // Registration order is presentation order only; it implies no ranking.
    const moonshine = new MoonshineTinyFrAdapter();
    this.adapters.set(moonshine.config.id, moonshine);

    const whisperTiny = new WhisperAdapter({
      id: 'whisper-tiny-fr',
      name: 'Whisper Tiny (French)',
      description: 'Multilingual Whisper Tiny ONNX model (39M parameters)',
      modelRepoId: 'onnx-community/whisper-tiny',
      dtype: 'fp32',
      parameterCount: '39M',
      quantizedSize: '~152 MB (fp32)',
      language: 'Multilingual / French'
    });
    this.adapters.set(whisperTiny.config.id, whisperTiny);


    // Every card below is a GENERIC multilingual Whisper decoded with
    // `language: 'french'`. The "(French)" in a card name means "transcribing
    // French", NOT "fine-tuned on French".
    //
    // A real French fine-tune (onnx-community/whisper-small-cv11-french-ONNX)
    // was evaluated and deliberately NOT added: 2.4% WER on eval/set1 but 21.7%
    // aggregate across all three clips, truncating 24 of 88 words on eval2 and
    // rendering "Montpellier" as "mon pilier". It is fine-tuned on Common Voice
    // read speech and collapses on multi-speaker conversation. See state.md.

    // Quantized variants.
    //
    // q4 is the only quantized precision that works. Measured in a browser on
    // `eval/set1` against onnx-community/whisper-base (fp32 baseline 7.2% WER):
    //
    //   q4   @ wasm    ->  9.6% WER, rtf 0.387   <- usable, 142MB vs 291MB
    //   q4   @ webgpu  -> 92.0% WER              <- loads, emits nonsense
    //   int8 @ wasm    -> will not build a session
    //   int8 @ webgpu  -> 68.8% WER, rtf 2.675   <- wrong and 12x slower
    //
    // int8/uint8/q8 are the same 53.7MB export under three names, and all of
    // them carry a malformed 4-bit `embed_tokens` whose scale tensor is missing,
    // so ONNX Runtime Web refuses them. The newer `-ONNX` re-export fails
    // identically. See known-issues.md before trying again.
    const whisperBaseQ4 = new WhisperAdapter({
      id: 'whisper-base-fr-q4',
      name: 'Whisper Base (French, q4)',
      description: 'Multilingual Whisper Base, 4-bit weights (74M). Smallest download; 11.0% WER.',
      modelRepoId: 'onnx-community/whisper-base',
      dtype: 'q4',
      parameterCount: '74M',
      quantizedSize: '~142 MB (q4)',
      language: 'Multilingual / French'
    });
    this.adapters.set(whisperBaseQ4.config.id, whisperBaseQ4);

    const whisperSmallQ4 = new WhisperAdapter({
      id: 'whisper-small-fr-q4',
      name: 'Whisper Small (French, q4)',
      description: 'Multilingual Whisper Small, 4-bit weights (244M). Not a French fine-tune - best measured French accuracy: 5.5% WER.',
      modelRepoId: 'onnx-community/whisper-small',
      dtype: 'q4',
      parameterCount: '244M',
      quantizedSize: '~299 MB (q4)',
      language: 'Multilingual / French'
    });
    this.adapters.set(whisperSmallQ4.config.id, whisperSmallQ4);

    const webSpeech = new WebSpeechAdapter();
    if (webSpeech.isSupported()) {
      this.adapters.set(webSpeech.config.id, webSpeech);
    }
  }

  public getAllConfigs(): ModelConfig[] {
    return Array.from(this.adapters.values()).map((adapter) => adapter.config);
  }

  public getAdapter(id: string): ISTTAdapter | undefined {
    return this.adapters.get(id);
  }

  public registerCustomModel(repoId: string, customName?: string): ISTTAdapter {
    const adapter = new CustomHFAdapter(repoId, customName);
    this.adapters.set(adapter.config.id, adapter);
    return adapter;
  }

  public removeAdapter(id: string) {
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.dispose();
      this.adapters.delete(id);
    }
  }

  public async loadModel(
    id: string,
    onProgress?: (progress: ModelProgress) => void
  ): Promise<ISTTAdapter> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Model adapter with ID "${id}" not found in registry`);
    }
    await adapter.load(onProgress);
    return adapter;
  }

  public async runTranscription(
    id: string,
    audioData: Float32Array | Blob | AudioBuffer
  ): Promise<TranscriptionResult> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Model adapter with ID "${id}" not found`);
    }
    if (adapter.status !== 'ready') {
      await adapter.load();
    }
    return adapter.transcribe(audioData);
  }

  public async runMultiTranscription(
    modelIds: string[],
    audioData: Float32Array | Blob | AudioBuffer
  ): Promise<TranscriptionResult[]> {
    const results: TranscriptionResult[] = [];
    for (const id of modelIds) {
      try {
        const res = await this.runTranscription(id, audioData);
        results.push(res);
      } catch (err: any) {
        console.error(`Error transcribing with model ${id}:`, err);
        results.push({
          id: `err-${Date.now()}`,
          modelId: id,
          modelName: this.adapters.get(id)?.config.name || id,
          text: `[Transcription Failed: ${err?.message || err}]`,
          executionTimeMs: 0,
          audioDurationSec: 0,
          realTimeFactor: 0,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }
    return results;
  }
}

export const sttRegistry = new STTRegistry();
