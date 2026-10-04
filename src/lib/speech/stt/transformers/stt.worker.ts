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
} from './pipeline';

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
	/** Lets the worker reload a pipeline that was idle-released in the meantime. */
	model?: string;
	dtype?: string;
}

interface ReleaseRequest {
	id: number;
	type: 'release';
}

type Request = LoadRequest | TranscribeRequest | ReleaseRequest;

type Response =
	| { id: number; type: 'progress'; status: string; progress: number }
	| { id: number; type: 'ready'; device: string; dtype: string }
	| { id: number; type: 'text'; text: string }
	| { id: number; type: 'released' }
	| { id: number; type: 'error'; message: string };

const TARGET_SAMPLE_RATE = 16000;

let transcriber: unknown = null;
let loadedModel = '';
let resolvedDevice = 'wasm';
let resolvedDtype = 'q4';
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_RELEASE_MS = 90_000;
/** One in-flight build per worker; concurrent requests wait on it instead of building twice. */
let loading: { model: string; promise: Promise<void> } | null = null;
/** Every request currently waiting on `loading`, so each one sees download progress. */
const progressIds = new Set<number>();

function post(message: Response, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(message, transfer ?? []);
}

function cancelIdleRelease(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
}

async function buildPipeline(model: string, dtype: string): Promise<void> {
	resolvedDevice = 'wasm';
	resolvedDtype = dtype;
	const next = await createASRPipeline(model, {
		dtype,
		progress_callback: createDownloadProgress((status, progress) => {
			for (const id of progressIds) post({ id, type: 'progress', status, progress });
		}),
		onDeviceResolved: (device, deviceDtype) => {
			resolvedDevice = device;
			resolvedDtype = deviceDtype;
		}
	});
	const previous = transcriber as { dispose?: () => Promise<void> | void } | null;
	transcriber = next;
	loadedModel = model;
	if (previous && previous !== next) await previous.dispose?.();
}

/**
 * Makes sure `model` is resident. Messages are handled concurrently (each
 * `onmessage` is async), so a download-bar preload and a practice transcription
 * used to build two copies of the same ~300 MB model side by side.
 */
async function ensurePipeline(model: string, dtype: string, requestId: number): Promise<void> {
	cancelIdleRelease();
	if (transcriber && loadedModel === model && !loading) return;
	if (!loading || loading.model !== model) {
		const promise = (loading?.promise ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => buildPipeline(model, dtype))
			.finally(() => {
				if (loading?.promise === promise) loading = null;
			});
		loading = { model, promise };
	}
	progressIds.add(requestId);
	try {
		await loading.promise;
	} finally {
		progressIds.delete(requestId);
	}
}

async function releasePipeline(id: number): Promise<void> {
	cancelIdleRelease();
	// Detach before awaiting: a transcribe that arrives during `dispose()` must
	// not run on a pipeline that is being torn down.
	const pipeline = transcriber as { dispose?: () => Promise<void> | void } | null;
	transcriber = null;
	loadedModel = '';
	if (pipeline?.dispose) await pipeline.dispose();
	post({ id, type: 'released' });
}

let activeTranscriptions = 0;

function scheduleIdleRelease(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		// Never release while a load is in flight or a transcription is running.
		if (loading || activeTranscriptions > 0) scheduleIdleRelease();
		else void releasePipeline(0);
	}, IDLE_RELEASE_MS);
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;

	try {
		switch (request.type) {
			case 'release': {
				await releasePipeline(request.id);
				return;
			}

			case 'load': {
				await ensurePipeline(request.model, request.dtype ?? 'q4', request.id);
				post({
					id: request.id,
					type: 'ready',
					device: resolvedDevice,
					dtype: resolvedDtype
				});
				// A preload (Settings → Language data) must not pin ~2 GB of RAM
				// until the first take; the bytes stay in the Cache API either way.
				scheduleIdleRelease();
				return;
			}

			case 'transcribe': {
				cancelIdleRelease();
				if (request.sampleRate !== TARGET_SAMPLE_RATE) {
					throw new Error(
						`Expected 16 kHz PCM, received ${request.sampleRate} Hz. Resample before sending.`
					);
				}
				activeTranscriptions++;
				try {
					// The idle timer may have released the model after the main thread
					// last saw it as ready; reload it rather than failing the take.
					if (request.model) await ensurePipeline(request.model, request.dtype ?? 'q4', request.id);
					else if (loading) await loading.promise;
					if (!transcriber) {
						throw new Error('STT worker has no model loaded. Send a load request first.');
					}
					const durationSec = request.pcm.length / TARGET_SAMPLE_RATE;
					const text = await whisperTranscribe(transcriber as never, request.pcm, durationSec, {
						language: request.language ?? 'french'
					});
					post({ id: request.id, type: 'text', text });
				} finally {
					activeTranscriptions--;
					scheduleIdleRelease();
				}
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
