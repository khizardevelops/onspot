/// <reference lib="webworker" />

/**
 * Local Piper host. Loading, phonemization and ONNX inference all happen here,
 * and requests are serialized because one ONNX session must not be run by two
 * word-clicks at once. Only one voice stays resident; it is released after an
 * idle period to return memory to the browser.
 */
import type { ModelProgress } from '../types';

interface SynthesizeRequest {
	id: number;
	type: 'synthesize';
	voice: string;
	text: string;
}

interface ReleaseRequest {
	id: number;
	type: 'release';
}

type Request = SynthesizeRequest | ReleaseRequest;

type Response =
	| { id: number; type: 'progress'; progress: ModelProgress }
	| {
			id: number;
			type: 'speech';
			audio: Float32Array;
			samplingRate: number;
			modelName: string;
			durationSec: number;
			peak: number;
	  }
	| { id: number; type: 'released' }
	| { id: number; type: 'error'; message: string };

const IDLE_RELEASE_MS = 90_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue = Promise.resolve();
let registryPromise: Promise<typeof import('../adapters/tts/registry').ttsRegistry> | null = null;

function getRegistry(): Promise<typeof import('../adapters/tts/registry').ttsRegistry> {
	registryPromise ??= import('../adapters/tts/registry').then((module) => module.ttsRegistry);
	return registryPromise;
}

function post(message: Response, transfer: Transferable[] = []): void {
	self.postMessage(message, { transfer });
}

function cancelIdleRelease(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
}

function scheduleIdleRelease(): void {
	cancelIdleRelease();
	idleTimer = setTimeout(() => {
		queue = queue.then(async () => {
			const ttsRegistry = await getRegistry();
			await ttsRegistry.disposeAll();
			post({ id: 0, type: 'released' });
		});
	}, IDLE_RELEASE_MS);
}

async function handle(request: Request): Promise<void> {
	cancelIdleRelease();
	try {
		const ttsRegistry = await getRegistry();
		if (request.type === 'release') {
			await ttsRegistry.disposeAll();
			post({ id: request.id, type: 'released' });
			return;
		}

		await ttsRegistry.disposeOthers(request.voice);
		const adapter = ttsRegistry.getAdapter(request.voice);
		if (!adapter) throw new Error(`Unknown local voice "${request.voice}".`);
		if (adapter.status !== 'ready') {
			await adapter.load((progress) => post({ id: request.id, type: 'progress', progress }));
		}

		const result = await adapter.synthesize(request.text);
		post(
			{
				id: request.id,
				type: 'speech',
				audio: result.audio,
				samplingRate: result.samplingRate,
				modelName: result.modelName,
				durationSec: result.durationSec,
				peak: result.peak
			},
			[result.audio.buffer]
		);
		scheduleIdleRelease();
	} catch (error) {
		post({
			id: request.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
}

self.onmessage = (event: MessageEvent<Request>) => {
	queue = queue.then(() => handle(event.data));
};
