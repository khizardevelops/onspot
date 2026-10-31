// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The formats onspot keeps speech audio in: Opus, the most compact codec a
 * browser can record and play, made for speech. Every take is stored for
 * replay and uploaded for transcription, and every read-back is stored so it
 * replays offline, so the size of each clip decides how fast all of that is
 * and how much room it takes on the phone.
 *
 * - The learner's recording is captured as Opus from the start (`recordingFormat`).
 * - Cloud read-back is requested as compressed audio and stored as it arrives
 *   (see the cloud adapters).
 * - Local (Piper) read-back comes out as PCM; `encodeSpeechOpus` compresses it
 *   before it is stored.
 */

/**
 * The recording's bitrate. Speech recognition hears 16 kHz audio (8 kHz of
 * bandwidth), which Opus keeps at this rate with headroom for a noisy room,
 * and the learner's own replay still sounds clear. A minute is about 180 KB,
 * against 1.9 MB as 16 kHz WAV.
 */
const RECORDING_BITRATE = 24_000;

/** Containers for an Opus recording, most widely accepted first; the last is AAC for engines without Opus. */
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

/**
 * How `MediaRecorder` should encode a take: Opus at a speech bitrate where the
 * engine supports it, otherwise its own default.
 */
export function recordingFormat(): MediaRecorderOptions {
	const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
	return mimeType ? { mimeType, audioBitsPerSecond: RECORDING_BITRATE } : { audioBitsPerSecond: RECORDING_BITRATE };
}

/**
 * Read-back is listened to closely (it is the model of how to say it), so it
 * keeps fullband Opus: 32 kbps, about 4 KB a second, a tenth of Piper's WAV.
 */
export const SPEECH_BITRATE = 32_000;

/** Opus runs at 48 kHz; other rates are resampled while encoding. */
export const OPUS_SAMPLE_RATE = 48_000;

export const OPUS_MIME_TYPE = 'audio/ogg; codecs=opus';

/**
 * Compresses mono speech to Ogg Opus with the platform's own encoder
 * (WebCodecs, through Mediabunny, loaded only when first needed).
 *
 * @param samples Mono PCM, -1..1.
 * @param sampleRate Its sample rate in hertz.
 * @returns The Opus file, or null where the platform cannot encode Opus (keep the PCM then).
 */
export async function encodeSpeechOpus(samples: Float32Array, sampleRate: number): Promise<Blob | null> {
	if (typeof AudioEncoder === 'undefined' || samples.length === 0) return null;

	const { AudioSample, AudioSampleSource, BufferTarget, OggOutputFormat, Output, Quality, canEncodeAudio } =
		await import('mediabunny');
	const quality = new Quality({ bitrate: SPEECH_BITRATE });
	const supported = await canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: OPUS_SAMPLE_RATE, quality });
	if (!supported) return null;

	const output = new Output({ format: new OggOutputFormat(), target: new BufferTarget() });
	const source = new AudioSampleSource({ codec: 'opus', quality, transform: { sampleRate: OPUS_SAMPLE_RATE } });
	output.addAudioTrack(source);
	await output.start();

	const sample = new AudioSample({ data: samples, format: 'f32', numberOfChannels: 1, sampleRate, timestamp: 0 });
	await source.add(sample);
	sample.close();
	await output.finalize();

	const encoded = output.target.buffer;
	return encoded ? new Blob([encoded], { type: OPUS_MIME_TYPE }) : null;
}
