/// <reference lib="webworker" />
/**
 * whisper.cpp (`@transcribe/shout`) for the model lab, off the UI thread.
 *
 * Lab-only: the product STT engine is Transformers.js in `workers/stt.worker.ts`.
 * The ggml file is kept in its own Cache API bucket so a reload does not
 * re-download 190-264 MB.
 */
import shoutUrl from '@transcribe/shout?url';
import { FileTranscriber } from '@transcribe/transcriber';

type Request =
	| { id: number; type: 'load'; url: string; threads: number }
	| { id: number; type: 'transcribe'; pcm: Float32Array; lang: string }
	| { id: number; type: 'release' };

const CACHE_NAME = 'onspot-model-lab';

/** Feeds 16 kHz PCM straight in instead of letting shout decode a file. */
class PcmTranscriber extends FileTranscriber {
	async _loadAudio(audio: unknown): Promise<Float32Array> {
		return audio as Float32Array;
	}
}

let transcriber: PcmTranscriber | null = null;
let threads = 2;

function post(message: Record<string, unknown>) {
	(self as unknown as Worker).postMessage(message);
}

async function fetchCached(id: number, url: string): Promise<Blob> {
	const cache = await caches.open(CACHE_NAME);
	const hit = await cache.match(url);
	if (hit) {
		post({ id, type: 'progress', progress: 100, status: 'cached' });
		return hit.blob();
	}
	const response = await fetch(url);
	if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
	const total = Number(response.headers.get('content-length')) || 0;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	let lastReported = -1;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		const progress = total ? Math.floor((received / total) * 100) : 0;
		if (progress !== lastReported) {
			lastReported = progress;
			post({ id, type: 'progress', progress, status: 'downloading' });
		}
	}
	const blob = new Blob(chunks as BlobPart[]);
	await cache.put(url, new Response(blob));
	return blob;
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;
	try {
		switch (request.type) {
			case 'load': {
				threads = request.threads;
				const blob = await fetchCached(request.id, request.url);
				post({ id: request.id, type: 'progress', progress: 100, status: 'initialising' });
				const { default: createModule } = await import(/* @vite-ignore */ shoutUrl);
				transcriber = new PcmTranscriber({
					createModule,
					model: new File([blob], request.url.split('/').pop() ?? 'model.bin'),
					print: () => {},
					printErr: () => {}
				});
				await transcriber.init();
				post({ id: request.id, type: 'ready', bytes: blob.size });
				return;
			}
			case 'transcribe': {
				if (!transcriber) throw new Error('No whisper.cpp model loaded.');
				const result = await transcriber.transcribe(request.pcm as unknown as string, {
					lang: request.lang,
					threads
				});
				const text = result.transcription.map((segment) => segment.text).join(' ').trim();
				post({ id: request.id, type: 'text', text });
				return;
			}
			case 'release': {
				transcriber?.destroy();
				transcriber = null;
				post({ id: request.id, type: 'released' });
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
