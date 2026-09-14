export type STTAdapterStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface ModelProgress {
  status: string;
  progress: number; // 0 to 100
  file?: string;
}

export interface TranscribeOptions {
  language?: string;
  task?: 'transcribe' | 'translate';
  subsegment?: boolean;
}

export interface TranscriptionResult {
  id: string;
  modelId: string;
  modelName: string;
  text: string;
  executionTimeMs: number;
  audioDurationSec: number;
  realTimeFactor: number; // executionTimeMs / (audioDurationSec * 1000)
  tokensPerSec?: number;
  wer?: number;
  cer?: number;
  timestamp: string;
  details?: Record<string, any>;
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  provider: 'Transformers.js' | 'Browser Native' | 'Custom ONNX';
  modelRepoId: string;
  parameterCount: string;
  quantizedSize: string;
  language: string;
  isCustom?: boolean;
  /** Weight precision this card requests, e.g. 'fp32' | 'q4'. */
  dtype?: string;
  /** Execution backend actually resolved at load time. */
  device?: 'webgpu' | 'wasm';
  /** Weight precision that actually built a session. */
  resolvedDtype?: string;
  status: STTAdapterStatus;
  progress?: ModelProgress;
  error?: string;
}

export interface DiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** A selectable option inside a model card's config section. */
export interface TtsChoice {
  id: string;
  label: string;
  note?: string;
}

/** A text-to-speech model card. One card per model; variants are config. */
export interface TtsModelConfig {
  id: string;
  name: string;
  description: string;
  provider: 'Transformers.js' | 'Piper' | 'Browser Native' | 'Remote API';
  /** Runs on someone else's server: no download, but network-dependent. */
  remote?: boolean;
  modelRepoId: string;
  downloadSize: string;
  language: string;
  /** Output sample rate in Hz; materially affects perceived quality. */
  sampleRate?: number;
  /** Web Speech plays straight to the device and hands back no buffer. */
  canReturnAudio?: boolean;
  /** Selectable voices. Changing one swaps the weights, so the model reloads. */
  voices?: TtsChoice[];
  selectedVoice?: string;
  /** Speakers within the selected voice; only multi-speaker voices have these. */
  speakers?: TtsChoice[];
  selectedSpeaker?: string;
  /** Selectable quantizations. Also a reload. */
  dtypes?: TtsChoice[];
  selectedDtype?: string;

  device?: 'webgpu' | 'wasm';
  resolvedDtype?: string;
  status: STTAdapterStatus;
  progress?: ModelProgress;
  error?: string;
}

export interface TtsSynthesis {
  id: string;
  modelId: string;
  modelName: string;
  text: string;
  audio: Float32Array;
  samplingRate: number;
  durationSec: number;
  synthesisMs: number;
  realTimeFactor: number;
  /** Peak amplitude: distinguishes real speech from a correctly-sized silence. */
  peak: number;
  timestamp: string;
  /** Round-trip through the STT model; undefined until scored. */
  roundTripWer?: number;
  roundTripText?: string;
}
