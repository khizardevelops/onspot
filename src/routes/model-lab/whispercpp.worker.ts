/// <reference lib="webworker" />
/**
 * whisper.cpp (`@transcribe/shout`) for the model lab, off the UI thread.
 *
 * Lab-only: the product STT engine is Transformers.js in `workers/stt.worker.ts`.
 * The ggml file is cached by `modelCache.ts`.
 */
import shoutUrl from '@transcribe/shout?url';
import { FileTranscriber } from '@transcribe/transcriber';
import { fetchCached } from './modelCache';

type Request =
	| { id: number; type: 'load'; url: string; threads: number }
	| { id: number; type: 'transcribe'; pcm: Float32Array; lang: string }
	| { id: number; type: 'release' };

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

self.onmessage = async (event: MessageEvent<Request>) => {
	const request = event.data;
	try {
		switch (request.type) {
			case 'load': {
				threads = request.threads;
				const blob = await fetchCached(request.url, (progress, status) =>
					post({ id: request.id, type: 'progress', progress, status })
				);
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
