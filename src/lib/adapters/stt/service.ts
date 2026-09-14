import { WorkerWhisperAdapter } from './WorkerWhisperAdapter';
import { GroqWhisperAdapter } from './GroqWhisperAdapter';
import type { ModelProgress } from '../../types';

/** The model chosen by the lab: `whisper-small` at q4, WASM. */
export const LOCAL_STT_MODEL = 'onnx-community/whisper-small';
export const LOCAL_STT_DTYPE = 'q4';

export interface TranscribeOptions {
	audio16kMono: Float32Array;
	mode: 'local' | 'cloud';
	groqApiKey?: string;
	onProgress?: (progress: ModelProgress) => void;
}

export interface TranscriptResult {
	text: string;
	model: string;
	device: string;
}

let localAdapter: WorkerWhisperAdapter | null = null;

function getLocalAdapter(): WorkerWhisperAdapter {
	if (!localAdapter) {
		localAdapter = new WorkerWhisperAdapter({
			id: 'local-whisper-small-q4',
			name: 'Whisper Small (local, q4)',
			modelRepoId: LOCAL_STT_MODEL,
			dtype: LOCAL_STT_DTYPE
		});
	}
	return localAdapter;
}

/** Warms the local model up (downloads ~299 MB on a cold cache). */
export async function preloadLocalSTT(onProgress?: (progress: ModelProgress) => void): Promise<void> {
	await getLocalAdapter().load(onProgress);
}

const cloudAdapters = new Map<string, GroqWhisperAdapter>();

function getCloudAdapter(apiKey: string): GroqWhisperAdapter {
	let adapter = cloudAdapters.get(apiKey);
	if (!adapter) {
		adapter = new GroqWhisperAdapter({ apiKey });
		cloudAdapters.set(apiKey, adapter);
	}
	return adapter;
}

/**
 * Transcribes 16 kHz mono French speech, locally or through Groq.
 *
 * Local execution runs in the STT Worker, so the UI thread stays responsive
 * during the (large) model download and the decode.
 */
export async function transcribeFrench(options: TranscribeOptions): Promise<TranscriptResult> {
	if (options.mode === 'cloud') {
		if (!options.groqApiKey) {
			throw new Error('Cloud transcription needs a Groq API key. Add one in Settings.');
		}
		const adapter = getCloudAdapter(options.groqApiKey);
		await adapter.load(options.onProgress);
		const result = await adapter.transcribe(options.audio16kMono, { language: 'fr' });
		return { text: result.text, model: result.modelName, device: 'cloud' };
	}

	const adapter = getLocalAdapter();
	await adapter.load(options.onProgress);
	const result = await adapter.transcribe(options.audio16kMono);
	return { text: result.text, model: result.modelName, device: adapter.config.device ?? 'wasm' };
}

/** Diagnostic: proves the worker is alive and reports its capabilities. */
export async function sttDiagnostics(): Promise<{
	crossOriginIsolated?: boolean;
	hardwareConcurrency?: number;
	hasGpu?: boolean;
}> {
	return getLocalAdapter().ping();
}

export function disposeLocalSTT(): void {
	void localAdapter?.dispose();
	localAdapter = null;
}
