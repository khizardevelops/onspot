import { sttRegistry } from '../stt/registry';
import { calculateWER } from '../../utils/metrics';
import type { TtsSynthesis } from '../../types';

/** The STT model chosen for onspot; 5.5% WER across eval/set1+eval2+eval3. */
export const ROUND_TRIP_STT_ID = 'whisper-small-fr-q4';

/**
 * Resamples a synthesized clip to 16kHz mono for Whisper.
 *
 * `resampleAudioTo16kHz` in utils/audio.ts takes encoded bytes or an
 * AudioBuffer; TTS hands back raw PCM at 22.05/24kHz, so wrap it in an
 * AudioBuffer first and let the browser's resampler do the conversion.
 */
async function to16kMono(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
  if (sampleRate === 16000) return audio;

  const target = 16000;
  const frames = Math.max(1, Math.round((audio.length / sampleRate) * target));
  const offline = new OfflineAudioContext(1, frames, target);
  const buffer = offline.createBuffer(1, audio.length, sampleRate);
  buffer.copyToChannel(new Float32Array(audio), 0);

  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

/**
 * Objective intelligibility: speak the text, transcribe it back, score WER.
 *
 * For a pronunciation-teaching app this is the right proxy — if onspot's own
 * STT cannot decode a voice, a learner will not either. It measures clarity,
 * NOT naturalness: a flat robotic voice can score 0%. The listening test stays
 * the deciding vote.
 */
export async function scoreRoundTrip(result: TtsSynthesis): Promise<TtsSynthesis> {
  if (!result.audio.length) return result;

  const pcm = await to16kMono(result.audio, result.samplingRate);
  const transcription = await sttRegistry.runTranscription(ROUND_TRIP_STT_ID, pcm);

  return {
    ...result,
    roundTripText: transcription.text,
    roundTripWer: calculateWER(result.text, transcription.text),
  };
}

/** Encodes PCM as a 16-bit WAV blob so it can be played and downloaded. */
export function pcmToWavUrl(audio: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  view.setUint32(4, 36 + audio.length * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, audio.length * 2, true);

  let offset = 44;
  for (let i = 0; i < audio.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}
