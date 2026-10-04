import { BaseSTTAdapter } from '../BaseSttAdapter';
import STTWorker from './stt.worker?worker';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '#lib/types.js';

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: ModelProgress) => void;
}

interface WorkerMessage {
	id: number;
	type: 'progress' | 'ready' | 'text' | 'error' | 'released';
	status?: string;
	progress?: number;
	device?: string;
	dtype?: string;
	text?: string;
	message?: string;
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
	private loadPromise: Promise<void> | null = null;
	private disposed = false;

	constructor(config: {
		id: string;
		name: string;
		modelRepoId: string;
		dtype?: string;
		language?: string;
		description?: string;
		parameterCount?: string;
		quantizedSize?: string;
	}) {
		const fullConfig: ModelConfig = {
			id: config.id,
			name: config.name,
			description: config.description ?? 'Whisper ONNX transcription, off the UI thread.',
			provider: 'Transformers.js',
			modelRepoId: config.modelRepoId,
			parameterCount: config.parameterCount ?? '244M',
			quantizedSize: config.quantizedSize ?? '~299 MB (q4)',
			language: config.language ?? 'Multilingual',
			dtype: config.dtype ?? 'q4',
			status: 'unloaded'
		};
		super(fullConfig);
		this.language = config.language ?? 'english';
		this.worker = new STTWorker();
		this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
		this.worker.onerror = (event) => {
			const error = new Error(event.message || 'STT worker crashed');
			this.rejectAll(error);
		};
	}

	private handle(message: WorkerMessage): void {
		// Idle-release notifications are unsolicited (id 0), so handle them
		// before looking for a pending request.
		if (message.type === 'released') {
			this.setStatus('unloaded');
			this.progress = null;
			return;
		}
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

	private request(
		payload: Record<string, unknown>,
		transfer: Transferable[] = [],
		onProgress?: (progress: ModelProgress) => void
	): Promise<unknown> {
		// A terminated worker drops messages silently, so a request made after
		// dispose (e.g. a take racing a cancelled download) would never settle.
		if (this.disposed) return Promise.reject(new Error('STT worker disposed.'));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onProgress });
			this.worker.postMessage({ id, ...payload }, transfer);
		});
	}

	public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
		if (this.status === 'ready') return;
		// A second caller (e.g. a take while the language download is still
		// running) joins the in-flight load instead of building the model twice;
		// `updateProgress` keeps it informed through `onProgressCallback`.
		if (this.loadPromise) {
			if (onProgress) this.onProgressCallback = onProgress;
			return this.loadPromise;
		}
		this.setStatus('loading');
		this.loadPromise = (async () => {
			try {
				await this.request(
					{ type: 'load', model: this.config.modelRepoId, dtype: this.config.dtype },
					[],
					onProgress
				);
			} catch (error) {
				this.setStatus('error', error instanceof Error ? error.message : String(error));
				throw error;
			} finally {
				this.loadPromise = null;
				this.onProgressCallback = undefined;
			}
		})();
		return this.loadPromise;
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
				language: options?.language ?? this.language,
				model: this.config.modelRepoId,
				dtype: this.config.dtype
			},
			[copy.buffer]
		);
		return String(text);
	}

	public async dispose(): Promise<void> {
		this.disposed = true;
		this.worker.terminate();
		// Reject in-flight requests first; a bare terminate would leave their
		// promises pending forever and wedge the download state.
		this.rejectAll(new Error('STT worker disposed.'));
		await super.dispose();
	}
}
