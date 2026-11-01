// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference lib="webworker" />

/**
 * Local Piper host. Loading, phonemization and ONNX inference all happen here,
 * and requests are serialized because one ONNX session must not be run by two
 * word-clicks at once (the main-thread proxy also sends them one at a time,
 * listened ones first). At most two voices stay resident (an explanation
 * alternates the English voice and the target-language voice, and reloading a
 * voice at every switch would take seconds). Memory goes back to the browser
 * when the proxy ends this worker after an idle period.
 */
import type { ITTSAdapter } from '../BaseTtsAdapter';
import type { ModelProgress, TtsSynthesis } from '#lib/types.js';

interface SynthesizeRequest {
	id: number;
	type: 'synthesize';
	voice: string;
	text: string;
}

interface LoadRequest {
	id: number;
	type: 'load';
	voice: string;
}

type Request = SynthesizeRequest | LoadRequest;

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
	| { id: number; type: 'ready' }
	| { id: number; type: 'error'; message: string };

/** Voices kept loaded: the two most recently used. */
const RESIDENT_VOICES = 2;
let recentVoices: string[] = [];

/** Marks a voice as just used; returns the voices to keep loaded. */
function keepResident(voice: string): string[] {
	recentVoices = [voice, ...recentVoices.filter((id) => id !== voice)].slice(0, RESIDENT_VOICES);
	return recentVoices;
}
let queue = Promise.resolve();
let registryPromise: Promise<typeof import('./registry').ttsRegistry> | null = null;

function getRegistry(): Promise<typeof import('./registry').ttsRegistry> {
	registryPromise ??= import('./registry').then((module) => module.ttsRegistry);
	return registryPromise;
}

function post(message: Response, transfer: Transferable[] = []): void {
	self.postMessage(message, { transfer });
}

/**
 * How ONNX Runtime reports a run that needed more WebAssembly memory than it
 * could get: "failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE:
 * std::bad_alloc". Long texts are spoken a sentence at a time (see
 * `textPieces.ts`), so this should not happen; a single enormous word, which
 * cannot be cut, still can.
 */
const OUT_OF_MEMORY = /bad_alloc|out of memory/i;

const TEXT_TOO_LONG_MESSAGE = 'This text is too long for the on-device voice.';

/** Runs the voice; a run that ran out of memory is reported in words a learner can act on. */
async function synthesizeReadably(adapter: ITTSAdapter, text: string): Promise<TtsSynthesis> {
	try {
		return await adapter.synthesize(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!OUT_OF_MEMORY.test(message)) throw error;

		console.warn(`[tts] the voice ran out of memory on ${text.length} characters`, message);
		throw new Error(TEXT_TOO_LONG_MESSAGE, { cause: error });
	}
}

async function handle(request: Request): Promise<void> {
	try {
		const ttsRegistry = await getRegistry();
		await ttsRegistry.disposeOthers(keepResident(request.voice));
		const adapter = ttsRegistry.getAdapter(request.voice);
		if (!adapter) throw new Error(`Unknown local voice "${request.voice}".`);
		if (adapter.status !== 'ready') {
			await adapter.load((progress) => post({ id: request.id, type: 'progress', progress }));
		}

		if (request.type === 'load') {
			post({ id: request.id, type: 'ready' });
			return;
		}

		const result = await synthesizeReadably(adapter, request.text);
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
