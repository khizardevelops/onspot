/// <reference lib="webworker" />
/**
 * whisper.cpp built with ggml's WebGPU backend (tools/whisper-webgpu), for the
 * model lab's WebGPU spike. Lab-only.
 *
 * The Emscripten module lives in ./vendor/whisper-webgpu/ (built locally,
 * gitignored). It must be served through Vite, not static/: static files lack
 * the COOP/COEP headers, so its pthread workers would never start.
 *
 * Inference runs on this worker's thread; wgpu_init_stream and wgpu_full are
 * JSPI exports, so they return Promises. The model is streamed tensor by
 * tensor into the GPU, so the full file is never held in JS or the WASM heap.
 */
import moduleUrl from './vendor/whisper-webgpu/whisper-webgpu.js?url';
import { streamCached } from './modelCache';

type Request =
	| { id: number; type: 'load'; url: string; threads: number; useGpu: boolean }
	| { id: number; type: 'transcribe'; pcm: Float32Array; lang: string };

interface WhisperModule {
	HEAPU8: Uint8Array;
	HEAPF32: Float32Array;
	_malloc(size: number): number;
	_free(ptr: number): void;
	_wgpu_init_stream(useGpu: number): Promise<number>;
	/** Read by the binding's streaming model loader. */
	modelChunks: AsyncIterator<Uint8Array> | null;
	_wgpu_full(pcm: number, samples: number, lang: number, threads: number): Promise<number>;
	_wgpu_text(): number;
	_wgpu_system_info(): number;
	UTF8ToString(ptr: number): string;
	stringToNewUTF8(text: string): number;
}

let module: WhisperModule | null = null;
let threads = 2;
const log: string[] = [];

function post(message: Record<string, unknown>) {
	(self as unknown as Worker).postMessage(message);
}

/** whisper.cpp's own log lines that say which backend it chose. */
function backendLines(): string[] {
	return log.filter((line) => /webgpu|backend|gpu|cpu/i.test(line)).slice(-12);
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;
	try {
		switch (request.type) {
			case 'load': {
				threads = request.threads;
				const model = await streamCached(request.url, (progress, status) =>
					post({ id: request.id, type: 'progress', progress, status })
				);
				post({ id: request.id, type: 'progress', progress: 100, status: 'initialising' });
				if (!module) {
					const { default: factory } = await import(/* @vite-ignore */ moduleUrl);
					const capture = (line: string) => {
						log.push(line);
						if (log.length > 400) log.shift();
					};
					module = (await factory({ print: capture, printErr: capture })) as WhisperModule;
				}
				module.modelChunks = model.chunks;
				const ok = await module._wgpu_init_stream(request.useGpu ? 1 : 0);
				if (!ok) throw new Error(`whisper.cpp could not load the model.\n${log.slice(-8).join('\n')}`);
				post({
					id: request.id,
					type: 'ready',
					bytes: model.bytes,
					systemInfo: module.UTF8ToString(module._wgpu_system_info()),
					backend: backendLines()
				});
				return;
			}
			case 'transcribe': {
				if (!module) throw new Error('No whisper.cpp WebGPU model loaded.');
				const pcmPtr = module._malloc(request.pcm.length * 4);
				module.HEAPF32.set(request.pcm, pcmPtr >> 2);
				const langPtr = module.stringToNewUTF8(request.lang);
				const status = await module._wgpu_full(pcmPtr, request.pcm.length, langPtr, threads);
				module._free(pcmPtr);
				module._free(langPtr);
				if (status !== 0) throw new Error(`whisper_full failed (${status}).\n${log.slice(-8).join('\n')}`);
				post({ id: request.id, type: 'text', text: module.UTF8ToString(module._wgpu_text()).trim() });
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
