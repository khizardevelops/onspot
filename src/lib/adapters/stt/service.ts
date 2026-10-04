import { WorkerWhisperAdapter } from './WorkerWhisperAdapter';
import { GroqWhisperAdapter } from './GroqWhisperAdapter';
import { requireLanguage } from '#lib/languages/index.js';
import type { ModelProgress } from '../../types';

export interface TranscribeOptions {
	audio16kMono: Float32Array;
	mode: 'local' | 'cloud';
	/** Target language id; selects the approved local model and cloud code. */
	languageId: string;
	groqApiKey?: string;
	onProgress?: (progress: ModelProgress) => void;
}

export interface TranscriptResult {
	text: string;
	model: string;
	device: string;
}

let localAdapter: WorkerWhisperAdapter | null = null;
let localAdapterLanguage = '';

function getLocalAdapter(languageId: string): WorkerWhisperAdapter {
	const language = requireLanguage(languageId);
	if (!localAdapter || localAdapterLanguage !== language.id) {
		void localAdapter?.dispose();
		localAdapterLanguage = language.id;
		localAdapter = new WorkerWhisperAdapter({
			id: `local-${language.id}-${language.stt.modelRepoId}`,
			name: `${language.name} — local Whisper (${language.stt.dtype})`,
			modelRepoId: language.stt.modelRepoId,
			dtype: language.stt.dtype,
			language: language.stt.decoderLanguage
		});
	}
	return localAdapter;
}

/** Warms the local model up (downloads its approved weights on a cold cache). */
export async function preloadLocalSTT(
	languageId: string,
	onProgress?: (progress: ModelProgress) => void
): Promise<void> {
	await getLocalAdapter(languageId).load(onProgress);
}

/** Cancels an in-flight local model download by tearing the worker down. */
export function cancelLocalSTTDownload(): void {
	void localAdapter?.dispose();
	localAdapter = null;
	localAdapterLanguage = '';
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
 * Transcribes 16 kHz mono speech, locally or through Groq.
 *
 * Local execution runs in the STT Worker, so the UI thread stays responsive
 * during the (large) model download and the decode.
 */
export async function transcribeSpeech(options: TranscribeOptions): Promise<TranscriptResult> {
	const language = requireLanguage(options.languageId);
	if (options.mode === 'cloud') {
		if (!options.groqApiKey) {
			throw new Error('Cloud transcription needs a Groq API key. Add one in Settings.');
		}
		const adapter = getCloudAdapter(options.groqApiKey);
		await adapter.load(options.onProgress);
		const result = await adapter.transcribe(options.audio16kMono, {
			language: language.stt.code
		});
		return { text: result.text, model: result.modelName, device: 'cloud' };
	}

	const adapter = getLocalAdapter(language.id);
	await adapter.load(options.onProgress);
	const result = await adapter.transcribe(options.audio16kMono, {
		language: language.stt.decoderLanguage
	});
	return { text: result.text, model: result.modelName, device: adapter.config.device ?? 'wasm' };
}

/** Diagnostic: proves the worker is alive and reports its capabilities. */
export async function sttDiagnostics(languageId: string): Promise<{
	crossOriginIsolated?: boolean;
	hardwareConcurrency?: number;
	hasGpu?: boolean;
}> {
	return getLocalAdapter(languageId).ping();
}

/** Alias kept for callers that only need to release the worker. */
export function disposeLocalSTT(): void {
	cancelLocalSTTDownload();
}
