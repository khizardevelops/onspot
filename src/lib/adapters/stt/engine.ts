/**
 * Shared Transformers.js engine setup for every ONNX adapter.
 *
 * Centralises the two things each adapter previously copy-pasted, and got
 * wrong: picking an execution device the runtime can actually provide, and
 * decoding audio longer than a model's context window without losing any of it.
 */
import type { ModelProgress, TranscribeOptions } from '../../types';

export type ASRDevice = 'webgpu' | 'wasm';

type Transformers = typeof import('@huggingface/transformers');

let enginePromise: Promise<Transformers> | null = null;
let devicePromise: Promise<ASRDevice> | null = null;

/**
 * WebGPU is opt-in. Transformers.js/ORT-Web produce correct results on WASM on
 * every browser, whereas the WebGPU backend's numerics vary by driver — not a
 * trade an evaluation tool should make silently. Set `VITE_STT_DEVICE=webgpu`
 * (or call `setPreferredDevice`) to try the GPU instead.
 */
const ENV_DEVICE = (import.meta.env?.VITE_STT_DEVICE as string | undefined)?.toLowerCase();
let preferredDevice: ASRDevice = ENV_DEVICE === 'webgpu' ? 'webgpu' : 'wasm';

/**
 * Weight precision to request.
 *
 * fp32 only. The quantised builds of these repos carry MatMulNBits-style
 * DequantizeLinear nodes that ONNX Runtime Web refuses to build a session for:
 *
 *   Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137
 *   TransposeDQWeightsForMatMulNBits Missing required scale:
 *   model.decoder.embed_tokens.weight_merged_0_scale
 *
 * This bites q8 as well as q4/bnb4 -- verified in a browser against
 * onnx-community/whisper-base. Note that `onnxruntime-node` loads the same q8
 * weights happily and scores an identical 7.2% WER on `eval/set1`, so a Node
 * experiment is NOT evidence that a dtype works here. Only a browser run is.
 *
 * The cost is real: whisper-base is 291MB at fp32 versus 77MB at q8. If a
 * future ONNX Runtime Web fixes this, `VITE_STT_DTYPE=q8` re-tests it in one
 * step -- but check in a browser, with a cold cache.
 */
const ENV_DTYPE = (import.meta.env?.VITE_STT_DTYPE as string | undefined)?.toLowerCase();
export const DEFAULT_DTYPE = ENV_DTYPE || 'fp32';

export function setPreferredDevice(device: ASRDevice) {
  if (device !== preferredDevice) {
    preferredDevice = device;
    devicePromise = null;
  }
}

async function getEngine(): Promise<Transformers> {
  if (!enginePromise) {
    enginePromise = import('@huggingface/transformers').then((mod) => {
      mod.env.allowLocalModels = false;

      // ORT-Web only spawns worker threads when the page is cross-origin
      // isolated (vite.config.ts sets the COOP/COEP headers that enable it).
      const wasmBackend = (mod.env.backends?.onnx as any)?.wasm;
      if (wasmBackend) {
        wasmBackend.numThreads = self.crossOriginIsolated
          ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
          : 1;
      }
      return mod;
    });
  }
  return enginePromise;
}

/**
 * Resolves a device the ONNX runtime will accept. Asking for 'webgpu' when the
 * browser has no `navigator.gpu` makes Transformers.js throw
 * `Unsupported device: "webgpu". Should be one of: wasm.` before any model
 * loads, so probe for a real adapter first.
 */
export async function detectDevice(): Promise<ASRDevice> {
  if (!devicePromise) {
    devicePromise = (async (): Promise<ASRDevice> => {
      if (preferredDevice !== 'webgpu') return 'wasm';
      const gpu = (navigator as any).gpu;
      if (!gpu) return 'wasm';
      try {
        const adapter = await gpu.requestAdapter();
        return adapter ? 'webgpu' : 'wasm';
      } catch {
        return 'wasm';
      }
    })();
  }
  return devicePromise;
}

function formatMB(bytes: number): string {
  return (bytes / 1e6).toFixed(0);
}

/**
 * Weight files are tens to hundreds of MB; config.json, tokenizer.json and
 * friends are a few KB. Only the former belong in a download percentage.
 */
const WEIGHT_FILE_MIN_BYTES = 1_000_000;

/**
 * Builds a Transformers.js `progress_callback` that reports one figure for the
 * whole download.
 *
 * Transformers.js reports progress per file, and a Whisper repo is several
 * files (encoder ~83MB, merged decoder ~209MB, plus tokenizer/config). Feeding
 * `info.progress` straight to the UI made the bar run 0->100 for the encoder,
 * snap back to 0 for the decoder, and jump backwards on every `done` event.
 * So accumulate bytes across files instead.
 *
 * Two traps, both hit in practice:
 *
 * 1. The small JSON files arrive first and finish instantly. Counting them put
 *    loaded/total at 1.0 before a single byte of the 291MB decoder had landed.
 * 2. Clamping the ratio monotonic then froze it there: the denominator grew
 *    once the real weights started, but the clamp would not let the figure come
 *    back down, so every model parked at 95% for its entire download.
 *
 * Hence: percentage over weight files only, and no monotonic clamp. The
 * denominator is stable in practice because Transformers.js requests the
 * encoder and decoder together, so this does not reintroduce the bouncing.
 */
export function createDownloadProgress(
  report: (status: string, percent: number, file?: string) => void
) {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();

  const get = (file: string) =>
    files.get(file) ?? { loaded: 0, total: 0, done: false };

  return (info: any) => {
    const file: string = info?.file ?? '';
    if (!file) return;

    switch (info?.status) {
      case 'initiate':
        if (!files.has(file)) files.set(file, { loaded: 0, total: 0, done: false });
        break;

      case 'progress': {
        const entry = get(file);
        files.set(file, {
          loaded: info.loaded ?? 0,
          total: info.total ?? entry.total,
          done: entry.done
        });
        break;
      }

      case 'done': {
        const entry = get(file);
        files.set(file, { ...entry, loaded: entry.total || entry.loaded, done: true });
        break;
      }

      default:
        return;
    }

    // A file whose size is still unknown and which has not finished is a hole in
    // the denominator. Reporting through one of those is how the bar hit 99%
    // "Preparing inference session" two seconds in: the cached encoder had
    // completed while the 209MB decoder had yet to announce itself.
    for (const entry of files.values()) {
      if (entry.total === 0 && !entry.done) {
        report('Fetching model files...', 0, file);
        return;
      }
    }

    let loaded = 0;
    let total = 0;
    for (const entry of files.values()) {
      if (entry.total < WEIGHT_FILE_MIN_BYTES) continue;
      loaded += entry.loaded;
      total += entry.total;
    }

    if (total <= 0) {
      report('Fetching model files...', 0, file);
      return;
    }

    // Hold back the last percent for session creation, which happens after the
    // bytes land and emits no progress events. Measured at ~2s for whisper-base,
    // so this is a brief pause rather than the long stall it looks like.
    const percent = Math.min(99, (loaded / total) * 99);
    const status =
      loaded >= total
        ? 'Preparing inference session...'
        : `Downloading ${formatMB(loaded)} / ${formatMB(total)} MB`;

    report(status, percent, file);
  };
}

export interface CreatePipelineOptions {
  dtype?: any;
  progress_callback?: (info: any) => void;
  onDeviceResolved?: (device: ASRDevice, dtype: string) => void;
}

/**
 * Creates an ASR pipeline, falling back from the preferred device to WASM (a
 * stale driver or a lost adapter can fail after the probe succeeds).
 *
 * Deliberately does NOT retry with a different dtype. A failed session leaves
 * the runtime in a state where the retry fails too: a q8 attempt followed by an
 * fp32 retry reported the same MatMulNBits error for fp32, which loads fine on
 * its own. A wasted 77MB download followed by a misleading error is worse than
 * failing once, clearly.
 */
export async function createPipeline(
  task: string,
  modelRepoId: string,
  { dtype = DEFAULT_DTYPE, progress_callback, onDeviceResolved }: CreatePipelineOptions = {}
): Promise<any> {
  const { pipeline } = await getEngine();
  const device = await detectDevice();

  const attempts: Array<{ device: ASRDevice; dtype: any }> = [{ device, dtype }];
  if (device !== 'wasm') attempts.push({ device: 'wasm', dtype });

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const instance = await pipeline(task as any, modelRepoId, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback
      } as any);
      onDeviceResolved?.(attempt.device, String(attempt.dtype));
      return instance;
    } catch (err) {
      lastError = err;
      console.warn(
        `[${modelRepoId}] ${attempt.device}/${attempt.dtype} failed, trying next:`,
        err
      );
    }
  }

  throw lastError;
}

/** Speech-to-text convenience wrapper over `createPipeline`. */
export async function createASRPipeline(
  modelRepoId: string,
  options: CreatePipelineOptions = {}
): Promise<any> {
  return createPipeline('automatic-speech-recognition', modelRepoId, options);
}

export const SAMPLE_RATE = 16000;
const WINDOW_SEC = 30;

/**
 * Runs a Whisper-family pipeline over audio of any length.
 *
 * Whisper only sees 30 seconds at a time, so longer clips have to be windowed.
 * Transformers.js can do that itself via `chunk_length_s`/`stride_length_s`,
 * but its overlap merge is unreliable: with no `return_timestamps` it aligns
 * neighbouring chunks by a longest-common-token-sequence search and silently
 * drops whole chunks, and with timestamps the result swings wildly with the
 * stride. Measured on `eval/set1` (63s French conversation, whisper-base,
 * WER against the reference transcript):
 *
 *   chunk 30 / stride 5  , no timestamps -> 32.8%   first 25s dropped entirely
 *   chunk 30 / stride 5  , timestamps    -> 21.6%   overlap duplicated
 *   chunk 30 / stride 8  , timestamps    -> 30.4%
 *   chunk 30 / stride 10 , timestamps    ->  8.0%
 *   chunk 30 / stride 12 , timestamps    -> 63.2%
 *   chunk 30 / stride 15 , timestamps    -> never terminates (step size 0)
 *
 * So instead we do what OpenAI's own long-form decoder does: transcribe a
 * 30s window, then seek forward to the end of the last segment Whisper
 * actually emitted a timestamp for, and decode again from there. Windows never
 * overlap, nothing is dropped, and there is no stride to tune. Same clip:
 *
 *   sequential windows -> 7.2%, and ~2.6x faster than the stride-10 setting
 */
export async function whisperTranscribe(
  transcriber: any,
  audio16kMono: Float32Array,
  durationSec: number,
  options: TranscribeOptions = {}
): Promise<string> {
  const decodeOptions: Record<string, unknown> = {
    language: 'french',
    task: 'transcribe'
  };
  // Spreading `options` directly would let an explicitly-undefined field wipe
  // out the defaults above.
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) decodeOptions[key] = value;
  }

  if (durationSec <= WINDOW_SEC) {
    return extractText(await transcriber(audio16kMono, decodeOptions));
  }

  const windowSamples = WINDOW_SEC * SAMPLE_RATE;
  // Whisper emits nothing useful for a sliver of audio, and a short trailing
  // window invites hallucination.
  const minTailSamples = SAMPLE_RATE;
  // Pathological timestamps could otherwise inch forward a second at a time.
  const maxWindows = Math.ceil(durationSec / 5) + 4;

  const parts: string[] = [];
  let offset = 0;

  for (let i = 0; i < maxWindows && offset < audio16kMono.length; i++) {
    const remaining = audio16kMono.length - offset;
    if (remaining < minTailSamples) break;

    const window = audio16kMono.subarray(offset, offset + Math.min(windowSamples, remaining));
    const result = await transcriber(window, { ...decodeOptions, return_timestamps: true });

    const text = extractText(result).trim();
    if (text) parts.push(text);

    // The final (partial) window has no successor to seek to.
    if (remaining <= windowSamples) break;

    offset += Math.round(nextSeekSeconds(result) * SAMPLE_RATE);
  }

  return parts.join(' ');
}

/**
 * How far to advance after a window: the end of the last segment Whisper gave
 * a closed timestamp for. Falls back to the full window when timestamps are
 * missing or degenerate, so the loop always makes progress.
 */
function nextSeekSeconds(result: any): number {
  const segments: any[] = result?.chunks ?? [];

  for (let i = segments.length - 1; i >= 0; i--) {
    const end = segments[i]?.timestamp?.[1];
    if (typeof end === 'number' && end > 1 && end <= WINDOW_SEC) {
      return end;
    }
  }

  return WINDOW_SEC;
}

/**
 * Runs a pipeline over fixed, non-overlapping windows.
 *
 * For models that cannot emit timestamps, so `whisperTranscribe`'s seek-to-last-
 * segment trick has nothing to seek on. Moonshine is the case that matters here:
 * it silently ignores `chunk_length_s` (passing it produces byte-identical
 * output), and feeding it the whole clip at once makes it fall apart. On
 * `eval/set1` with moonshine-tiny-fr: 91.2% WER unwindowed, 64.8% at 30s
 * windows. Still a weak baseline -- the model card calls it a proof of concept
 * -- but no longer nonsense.
 */
export async function windowedTranscribe(
  transcriber: any,
  audio16kMono: Float32Array,
  durationSec: number,
  windowSec: number,
  decodeOptionsFor: (windowDurationSec: number) => Record<string, unknown>
): Promise<string> {
  if (durationSec <= windowSec) {
    return extractText(await transcriber(audio16kMono, decodeOptionsFor(durationSec)));
  }

  const windowSamples = windowSec * SAMPLE_RATE;
  const parts: string[] = [];

  for (let offset = 0; offset < audio16kMono.length; offset += windowSamples) {
    const window = audio16kMono.subarray(
      offset,
      Math.min(audio16kMono.length, offset + windowSamples)
    );
    // A sliver of trailing audio yields nothing but hallucination.
    if (window.length < SAMPLE_RATE) break;

    const text = extractText(
      await transcriber(window, decodeOptionsFor(window.length / SAMPLE_RATE))
    ).trim();
    if (text) parts.push(text);
  }

  return parts.join(' ');
}

/** Normalises the several shapes a Transformers.js ASR pipeline can return. */
export function extractText(result: any): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result.map((r) => (typeof r === 'string' ? r : r?.text ?? '')).join(' ');
  }
  if (result?.text !== undefined) return String(result.text);
  return '';
}

export type { ModelProgress };
