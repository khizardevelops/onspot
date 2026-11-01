// SPDX-License-Identifier: AGPL-3.0-or-later

import TTSWorker from './tts.worker?worker';
import type { ModelProgress } from '#lib/types.js';

interface SpeechPayload {
	audio: Float32Array;
	samplingRate: number;
	modelName: string;
	durationSec: number;
	peak: number;
}

/**
 * Who is waiting for a request: a learner listening now, or clips made ahead
 * of time so they are ready when tapped. Read each time the next request is
 * chosen, so a production being prepared becomes listened the moment the
 * learner taps it.
 */
export type SpeechPriority = 'foreground' | 'background';

type WorkerRequest = { type: 'synthesize'; voice: string; text: string } | { type: 'load'; voice: string };

interface Pending {
	request: WorkerRequest;
	priority: () => SpeechPriority;
	resolve: (value: SpeechPayload) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: ModelProgress) => void;
}

type WorkerMessage =
	| { id: number; type: 'progress'; progress: ModelProgress }
	| ({ id: number; type: 'speech' } & SpeechPayload)
	| { id: number; type: 'ready' }
	| { id: number; type: 'error'; message: string };

/**
 * After a listened request finishes, background requests hold back this
 * long: the listened clip asks for its next piece a moment later (once the
 * last one is processed), and a background piece taking the voice in
 * between is what made playback stall.
 */
const FOREGROUND_GRACE_MS = 1_200;

/**
 * An idle worker is ended after this long. ONNX Runtime's WebAssembly memory
 * only ever grows, to the size of the largest run, so unloading the voices
 * does not give it back; ending the worker does. The next request starts a
 * new one (the voice files come from the cache).
 */
const IDLE_SHUTDOWN_MS = 90_000;

const NO_SPEECH: SpeechPayload = { audio: new Float32Array(), samplingRate: 0, modelName: '', durationSec: 0, peak: 0 };

/**
 * Main-thread proxy for local Piper. The worker is created on first use and
 * ended when idle. Requests go to it one at a time, listened ones first, so
 * a clip the learner is listening to never waits behind clips being prepared.
 */
export class WorkerPiperAdapter {
	private worker: Worker | null = null;
	private nextId = 1;
	/** Every request not yet answered, in the order it was made; the one in flight included. */
	private readonly pending = new Map<number, Pending>();
	private inFlight: number | null = null;
	private lastForegroundFinishedAt = 0;
	private graceTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new TTSWorker();
		worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
		worker.onerror = (event) => this.rejectAll(new Error(event.message || 'TTS worker crashed'));
		this.worker = worker;
		return worker;
	}

	private enqueue(request: WorkerRequest, priority: () => SpeechPriority, onProgress?: (progress: ModelProgress) => void): Promise<SpeechPayload> {
		const id = this.nextId++;
		this.cancelIdleShutdown();

		return new Promise((resolve, reject) => {
			this.pending.set(id, { request, priority, resolve, reject, onProgress });
			this.dispatchNext();
		});
	}

	/** Sends the next request when the worker is free: the oldest listened one, else (after the grace) the oldest prepared one. */
	private dispatchNext(): void {
		if (this.inFlight !== null) return;

		const waiting = [...this.pending.entries()];
		const listened = waiting.find(([, entry]) => entry.priority() === 'foreground');
		if (!listened && waiting.length > 0) {
			const graceLeft = this.lastForegroundFinishedAt + FOREGROUND_GRACE_MS - Date.now();
			if (graceLeft > 0) {
				this.graceTimer ??= setTimeout(() => {
					this.graceTimer = null;
					this.dispatchNext();
				}, graceLeft);
				return;
			}
		}

		const next = listened ?? waiting[0];
		if (!next) {
			this.scheduleIdleShutdown();
			return;
		}

		const [id, entry] = next;
		this.inFlight = id;
		this.ensureWorker().postMessage({ id, ...entry.request });
	}

	private handle(message: WorkerMessage): void {
		const entry = this.pending.get(message.id);
		if (!entry) return;
		if (message.type === 'progress') {
			entry.onProgress?.(message.progress);
			return;
		}

		this.pending.delete(message.id);
		if (this.inFlight === message.id) this.inFlight = null;
		if (entry.priority() === 'foreground') this.lastForegroundFinishedAt = Date.now();

		if (message.type === 'error') entry.reject(new Error(message.message));
		else if (message.type === 'speech') entry.resolve(message);
		else entry.resolve(NO_SPEECH);

		this.dispatchNext();
	}

	private scheduleIdleShutdown(): void {
		this.cancelIdleShutdown();
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			if (this.pending.size > 0) return;
			this.worker?.terminate();
			this.worker = null;
		}, IDLE_SHUTDOWN_MS);
	}

	private cancelIdleShutdown(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	private rejectAll(error: Error): void {
		for (const entry of this.pending.values()) entry.reject(error);
		this.pending.clear();
		this.inFlight = null;
		if (this.graceTimer) clearTimeout(this.graceTimer);
		this.graceTimer = null;
		this.cancelIdleShutdown();
		this.worker?.terminate();
		this.worker = null;
	}

	/**
	 * Speaks a text with a local voice.
	 *
	 * @param voice The voice id.
	 * @param text What to say (one piece; see `textPieces.ts`).
	 * @param onProgress Reports a voice that has to be loaded first.
	 * @param priority Who is waiting for it; a listener by default.
	 */
	public synthesize(
		voice: string,
		text: string,
		onProgress?: (progress: ModelProgress) => void,
		priority: () => SpeechPriority = () => 'foreground'
	): Promise<SpeechPayload> {
		return this.enqueue({ type: 'synthesize', voice, text }, priority, onProgress);
	}

	/**
	 * Downloads and initializes a voice without synthesizing anything. Used by
	 * the language-data download so the bytes land before the first session.
	 */
	public async preload(voice: string, onProgress?: (progress: ModelProgress) => void): Promise<void> {
		await this.enqueue({ type: 'load', voice }, () => 'foreground', onProgress);
	}

	public dispose(): void {
		this.rejectAll(new Error('TTS worker disposed.'));
	}
}
