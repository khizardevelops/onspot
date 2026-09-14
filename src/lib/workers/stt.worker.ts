/// <reference lib="webworker" />
/**
 * STT worker.
 *
 * Transformers.js model construction and inference used to run on the main
 * thread, which froze the tab hard enough that no progress indicator could
 * repaint and the UI was unclickable (see references/bugs.md). Everything heavy
 * now lives here: the pipeline, the feature extraction and the decode loop.
 *
 * Protocol is request/response by numeric id. Audio is moved in, not copied.
 */
import {
	createASRPipeline,
	createDownloadProgress,
	whisperTranscribe
} from '../adapters/stt/engine';

interface LoadRequest {
	id: number;
	type: 'load';
	model: string;
	dtype?: string;
	language?: string;
}

interface TranscribeRequest {
	id: number;
	type: 'transcribe';
	pcm: Float32Array;
	sampleRate: number;
	language?: string;
}

interface PingRequest {
	id: number;
	type: 'ping';
}

interface ReleaseRequest {
	id: number;
	type: 'release';
}

type Request = LoadRequest | TranscribeRequest | PingRequest | ReleaseRequest;

type Response =
	| {
			id: number;
			type: 'pong';
			crossOriginIsolated: boolean;
			hardwareConcurrency: number;
			hasGpu: boolean;
	  }
	| { id: number; type: 'progress'; status: string; progress: number }
	| { id: number; type: 'ready'; device: string; dtype: string }
	| { id: number; type: 'text'; text: string }
	| { id: number; type: 'released' }
	| { id: number; type: 'error'; message: string };

const TARGET_SAMPLE_RATE = 16000;

let transcriber: unknown = null;
let loadedModel = '';
let activeLoadId: number | null = null;
let resolvedDevice = 'wasm';
let resolvedDtype = 'q4';
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_RELEASE_MS = 90_000;

function post(message: Response, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(message, transfer ?? []);
}

async function loadPipeline(model: string, dtype: string, loadId: number): Promise<void> {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
	activeLoadId = loadId;
	resolvedDevice = 'wasm';
	resolvedDtype = dtype;
	try {
		transcriber = await createASRPipeline(model, {
			dtype,
			progress_callback: createDownloadProgress((status, progress) => {
				if (activeLoadId !== null) post({ id: activeLoadId, type: 'progress', status, progress });
			}),
			onDeviceResolved: (device, deviceDtype) => {
				resolvedDevice = device;
				resolvedDtype = deviceDtype;
			}
		});
		loadedModel = model;
	} finally {
		activeLoadId = null;
	}
}

async function releasePipeline(id: number): Promise<void> {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
	const pipeline = transcriber as { dispose?: () => Promise<void> | void } | null;
	if (pipeline?.dispose) await pipeline.dispose();
	transcriber = null;
	loadedModel = '';
	post({ id, type: 'released' });
}

function scheduleIdleRelease(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => void releasePipeline(0), IDLE_RELEASE_MS);
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;

	try {
		switch (request.type) {
			case 'release': {
				await releasePipeline(request.id);
				return;
			}

			case 'ping': {
				post({
					id: request.id,
					type: 'pong',
					crossOriginIsolated: self.crossOriginIsolated,
					hardwareConcurrency: navigator.hardwareConcurrency ?? 1,
					hasGpu: 'gpu' in navigator
				});
				return;
			}

			case 'load': {
				await loadPipeline(request.model, request.dtype ?? 'q4', request.id);
				post({
					id: request.id,
					type: 'ready',
					device: resolvedDevice,
					dtype: resolvedDtype
				});
				return;
			}

			case 'transcribe': {
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = null;
				if (!transcriber) {
					throw new Error('STT worker has no model loaded. Send a load request first.');
				}
				if (request.sampleRate !== TARGET_SAMPLE_RATE) {
					throw new Error(
						`Expected 16 kHz PCM, received ${request.sampleRate} Hz. Resample before sending.`
					);
				}
				const durationSec = request.pcm.length / TARGET_SAMPLE_RATE;
				const text = await whisperTranscribe(transcriber as never, request.pcm, durationSec, {
					language: request.language ?? 'french'
				});
				post({ id: request.id, type: 'text', text });
				scheduleIdleRelease();
				return;
			}
		}
	} catch (error) {
		post({
			id: request.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
