import type { LanguageDefinition } from '#lib/languages/index.js';
import type { LocalSttEngine } from '../LocalSttEngine';
import { WorkerWhisperAdapter } from './WorkerWhisperAdapter';

/**
 * Whisper through Transformers.js (ONNX Runtime Web, WASM) in a Web Worker.
 * The browser build's engine; it works everywhere but holds ~2 GB of RAM for
 * whisper-small (docs/benchmarks/stt.md).
 */

/** Transformers.js keeps downloaded weights in this Cache API bucket. */
const CACHE_NAME = 'transformers-cache';

let adapter: WorkerWhisperAdapter | null = null;
let adapterLanguage = '';

/** One worker at a time; switching language rebuilds it with that language's decoder. */
function adapterFor(language: LanguageDefinition): WorkerWhisperAdapter {
	if (!adapter || adapterLanguage !== language.id) {
		void adapter?.dispose();
		const model = language.stt.models.transformers;
		adapterLanguage = language.id;
		adapter = new WorkerWhisperAdapter({
			id: `local-${language.id}-${model.repo}`,
			name: `${language.name} — local Whisper (${model.dtype})`,
			modelRepoId: model.repo,
			dtype: model.dtype,
			language: language.stt.decoderLanguage
		});
	}
	return adapter;
}

/** The cached requests that belong to a repo's weights and config. */
async function cachedFiles(repo: string): Promise<Request[]> {
	try {
		const cache = await caches.open(CACHE_NAME);
		const requests = await cache.keys();
		return requests.filter((request) => request.url.includes(repo));
	} catch {
		return [];
	}
}

export const transformersEngine: LocalSttEngine = {
	model(language) {
		const { repo, dtype, bytes } = language.stt.models.transformers;
		return { label: `${repo} (${dtype})`, bytes };
	},

	async missingBytes(language) {
		const { repo, bytes } = language.stt.models.transformers;
		return (await cachedFiles(repo)).length > 0 ? 0 : bytes;
	},

	async prepare(language, onProgress) {
		await adapterFor(language).load(onProgress);
	},

	cancelPrepare() {
		void adapter?.dispose();
		adapter = null;
		adapterLanguage = '';
	},

	async remove(language) {
		this.cancelPrepare();
		const cache = await caches.open(CACHE_NAME);
		const files = await cachedFiles(language.stt.models.transformers.repo);
		await Promise.all(files.map((request) => cache.delete(request)));
	},

	async transcribe(pcm16k, language, onProgress) {
		const worker = adapterFor(language);
		await worker.load(onProgress);
		const result = await worker.transcribe(pcm16k, { language: language.stt.decoderLanguage });
		return result.text;
	}
};
