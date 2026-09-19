import TTSWorker from '../../workers/tts.worker?worker';
import type { ModelProgress } from '../../types';

interface SpeechPayload {
	audio: Float32Array;
	samplingRate: number;
	modelName: string;
	durationSec: number;
	peak: number;
}

interface Pending {
	resolve: (value: SpeechPayload) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: ModelProgress) => void;
}

type WorkerMessage =
	| { id: number; type: 'progress'; progress: ModelProgress }
	| ({ id: number; type: 'speech' } & SpeechPayload)
	| { id: number; type: 'ready' }
	| { id: number; type: 'released' }
	| { id: number; type: 'error'; message: string };

/** Main-thread proxy for local Piper. The worker is created lazily on first use. */
export class WorkerPiperAdapter {
	private worker: Worker | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new TTSWorker();
		worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
		worker.onerror = (event) => this.rejectAll(new Error(event.message || 'TTS worker crashed'));
		this.worker = worker;
		return worker;
	}

	private handle(message: WorkerMessage): void {
		if (message.type === 'released' && message.id === 0) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		if (message.type === 'progress') {
			pending.onProgress?.(message.progress);
			return;
		}
		this.pending.delete(message.id);
		if (message.type === 'error') {
			pending.reject(new Error(message.message));
			return;
		}
		if (message.type === 'speech') {
			pending.resolve({
				audio: message.audio,
				samplingRate: message.samplingRate,
				modelName: message.modelName,
				durationSec: message.durationSec,
				peak: message.peak
			});
			return;
		}
		if (message.type === 'ready') {
			pending.resolve({
				audio: new Float32Array(),
				samplingRate: 0,
				modelName: '',
				durationSec: 0,
				peak: 0
			});
			return;
		}
		pending.resolve({
			audio: new Float32Array(),
			samplingRate: 0,
			modelName: '',
			durationSec: 0,
			peak: 0
		});
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
	}

	public synthesize(
		voice: string,
		text: string,
		onProgress?: (progress: ModelProgress) => void
	): Promise<SpeechPayload> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onProgress });
			this.ensureWorker().postMessage({ id, type: 'synthesize', voice, text });
		});
	}

	/**
	 * Downloads and initializes a voice without synthesizing anything. Used by
	 * the language-data download so the bytes land before the first session.
	 */
	public preload(
		voice: string,
		onProgress?: (progress: ModelProgress) => void
	): Promise<void> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: () => resolve(),
				reject,
				onProgress
			});
			this.ensureWorker().postMessage({ id, type: 'load', voice });
		});
	}

	public dispose(): void {
		this.rejectAll(new Error('TTS worker disposed.'));
	}
}
