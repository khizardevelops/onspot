// SPDX-License-Identifier: AGPL-3.0-or-later

import { OPUS_SAMPLE_RATE, SPEECH_BITRATE } from '../audioFormat';

/**
 * Plays speech while it is still arriving. Cloud read-back comes as Ogg Opus,
 * which the media element can only play once the file is complete. Media
 * Source Extensions can play a file as it grows, but take Opus in WebM, not
 * Ogg. So the Opus packets are moved from the arriving Ogg into a growing
 * WebM (repackaged, not re-encoded: the sound is untouched) and appended to a
 * `MediaSource` the shared player plays. Mediabunny reads and writes both
 * containers; it is loaded on first use.
 *
 * On-device speech that is made piece by piece (an explanation, one voice
 * segment at a time) takes the same route from PCM: each piece is encoded to
 * Opus as it is pushed (`playPcmStream`).
 *
 * The player only gets a copy of the stream: whoever starts it keeps the
 * other copy and stores the whole clip, so stopping the sound never cuts the
 * download (or the synthesis) short.
 */

/** What the player is fed: Opus in WebM. */
const STREAM_MIME_TYPE = 'audio/webm; codecs="opus"';

/**
 * How much audio the WebM writer gathers before handing it to the player.
 * Short, so the first sound comes a fraction of a second after the first
 * packets (the default, one second, would hold it back).
 */
const CLUSTER_SECONDS = 0.25;

/** True where the platform can play Opus while it arrives (Media Source Extensions with WebM Opus). */
export function canStreamOpus(): boolean {
	return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(STREAM_MIME_TYPE);
}

/**
 * Starts playable audio from an arriving Ogg Opus stream.
 *
 * @param oggOpus The stream, as the speech service sends it.
 * @returns An object URL for the shared player. It starts filling once the player
 *   opens it; if it is never played, or the player moves on, the stream is let go.
 */
export function playOggOpusStream(oggOpus: ReadableStream<Uint8Array>): string {
	const mediaSource = new MediaSource();
	mediaSource.addEventListener(
		'sourceopen',
		() => {
			void feedMediaSource(mediaSource, oggOpus).catch((error) => {
				// The player moved on (another track), or the stream broke: the stored copy is unaffected.
				if (mediaSource.readyState !== 'closed') console.warn('[tts] streamed playback stopped', error);
			});
		},
		{ once: true }
	);
	return URL.createObjectURL(mediaSource);
}

/** Repackages the Ogg's Opus packets into WebM and appends them to the open `MediaSource`. */
async function feedMediaSource(mediaSource: MediaSource, oggOpus: ReadableStream<Uint8Array>): Promise<void> {
	const { EncodedAudioPacketSource, EncodedPacketSink, Input, OGG, Output, ReadableStreamSource, StreamTarget, WebMOutputFormat } =
		await import('mediabunny');
	const sourceBuffer = mediaSource.addSourceBuffer(STREAM_MIME_TYPE);
	const input = new Input({ source: new ReadableStreamSource(oggOpus), formats: [OGG] });
	const stopReading = () => input.dispose();
	mediaSource.addEventListener('sourceclose', stopReading, { once: true });

	try {
		const track = await input.getPrimaryAudioTrack();
		const decoderConfig = await track?.getDecoderConfig();
		if (!track || !decoderConfig) throw new Error('The stream has no Opus audio.');

		const output = new Output({
			format: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: CLUSTER_SECONDS }),
			target: new StreamTarget(new WritableStream({ write: (chunk) => append(sourceBuffer, chunk.data) }))
		});
		const packets = new EncodedAudioPacketSource('opus');
		output.addAudioTrack(packets);
		await output.start();

		let first = true;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			await packets.add(packet, first ? { decoderConfig } : undefined);
			first = false;
		}
		await output.finalize();

		if (mediaSource.readyState === 'open') mediaSource.endOfStream();
	} finally {
		mediaSource.removeEventListener('sourceclose', stopReading);
		input.dispose();
	}
}

let pcmStreaming: Promise<boolean> | null = null;

/**
 * True where PCM can be played while it is made: Media Source Extensions with
 * WebM Opus, and an Opus encoder (WebCodecs). Checked once.
 */
export function canStreamPcm(): Promise<boolean> {
	pcmStreaming ??= (async () => {
		if (!canStreamOpus() || typeof AudioEncoder === 'undefined') return false;
		const { Quality, canEncodeAudio } = await import('mediabunny');
		const quality = new Quality({ bitrate: SPEECH_BITRATE });
		return canEncodeAudio('opus', { numberOfChannels: 1, sampleRate: OPUS_SAMPLE_RATE, quality });
	})().catch(() => false);
	return pcmStreaming;
}

/** Receives mono 48 kHz PCM piece by piece. */
export interface PcmSink {
	/** Adds the next piece; never waits for a player, which may be gone. */
	push(samples: Float32Array): void;
	/** No more pieces. */
	end(): void;
}

/** A playable stream fed piece by piece. */
export interface PcmFeed extends PcmSink {
	/** Object URL for the shared player. */
	url: string;
}

/**
 * Starts playable audio from PCM that is still being made. Pieces are queued,
 * so whoever makes them never waits for (or depends on) the player; they are
 * encoded and played once the player opens the URL.
 */
export function playPcmStream(): PcmFeed {
	const mediaSource = new MediaSource();
	const queue: Float32Array[] = [];
	let ended = false;
	let wake: (() => void) | null = null;
	const signal = () => {
		wake?.();
		wake = null;
	};

	const nextPiece = async (): Promise<Float32Array | null> => {
		while (queue.length === 0) {
			if (ended) return null;
			await new Promise<void>((resolve) => (wake = resolve));
		}
		return queue.shift() ?? null;
	};

	mediaSource.addEventListener(
		'sourceopen',
		() => {
			void feedPcm(mediaSource, nextPiece).catch((error) => {
				if (mediaSource.readyState !== 'closed') console.warn('[tts] streamed playback stopped', error);
			});
		},
		{ once: true }
	);

	return {
		url: URL.createObjectURL(mediaSource),
		push: (samples) => {
			queue.push(samples);
			signal();
		},
		end: () => {
			ended = true;
			signal();
		}
	};
}

/** Encodes queued PCM pieces to Opus in a growing WebM and appends it to the open `MediaSource`. */
async function feedPcm(mediaSource: MediaSource, nextPiece: () => Promise<Float32Array | null>): Promise<void> {
	const { AudioSample, AudioSampleSource, Output, Quality, StreamTarget, WebMOutputFormat } = await import('mediabunny');
	const sourceBuffer = mediaSource.addSourceBuffer(STREAM_MIME_TYPE);
	const output = new Output({
		format: new WebMOutputFormat({ appendOnly: true, minimumClusterDuration: CLUSTER_SECONDS }),
		target: new StreamTarget(new WritableStream({ write: (chunk) => append(sourceBuffer, chunk.data) }))
	});
	const source = new AudioSampleSource({ codec: 'opus', quality: new Quality({ bitrate: SPEECH_BITRATE }) });
	output.addAudioTrack(source);
	await output.start();

	let timestamp = 0;
	for (let samples = await nextPiece(); samples; samples = await nextPiece()) {
		// The player moved on: nothing more to play.
		if (mediaSource.readyState === 'closed') return;
		const sample = new AudioSample({ data: samples, format: 'f32', numberOfChannels: 1, sampleRate: OPUS_SAMPLE_RATE, timestamp });
		await source.add(sample);
		sample.close();
		timestamp += samples.length / OPUS_SAMPLE_RATE;
	}
	await output.finalize();

	if (mediaSource.readyState === 'open') mediaSource.endOfStream();
}

/** Appends to the source buffer once its previous append has finished. */
async function append(sourceBuffer: SourceBuffer, data: Uint8Array<ArrayBuffer>): Promise<void> {
	if (sourceBuffer.updating) await updated(sourceBuffer);
	sourceBuffer.appendBuffer(data);
	await updated(sourceBuffer);
}

function updated(sourceBuffer: SourceBuffer): Promise<void> {
	return new Promise((resolve, reject) => {
		sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
		sourceBuffer.addEventListener('error', () => reject(new Error('The player refused the audio.')), { once: true });
	});
}
