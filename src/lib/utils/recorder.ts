import { resampleAudioTo16kHz } from './audio';

export interface Recording {
	blob: Blob;
	/** Object URL for immediate playback. Revoke when discarding. */
	url: string;
	/** 16 kHz mono PCM, ready for the STT engine. */
	pcm: Float32Array;
	durationSec: number;
}

/**
 * Microphone capture with live level metering.
 *
 * `MediaRecorder` produces the encoded blob; the blob is decoded to 16 kHz mono
 * PCM for the recogniser. The level callback drives the waveform and is only
 * active while recording. Everything is torn down on stop so the mic indicator
 * does not linger.
 */
export class VoiceRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private context: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private frame = 0;
	private startedAt = 0;
	private recording = false;

	/** Called ~30x/second while recording with a 0..1 RMS level. */
	public onLevel?: (level: number) => void;

	public get isRecording(): boolean {
		return this.recording;
	}

	public async start(): Promise<void> {
		if (this.recording) return;
		this.chunks = [];
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		});
		this.mediaRecorder = new MediaRecorder(this.stream);
		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		};
		this.mediaRecorder.start();
		this.startMetering();
		this.startedAt = performance.now();
		this.recording = true;
	}

	public stop(): Promise<Recording> {
		return new Promise((resolve, reject) => {
			const recorder = this.mediaRecorder;
			if (!recorder || !this.recording) {
				reject(new Error('Recording was not started.'));
				return;
			}
			const wallClockSec = (performance.now() - this.startedAt) / 1000;
			this.recording = false;

			recorder.onstop = async () => {
				const mimeType = recorder.mimeType || 'audio/webm';
				const blob = new Blob(this.chunks, { type: mimeType });
				this.teardownMetering();
				this.teardownStream();

				const url = URL.createObjectURL(blob);
				try {
					const { audioData, durationSec } = await resampleAudioTo16kHz(blob);
					resolve({
						blob,
						url,
						pcm: audioData,
						durationSec: durationSec || wallClockSec
					});
				} catch (error) {
					URL.revokeObjectURL(url);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			};

			recorder.stop();
		});
	}

	/** Stops without decoding or producing a recording. */
	public cancel(): void {
		if (this.mediaRecorder && this.recording) {
			try {
				this.mediaRecorder.stop();
			} catch {
				// already stopped
			}
		}
		this.recording = false;
		this.teardownMetering();
		this.teardownStream();
	}

	private startMetering(): void {
		if (!this.stream) return;
		try {
			this.context = new AudioContext();
			this.analyser = this.context.createAnalyser();
			this.analyser.fftSize = 256;
			this.source = this.context.createMediaStreamSource(this.stream);
			this.source.connect(this.analyser);

			const data = new Uint8Array(this.analyser.fftSize);
			const tick = () => {
				if (!this.analyser) return;
				this.analyser.getByteTimeDomainData(data);
				let sum = 0;
				for (let i = 0; i < data.length; i++) {
					const centered = (data[i] - 128) / 128;
					sum += centered * centered;
				}
				this.onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 3));
				this.frame = requestAnimationFrame(tick);
			};
			this.frame = requestAnimationFrame(tick);
		} catch {
			// Metering is cosmetic; capture still works without it.
		}
	}

	private teardownMetering(): void {
		if (this.frame) cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.source?.disconnect();
		this.source = null;
		this.analyser = null;
		void this.context?.close();
		this.context = null;
	}

	private teardownStream(): void {
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.mediaRecorder = null;
	}
}
