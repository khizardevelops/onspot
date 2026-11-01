// SPDX-License-Identifier: AGPL-3.0-or-later

import { recordingFormat, startOpusTakeEncoder, type OpusTakeEncoder } from '#lib/speech/audioFormat.js';
import { resampleAudioTo16kHz } from './audio';

export interface Recording {
	/** The take as recorded: Opus where the platform has it (see `recordingFormat`). */
	blob: Blob;
	/** Object URL for immediate playback. Revoke when discarding. */
	url: string;
	/** 16 kHz mono PCM, ready for the STT engine. */
	pcm: Float32Array;
	durationSec: number;
}

/** Shown when this system can encode a take neither way. */
const RECORDING_UNSUPPORTED_MESSAGE =
	"Recording isn't supported on this system: its web engine can encode Opus audio neither with MediaRecorder " +
	'nor with WebCodecs. Updating the system (on Linux, its WebKitGTK and GStreamer) or using the onspot Flatpak fixes this.';

/** Shown when a take ends without any audio in it. */
const NO_AUDIO_MESSAGE =
	'The microphone sent no audio. Check that it is connected and not in use by another app, then try again.';

/** Shown when the WebCodecs path never receives audio from the microphone. */
const MICROPHONE_SILENT_MESSAGE =
	'The microphone did not start sending audio. Check that it is connected and not in use by another app, then try again.';

/**
 * Frames per block when recording through WebCodecs: about 85 ms at 48 kHz,
 * few enough callbacks for the main thread.
 */
const CAPTURE_BLOCK_FRAMES = 4096;

/**
 * How long the WebCodecs path waits for the first block of audio before giving
 * up. WebKitGTK 2.50 took 1.6 s to start delivering audio on a cold first take,
 * so the take only counts as started once audio is flowing; otherwise the
 * learner's first words are lost.
 */
const MICROPHONE_START_TIMEOUT_MS = 5000;

/** How often the level meter reports, in ms; it is decorative, so not every frame. */
const LEVEL_REPORT_INTERVAL_MS = 40;

/**
 * Microphone capture with live level metering.
 *
 * The take is encoded to compact Opus while it is captured, in one of two ways:
 * - `MediaRecorder`, wherever it can record one of onspot's Opus containers
 *   (browsers, the Android WebView, and WebKitGTK on GStreamer 1.24.9 or newer);
 * - otherwise WebCodecs, fed from the Web Audio graph that also drives the
 *   level meter. WebKitGTK on older GStreamer (the AppImage, and the .deb or
 *   .rpm on Ubuntu 22.04 and 24.04) has no usable MediaRecorder but does
 *   encode Opus.
 *
 * Either way the blob is decoded to 16 kHz mono PCM for the on-device
 * recogniser and the silence check. The level callback drives the waveform and
 * is only active while recording. Everything is torn down on stop or cancel so
 * the mic indicator does not linger.
 */
export class VoiceRecorder {
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private analyser: AnalyserNode | null = null;
	private frame = 0;

	/** The MediaRecorder path. */
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];

	/** The WebCodecs path. */
	private captureNode: ScriptProcessorNode | null = null;
	private opusEncoder: OpusTakeEncoder | null = null;
	/** Resolvers waiting for the next captured block (see `waitForNextBlock`). */
	private blockWaiters: Array<(hasArrived: boolean) => void> = [];

	private startedAt = 0;
	private recording = false;

	/** Called ~25x/second while recording with a 0..1 RMS level. */
	public onLevel?: (level: number) => void;

	public get isRecording(): boolean {
		return this.recording;
	}

	/**
	 * Opens the microphone and starts the take.
	 *
	 * @throws When the microphone is unavailable or permission is refused, or
	 *   when this system cannot record Opus at all.
	 */
	public async start(): Promise<void> {
		if (this.recording) return;

		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		});
		this.stream = stream;

		try {
			const format = recordingFormat();
			const startedMediaRecorder = format !== null && this.startMediaRecorder(stream, format);
			if (!startedMediaRecorder) await this.startOpusEncoder(stream);
		} catch (error) {
			this.discardOpusEncoder();
			this.teardown();
			throw error;
		}

		this.startMetering(stream);
		this.startedAt = performance.now();
		this.recording = true;
	}

	/**
	 * Ends the take.
	 *
	 * @returns The encoded take, its playback URL and its 16 kHz PCM.
	 */
	public async stop(): Promise<Recording> {
		if (!this.recording) throw new Error('Recording was not started.');

		const wallClockSec = (performance.now() - this.startedAt) / 1000;
		this.recording = false;

		let blob: Blob;
		try {
			blob = this.mediaRecorder ? await this.stopMediaRecorder(this.mediaRecorder) : await this.finishOpusEncoder();
		} finally {
			this.teardown();
		}

		const url = URL.createObjectURL(blob);
		try {
			const { audioData, durationSec } = await resampleAudioTo16kHz(blob);
			return { blob, url, pcm: audioData, durationSec: durationSec || wallClockSec };
		} catch (error) {
			URL.revokeObjectURL(url);
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	/** Stops without decoding or producing a recording. */
	public cancel(): void {
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
		this.discardOpusEncoder();

		this.recording = false;
		this.teardown();
	}

	/**
	 * Starts MediaRecorder on the stream.
	 *
	 * @returns False when the engine refuses to record after all (it can say it
	 *   supports a type and still throw), so the WebCodecs path can take over.
	 */
	private startMediaRecorder(stream: MediaStream, format: MediaRecorderOptions): boolean {
		try {
			this.chunks = [];
			const recorder = new MediaRecorder(stream, format);
			recorder.ondataavailable = (event) => {
				// A recorder that was cancelled can still deliver its last data.
				if (event.data.size > 0 && this.mediaRecorder === recorder) this.chunks.push(event.data);
			};
			recorder.start();
			this.mediaRecorder = recorder;
			return true;
		} catch (error) {
			console.warn('MediaRecorder cannot record here; recording through WebCodecs instead.', error);
			return false;
		}
	}

	/** Stops MediaRecorder and collects its take. */
	private stopMediaRecorder(recorder: MediaRecorder): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const collectTake = () => {
				const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
				if (blob.size === 0) reject(new Error(NO_AUDIO_MESSAGE));
				else resolve(blob);
			};

			// An engine error can stop the recorder early; its last data has arrived then.
			if (recorder.state === 'inactive') {
				collectTake();
				return;
			}

			recorder.onstop = collectTake;
			recorder.stop();
		});
	}

	/**
	 * Records through WebCodecs: a script processor on the stream's Web Audio
	 * graph hands each block of PCM to the Opus encoder.
	 *
	 * A script processor rather than an AudioWorklet: it needs no separate
	 * module, runs in every engine onspot supports, and is what Mediabunny's
	 * own media-stream capture falls back to.
	 */
	private async startOpusEncoder(stream: MediaStream): Promise<void> {
		const { context, source } = this.openAudioGraph(stream);
		if (context.state === 'suspended') await context.resume();

		const encoder = await startOpusTakeEncoder(context.sampleRate);
		if (!encoder) throw new Error(RECORDING_UNSUPPORTED_MESSAGE);
		this.opusEncoder = encoder;

		const captureNode = context.createScriptProcessor(CAPTURE_BLOCK_FRAMES, 1, 1);
		captureNode.onaudioprocess = (event) => {
			// The engine reuses this buffer for the next block.
			const block = event.inputBuffer.getChannelData(0).slice();
			encoder.add(block);
			this.notifyBlockWaiters(true);
		};

		source.connect(captureNode);
		// A script processor only runs while connected to the output; it outputs silence.
		captureNode.connect(context.destination);
		this.captureNode = captureNode;

		const isAudioFlowing = await this.waitForNextBlock(MICROPHONE_START_TIMEOUT_MS);
		if (!isAudioFlowing) throw new Error(MICROPHONE_SILENT_MESSAGE);
	}

	/** Stops capturing and closes the Opus file. */
	private async finishOpusEncoder(): Promise<Blob> {
		const encoder = this.opusEncoder;
		if (!encoder) throw new Error('Recording was not started.');

		// The block holding the moment the learner stopped is still filling;
		// wait for it (two block lengths at most) so the last word is not clipped.
		if (this.context) {
			const blockMs = (CAPTURE_BLOCK_FRAMES / this.context.sampleRate) * 1000;
			await this.waitForNextBlock(blockMs * 2);
		}
		this.stopCapture();

		return encoder.finish();
	}

	/**
	 * The Web Audio graph for the stream, opened once and shared by the level
	 * meter and the WebCodecs path.
	 */
	private openAudioGraph(stream: MediaStream): { context: AudioContext; source: MediaStreamAudioSourceNode } {
		if (!this.context || !this.source) {
			this.context = new AudioContext();
			this.source = this.context.createMediaStreamSource(stream);
		}

		return { context: this.context, source: this.source };
	}

	private startMetering(stream: MediaStream): void {
		try {
			const { context, source } = this.openAudioGraph(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			this.analyser = analyser;

			const data = new Uint8Array(analyser.fftSize);
			let lastReport = 0;
			let smoothed = 0;
			const tick = () => {
				if (!this.analyser) return;
				const now = performance.now();
				// The meter is decorative. Updating the global practice store at the
				// display refresh rate made every subscriber do unnecessary work.
				if (now - lastReport >= LEVEL_REPORT_INTERVAL_MS) {
					this.analyser.getByteTimeDomainData(data);
					let sum = 0;
					for (let i = 0; i < data.length; i++) {
						const centered = (data[i] - 128) / 128;
						sum += centered * centered;
					}
					const level = Math.min(1, Math.sqrt(sum / data.length) * 3);
					smoothed = smoothed * 0.58 + level * 0.42;
					this.onLevel?.(smoothed);
					lastReport = now;
				}
				this.frame = requestAnimationFrame(tick);
			};
			this.frame = requestAnimationFrame(tick);
		} catch (error) {
			// Metering is cosmetic; capture still works without it.
			console.warn('The level meter is unavailable.', error);
		}
	}

	/**
	 * Waits for the WebCodecs path's next block of audio.
	 *
	 * @param timeoutMs How long to wait at most.
	 * @returns True when a block arrived; false on timeout or when capture stopped.
	 */
	private waitForNextBlock(timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.blockWaiters = this.blockWaiters.filter((waiter) => waiter !== onBlock);
				resolve(false);
			}, timeoutMs);

			const onBlock = (hasArrived: boolean) => {
				clearTimeout(timer);
				resolve(hasArrived);
			};
			this.blockWaiters.push(onBlock);
		});
	}

	private notifyBlockWaiters(hasArrived: boolean): void {
		const waiters = this.blockWaiters;
		this.blockWaiters = [];
		waiters.forEach((waiter) => waiter(hasArrived));
	}

	/** Drops a WebCodecs take that will not be finished. */
	private discardOpusEncoder(): void {
		const encoder = this.opusEncoder;
		if (!encoder) return;

		this.stopCapture();
		this.opusEncoder = null;
		encoder.cancel().catch((error: unknown) => console.warn('Could not discard the Opus take.', error));
	}

	private stopCapture(): void {
		if (!this.captureNode) return;

		this.captureNode.onaudioprocess = null;
		this.captureNode.disconnect();
		this.captureNode = null;
		this.notifyBlockWaiters(false);
	}

	/** Releases the microphone, the audio graph and both encoders. */
	private teardown(): void {
		this.stopCapture();
		this.opusEncoder = null;

		if (this.frame) cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.analyser = null;
		this.source?.disconnect();
		this.source = null;
		void this.context?.close();
		this.context = null;

		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.mediaRecorder = null;
		this.chunks = [];
	}
}
