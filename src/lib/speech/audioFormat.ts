// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The formats onspot keeps speech audio in: Opus, the most compact codec a
 * browser can record and play, made for speech. Every take is stored for
 * replay and uploaded for transcription, and every read-back is stored so it
 * replays offline, so the size of each clip decides how fast all of that is
 * and how much room it takes on the phone.
 *
 * - The learner's recording is captured as Opus from the start: by
 *   `MediaRecorder` (`recordingFormat`), or by WebCodecs where the engine's
 *   MediaRecorder cannot record Opus (`startOpusTakeEncoder`).
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
 * How `MediaRecorder` should encode a take: Opus at a speech bitrate, in the
 * first of `RECORDING_TYPES` the engine can record.
 *
 * @returns The options, or null where MediaRecorder can record none of them.
 *   WebKitGTK on GStreamer older than 1.24.9 (Ubuntu 22.04 and 24.04, and the
 *   AppImage, which bundles 22.04's) answers no to all three, and creating a
 *   recorder anyway throws "The MediaRecorder is unsupported on this platform".
 */
export function recordingFormat(): MediaRecorderOptions | null {
	if (typeof MediaRecorder === 'undefined') return null;

	const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
	return mimeType ? { mimeType, audioBitsPerSecond: RECORDING_BITRATE } : null;
}

/** A take being encoded to Ogg Opus as it is captured (see `startOpusTakeEncoder`). */
export interface OpusTakeEncoder {
	/**
	 * Queues the next block of mono PCM, in capture order. The encoder keeps a
	 * reference to `samples`, so pass a copy of any buffer that gets reused.
	 */
	add(samples: Float32Array): void;
	/**
	 * Encodes what is still queued and closes the file.
	 *
	 * @returns The Ogg Opus take.
	 */
	finish(): Promise<Blob>;
	/** Stops encoding and drops the take. */
	cancel(): Promise<void>;
}

/**
 * Starts encoding a take to Ogg Opus with the platform's WebCodecs encoder
 * (through Mediabunny, loaded only when first needed), for engines whose
 * MediaRecorder cannot record Opus (see `recordingFormat`).
 *
 * @param sampleRate The sample rate of the PCM that will be added, in hertz.
 * @returns The encoder, or null where the platform cannot encode Opus either.
 */
export async function startOpusTakeEncoder(sampleRate: number): Promise<OpusTakeEncoder | null> {
	if (typeof AudioEncoder === 'undefined') return null;

	const { AudioSample, AudioSampleSource, BufferTarget, OggOutputFormat, Output, Quality, canEncodeAudio } =
		await import('mediabunny');
	const quality = new Quality({ bitrate: RECORDING_BITRATE });
	const supported = await canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: OPUS_SAMPLE_RATE, quality });
	if (!supported) return null;

	const output = new Output({ format: new OggOutputFormat(), target: new BufferTarget() });
	const source = new AudioSampleSource({
		codec: 'opus',
		quality,
		transform: { numberOfChannels: 1, sampleRate: OPUS_SAMPLE_RATE }
	});
	output.addAudioTrack(source);
	await output.start();

	// Each block waits for the one before it, which keeps capture order and
	// respects the encoder's backpressure; the first failure is kept for `finish`.
	let queuedFrames = 0;
	let queue: Promise<void> = Promise.resolve();
	let encodingError: unknown = null;

	return {
		add(samples) {
			const sample = new AudioSample({
				data: samples,
				format: 'f32',
				numberOfChannels: 1,
				sampleRate,
				timestamp: queuedFrames / sampleRate
			});
			queuedFrames += samples.length;

			queue = queue
				.then(() => source.add(sample))
				.catch((error: unknown) => {
					encodingError ??= error;
				})
				.finally(() => sample.close());
		},

		async finish() {
			await queue;
			if (encodingError) throw encodingError;

			await output.finalize();
			const encoded = output.target.buffer;
			if (!encoded || encoded.byteLength === 0) throw new Error('The Opus encoder produced no audio.');

			return new Blob([encoded], { type: OPUS_MIME_TYPE });
		},

		async cancel() {
			await queue;
			await output.cancel();
		}
	};
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
