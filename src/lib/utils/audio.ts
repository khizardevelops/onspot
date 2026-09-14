/**
 * Utility for handling audio playback, decoding, resampling to 16kHz,
 * microphone recording, and pre-set test audio clips.
 */

export interface SampleAudio {
  id: string;
  title: string;
  description: string;
  /** Ground truth. Empty string means this clip has no reference to score against. */
  referenceText: string;
  category: 'Evaluation' | 'Diagnostic';
  /** Playable source for the preview player, when the clip is a real file. */
  audioUrl?: string;
  load: () => Promise<{ audioData: Float32Array; durationSec: number }>;
}

const TARGET_SAMPLE_RATE = 16000;

/**
 * Averages an AudioBuffer's channels into a single mono Float32Array.
 * `OfflineAudioContext`'s own 2 -> 1 downmix would do this too, but routing the
 * buffer through a source node is exactly what we are avoiding below.
 */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }

  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      mono[i] += data[i];
    }
  }
  for (let i = 0; i < mono.length; i++) {
    mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Band-limited resampler (windowed-sinc, 16 taps per side).
 *
 * Only used for the AudioBuffer input path, where the caller has already
 * decoded at some other rate. Plain linear interpolation aliases everything
 * above 8kHz back down into the speech band when decimating 44.1/48kHz audio.
 */
function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;

  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const output = new Float32Array(outLength);

  // Cut off at the lower of the two Nyquist limits to avoid aliasing.
  const cutoff = Math.min(0.5, 0.5 / ratio);
  const taps = 16;
  const window = Math.max(1, Math.ceil(taps * ratio));

  for (let i = 0; i < outLength; i++) {
    const center = i * ratio;
    const start = Math.max(0, Math.floor(center) - window);
    const end = Math.min(input.length - 1, Math.floor(center) + window);

    let sum = 0;
    let norm = 0;
    for (let j = start; j <= end; j++) {
      const x = (j - center) * 2 * cutoff;
      let sinc: number;
      if (x === 0) {
        sinc = 1;
      } else {
        const px = Math.PI * x;
        sinc = Math.sin(px) / px;
      }
      // Blackman window over the tap range.
      const t = (j - center) / (window + 1);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t);
      const coeff = sinc * w;
      sum += input[j] * coeff;
      norm += coeff;
    }
    output[i] = norm !== 0 ? sum / norm : 0;
  }

  return output;
}

/**
 * Decodes any audio input to a 16kHz mono Float32Array, as required by the
 * Speech-to-Text models (Transformers.js, Moonshine, Whisper).
 *
 * Decoding happens directly into a 16kHz context so the browser's own
 * high-quality resampler does the rate conversion. The previous approach --
 * decoding at the hardware rate and replaying the buffer through an
 * `AudioBufferSourceNode` into a 16kHz `OfflineAudioContext` -- relies on the
 * source node's linear interpolation, which has no anti-alias filter.
 */
export async function resampleAudioTo16kHz(
  audioData: ArrayBuffer | Blob | AudioBuffer
): Promise<{ audioData: Float32Array; durationSec: number }> {
  if (audioData instanceof AudioBuffer) {
    const mono = downmixToMono(audioData);
    const resampled = resampleFloat32(mono, audioData.sampleRate, TARGET_SAMPLE_RATE);
    return { audioData: resampled, durationSec: audioData.duration };
  }

  const arrayBuffer = audioData instanceof Blob ? await audioData.arrayBuffer() : audioData;

  // OfflineAudioContext.decodeAudioData resamples to the context's rate and,
  // unlike AudioContext, never trips the browser's autoplay policy.
  const decodeCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    // Safari historically refused OfflineAudioContext.decodeAudioData for some
    // container formats; fall back to a normal context plus our own resampler.
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      ctx.close();
    }
    const mono = downmixToMono(buffer);
    return {
      audioData: resampleFloat32(mono, buffer.sampleRate, TARGET_SAMPLE_RATE),
      durationSec: buffer.duration
    };
  }

  const mono = downmixToMono(buffer);
  const atTargetRate =
    buffer.sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : resampleFloat32(mono, buffer.sampleRate, TARGET_SAMPLE_RATE);

  return {
    audioData: atTargetRate,
    durationSec: atTargetRate.length / TARGET_SAMPLE_RATE
  };
}

/**
 * Audio Recorder helper class using MediaRecorder.
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  public async start(): Promise<void> {
    this.audioChunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  public async stop(): Promise<{ blob: Blob; url: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        return reject(new Error('Recorder not initialized'));
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        
        // Stop audio tracks
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
        }

        resolve({ blob, url });
      };

      this.mediaRecorder.stop();
    });
  }
}

/**
 * Generates a synthetic multi-harmonic tone. This is NOT speech -- it is a
 * plumbing check for the decode/inference path. A model is behaving correctly
 * when it returns nothing (or noise) for this clip, so it carries no reference
 * text and must never be scored for WER.
 */
export function generateSyntheticTestAudio(durationSec: number = 3): Float32Array {
  const sampleRate = TARGET_SAMPLE_RATE;
  const numSamples = Math.round(sampleRate * durationSec);
  const buffer = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.sin(Math.PI * (t / durationSec)) * Math.min(1, t * 5);
    const wave = Math.sin(2 * Math.PI * 220 * t) * 0.4 +
                 Math.sin(2 * Math.PI * 440 * t) * 0.3 +
                 Math.sin(2 * Math.PI * 880 * t) * 0.15;
    buffer[i] = wave * env * 0.5;
  }

  return buffer;
}

/** Fetches a bundled clip and decodes it to 16kHz mono. */
async function loadBundledClip(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load sample clip ${url} (HTTP ${response.status})`);
  }
  return resampleAudioTo16kHz(await response.arrayBuffer());
}

/**
 * Evaluation clips are discovered from `eval/` at build time -- drop in a
 * folder and it shows up, no code change.
 *
 * Vite resolves glob patterns starting with `/` against the project root, so
 * this reaches `eval/` without moving it under `public/` and without a manifest
 * file. Audio is emitted as a hashed asset (`?url` gives its served path);
 * transcripts are inlined as strings (`?raw`).
 */
const evalAudioUrls = import.meta.glob<string>(
  '/eval/*/*.{mp3,wav,m4a,ogg,oga,webm,flac}',
  { query: '?url', import: 'default', eager: true }
);

const evalTranscripts = import.meta.glob<string>('/eval/*/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true
});

function folderOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function baseNameOf(path: string): string {
  return fileNameOf(path).replace(/\.[^.]+$/, '');
}

/**
 * Resolves a clip's reference transcript:
 *   1. `<clip-basename>.txt` in the same folder, else
 *   2. `transcript.txt` -- only when the folder holds a single clip, else
 *   3. none, and the clip is left unscored.
 *
 * The condition on (2) is deliberate: applying one folder-level transcript to
 * several clips would produce confident, wrong error rates.
 */
function referenceFor(audioPath: string, clipsInFolder: number): string {
  const folder = folderOf(audioPath);
  const sibling = evalTranscripts[`${folder}/${baseNameOf(audioPath)}.txt`];
  if (sibling !== undefined) return sibling.trim();

  if (clipsInFolder === 1) {
    const shared = evalTranscripts[`${folder}/transcript.txt`];
    if (shared !== undefined) return shared.trim();
  }

  return '';
}

function discoverEvalSamples(): SampleAudio[] {
  const paths = Object.keys(evalAudioUrls).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const clipCounts = new Map<string, number>();
  for (const path of paths) {
    const folder = folderOf(path);
    clipCounts.set(folder, (clipCounts.get(folder) ?? 0) + 1);
  }

  return paths.map((path) => {
    const folder = folderOf(path);
    const setName = fileNameOf(folder);
    const clipsInFolder = clipCounts.get(folder) ?? 1;
    const referenceText = referenceFor(path, clipsInFolder);
    const url = evalAudioUrls[path];

    return {
      id: `${setName}/${baseNameOf(path)}`,
      title: clipsInFolder === 1 ? setName : `${setName} / ${baseNameOf(path)}`,
      description: `${fileNameOf(path)} - ${
        referenceText ? 'reference transcript' : 'no reference (unscored)'
      }`,
      category: 'Evaluation' as const,
      referenceText,
      audioUrl: url,
      load: () => loadBundledClip(url)
    };
  });
}

/**
 * Clip list shown in the UI: everything found under `eval/`, then the synthetic
 * tone. The tone is a pipeline check rather than eval data, and keeping it last
 * means a real clip is the one auto-selected on mount. It also guarantees the
 * list is never empty when `eval/` is.
 */
export const PRESET_FRENCH_SAMPLES: SampleAudio[] = [
  ...discoverEvalSamples(),
  {
    id: 'diagnostic-tone',
    title: 'Synthetic tone (pipeline check)',
    description: 'Not speech. Verifies the decode and inference path end to end; not scored.',
    category: 'Diagnostic',
    referenceText: '',
    load: async () => {
      const audioData = generateSyntheticTestAudio(4);
      return { audioData, durationSec: audioData.length / TARGET_SAMPLE_RATE };
    }
  }
];
