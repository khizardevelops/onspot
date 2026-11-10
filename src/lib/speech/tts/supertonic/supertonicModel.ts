// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one Supertonic 3 model in this worker, shared by every Supertonic voice.
 *
 * Supertonic takes the language and the voice style with each request, so the
 * target-language voice and the explanation voice can both be Supertonic and
 * still cost one model: 262 MB of worker memory for the pair, measured in
 * Chromium (docs/benchmarks/tts.md). Voices hold the model while loaded; when
 * the last one is disposed, the model is freed.
 */
import {
	SUPERTONIC_MODEL_BYTES,
	SUPERTONIC_MODEL_FILES,
	type SupertonicFileRole,
	type SupertonicModelFile
} from '#lib/languages/voices.js';
import { cachedFetch, forgetCached, sha256Hex } from '../local/cachedFetch';
import { loadSherpaRuntime, readableRuntimeError, type SherpaOfflineTts } from './sherpaRuntime';

/** Folder in the runtime's in-memory file system the model files are written to while it loads. */
const MODEL_DIRECTORY = 'supertonic';

/** Reports the model download: bytes so far and in total. */
export type ModelDownloadProgress = (loadedBytes: number, totalBytes: number) => void;

let modelPromise: Promise<SherpaOfflineTts> | null = null;
let holders = 0;

/**
 * Takes a hold on the shared model, downloading and loading it on first use.
 * Every call must be matched by `releaseSupertonicModel`.
 *
 * @param onProgress Reports the download, when this call is the one that loads the model.
 * @returns The loaded model.
 */
export async function holdSupertonicModel(onProgress?: ModelDownloadProgress): Promise<SherpaOfflineTts> {
	holders += 1;
	try {
		modelPromise ??= loadModel(onProgress).catch((error: unknown) => {
			modelPromise = null;
			throw error;
		});
		return await modelPromise;
	} catch (error) {
		holders -= 1;
		throw error;
	}
}

/** Lets go of a hold; the last one frees the model. */
export async function releaseSupertonicModel(): Promise<void> {
	holders = Math.max(0, holders - 1);
	if (holders > 0 || !modelPromise) return;

	const loading = modelPromise;
	modelPromise = null;
	const model = await loading.catch(() => null);
	model?.free();
}

async function loadModel(onProgress?: ModelDownloadProgress): Promise<SherpaOfflineTts> {
	const runtime = await loadSherpaRuntime();
	const files = await downloadModelFiles(onProgress);

	const directory = `/${MODEL_DIRECTORY}`;
	runtime.fileSystem.FS_createPath('/', MODEL_DIRECTORY, true, true);
	for (const file of files) {
		// canOwn: the file system keeps this buffer instead of copying it.
		runtime.fileSystem.FS_createDataFile(directory, file.name, new Uint8Array(file.bytes), true, false, true);
	}

	try {
		const pathOf = (role: SupertonicFileRole) => `${directory}/${files.find((file) => file.role === role)!.name}`;
		return runtime.createOfflineTts({
			model: {
				supertonic: {
					durationPredictor: pathOf('durationPredictor'),
					textEncoder: pathOf('textEncoder'),
					vectorEstimator: pathOf('vectorEstimator'),
					vocoder: pathOf('vocoder'),
					ttsJson: pathOf('ttsJson'),
					unicodeIndexer: pathOf('unicodeIndexer'),
					voiceStyle: pathOf('voiceStyle')
				},
				// The prebuilt runtime is single-threaded (the web build is not cross-origin isolated either).
				numThreads: 1,
				debug: 0,
				provider: 'cpu'
			}
		});
	} catch (error) {
		throw readableRuntimeError(error, 'loading');
	} finally {
		// The model now lives in the runtime's own memory; the file copies are no longer needed.
		for (const file of files) runtime.fileSystem.FS_unlink(`${directory}/${file.name}`);
	}
}

/** Fetches every model file through the TTS cache, one after another, reporting the combined progress. */
async function downloadModelFiles(
	onProgress?: ModelDownloadProgress
): Promise<Array<{ role: SupertonicFileRole; name: string; bytes: ArrayBuffer }>> {
	const downloaded: Array<{ role: SupertonicFileRole; name: string; bytes: ArrayBuffer }> = [];
	let finishedBytes = 0;

	for (const file of SUPERTONIC_MODEL_FILES) {
		const bytes = await fetchVerified(file, (loadedBytes) => onProgress?.(finishedBytes + loadedBytes, SUPERTONIC_MODEL_BYTES));
		downloaded.push({ role: file.role, name: file.name, bytes });
		finishedBytes += file.bytes;
		onProgress?.(finishedBytes, SUPERTONIC_MODEL_BYTES);
	}

	return downloaded;
}

/** Downloads of a file that may fail their checksum before the load gives up. */
const DOWNLOAD_ATTEMPTS = 2;

/**
 * Fetches a model file through the TTS cache and checks its SHA-256. A copy
 * that fails (an interrupted download kept in the cache) is removed and
 * downloaded once more, so a damaged cache heals itself.
 */
async function fetchVerified(file: SupertonicModelFile, onProgress: (loadedBytes: number) => void): Promise<ArrayBuffer> {
	for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
		const bytes = await cachedFetch(file.url, (loadedBytes) => onProgress(loadedBytes));
		if ((await sha256Hex(bytes)) === file.sha256) return bytes;

		console.warn(`[supertonic] ${file.name} failed its checksum (attempt ${attempt}); downloading it again`);
		await forgetCached(file.url);
	}
	throw new Error('The Supertonic voice download was damaged. Check your connection and try the download again.');
}
