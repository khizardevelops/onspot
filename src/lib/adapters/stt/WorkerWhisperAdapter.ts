import { BaseSTTAdapter } from './BaseAdapter';
import STTWorker from '../../workers/stt.worker?worker';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: ModelProgress) => void;
}

interface WorkerMessage {
	id: number;
	type: 'progress' | 'ready' | 'text' | 'error' | 'pong';
	status?: string;
	progress?: number;
	device?: string;
	dtype?: string;
	text?: string;
	message?: string;
	crossOriginIsolated?: boolean;
	hardwareConcurrency?: number;
	hasGpu?: boolean;
}

/**
 * Main-thread proxy for the STT worker.
 *
 * Implements the same adapter contract as `WhisperAdapter`, but all model
 * construction and inference happens off the UI thread. The intent is to
 * replace `WhisperAdapter` for the product's default local model.
 */
export class WorkerWhisperAdapter extends BaseSTTAdapter {
	private readonly worker: Worker;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly language: string;

	constructor(config: {
		id: string;
		name: string;
		modelRepoId: string;
		dtype?: string;
		language?: string;
		description?: string;
	}) {
		const fullConfig: ModelConfig = {
			id: config.id,
			name: config.name,
			description: config.description ?? 'Whisper ONNX transcription, off the UI thread.',
			provider: 'Transformers.js',
			modelRepoId: config.modelRepoId,
			parameterCount: '244M',
			quantizedSize: '~299 MB (q4)',
			language: 'Multilingual / French',
			dtype: config.dtype ?? 'q4',
			status: 'unloaded'
		};
		super(fullConfig);
		this.language = config.language ?? 'french';
		this.worker = new STTWorker();
		this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'STT worker crashed');
			this.rejectAll(error);
		};
	}

	private handle(message: WorkerMessage): void {
		const entry = this.pending.get(message.id);
		if (!entry) return;

		switch (message.type) {
			case 'progress': {
				const progress: ModelProgress = {
					status: message.status ?? '',
					progress: message.progress ?? 0
				};
				this.updateProgress(progress.status, progress.progress);
				entry.onProgress?.(progress);
				return;
			}
			case 'ready': {
				this.pending.delete(message.id);
				this.config.device = (message.device as 'wasm' | 'webgpu') ?? 'wasm';
				this.config.resolvedDtype = message.dtype;
				this.setStatus('ready');
				entry.resolve({ device: message.device, dtype: message.dtype });
				return;
			}
			case 'text': {
				this.pending.delete(message.id);
				entry.resolve(message.text ?? '');
				return;
			}
			case 'pong': {
				this.pending.delete(message.id);
				entry.resolve({
					crossOriginIsolated: message.crossOriginIsolated,
					hardwareConcurrency: message.hardwareConcurrency,
					hasGpu: message.hasGpu
				});
				return;
			}
			case 'error': {
				this.pending.delete(message.id);
				entry.reject(new Error(message.message ?? 'STT worker error'));
				return;
			}
		}
	}

	private rejectAll(error: Error): void {
		for (const { reject } of this.pending.values()) reject(error);
		this.pending.clear();
	}

	/** Confirms the worker is alive and reports its isolation/thread capability. */
	public ping(): Promise<{
		crossOriginIsolated?: boolean;
		hardwareConcurrency?: number;
		hasGpu?: boolean;
	}> {
		return this.request({ type: 'ping' }) as Promise<{
			crossOriginIsolated?: boolean;
			hardwareConcurrency?: number;
			hasGpu?: boolean;
		}>;
	}

	private request(
		payload: Record<string, unknown>,
		transfer: Transferable[] = [],
		onProgress?: (progress: ModelProgress) => void
	): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onProgress });
			this.worker.postMessage({ id, ...payload }, transfer);
		});
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (this.status === 'ready') {
			this.setStatus('ready');
			return;
		}
		this.setStatus('loading');
		try {
			await this.request(
				{ type: 'load', model: this.config.modelRepoId, dtype: this.config.dtype },
				[],
				onProgress
			);
		} catch (error) {
			this.setStatus('error', error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	public async doTranscribe(
		audio16kMono: Float32Array,
		_durationSec: number,
		options?: TranscribeOptions
	): Promise<string> {
		// Copy before transferring: the transfer detaches the buffer, and the
		// caller's array must stay valid.
		const copy = audio16kMono.slice();
		const text = await this.request(
			{
				type: 'transcribe',
				pcm: copy,
				sampleRate: 16000,
				language: options?.language === 'fr' || options?.language === 'french' ? 'french' : this.language
			},
			[copy.buffer]
		);
		return String(text);
	}

	public async dispose(): Promise<void> {
		this.worker.terminate();
		this.pending.clear();
		await super.dispose();
	}
}
