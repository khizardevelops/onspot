// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The official prebuilt sherpa-onnx text-to-speech runtime (WebAssembly),
 * loaded once per voice worker. `scripts/sherpa-tts-assets.sh` puts the
 * pinned, verified files in `static/sherpa-onnx/`; nothing in them is edited.
 *
 * Two traits of the prebuilt shape this file:
 * - It is built with a demo model baked into a `.data` package. Handing its
 *   package loader an empty buffer (`getPreloadedPackage`) skips that
 *   download; our model files are written into its file system instead
 *   (`./supertonicModel.ts`).
 * - Its glue is a classic script sharing a global `Module`. Module workers,
 *   which Vite serves in development, have no `importScripts`, so the scripts
 *   are run as classic scripts with an indirect `eval`.
 *
 * The build is single-threaded and never gives memory back to the browser:
 * `free()` releases a model inside the runtime, and ending the worker (the
 * proxy's idle shutdown) releases the runtime itself.
 */

/** The runtime's folder, under the app's base path. */
const RUNTIME_BASE = `${__BASE_PATH__}/sherpa-onnx/`;

/** Emscripten glue and the WebAssembly binary it loads (`sherpa-onnx-wasm-main-tts.wasm`). */
const GLUE_SCRIPT = 'sherpa-onnx-wasm-main-tts.js';

/** sherpa-onnx's JavaScript TTS API (`createOfflineTts`). */
const TTS_API_SCRIPT = 'sherpa-onnx-tts.js';

const RUNTIME_UNAVAILABLE_MESSAGE =
	'The on-device voice runtime could not be loaded. Reload onspot and try again.';

/** The part of the Emscripten module this app uses: its in-memory file system. */
export interface SherpaFileSystem {
	FS_createPath(parent: string, path: string, canRead: boolean, canWrite: boolean): void;
	FS_createDataFile(
		parent: string,
		name: string,
		data: Uint8Array,
		canRead: boolean,
		canWrite: boolean,
		canOwn: boolean
	): void;
	FS_unlink(path: string): void;
}

/** One generation's options; `extra.lang` picks Supertonic's language. */
export interface SherpaGenerationConfig {
	sid: number;
	speed: number;
	numSteps: number;
	extra?: Record<string, string | number>;
}

/** A loaded model (sherpa-onnx's `OfflineTts`). */
export interface SherpaOfflineTts {
	readonly sampleRate: number;
	readonly numSpeakers: number;
	/** Empty samples mean the generation failed (the reason went to the console). */
	generateWithConfig(text: string, config: SherpaGenerationConfig): { samples: Float32Array; sampleRate: number };
	free(): void;
}

/** sherpa-onnx's model config, as its JavaScript API takes it (short aliases). */
export interface SherpaOfflineTtsConfig {
	model: Record<string, unknown> & { numThreads: number; debug: number; provider: 'cpu' };
	maxNumSentences?: number;
}

export interface SherpaRuntime {
	fileSystem: SherpaFileSystem;
	createOfflineTts(config: SherpaOfflineTtsConfig): SherpaOfflineTts;
}

/** What the prebuilt scripts leave in the worker's global scope. */
interface RuntimeGlobals {
	Module?: SherpaFileSystem & RuntimeMemory & Record<string, unknown>;
	createOfflineTts?: (module: unknown, config: SherpaOfflineTtsConfig) => SherpaOfflineTts;
}

/** The runtime's memory views, used to read a C++ exception's type. */
interface RuntimeMemory {
	HEAPU32: Uint32Array;
	UTF8ToString(pointer: number): string;
}

let runtimePromise: Promise<SherpaRuntime> | null = null;

/** The started runtime's memory, once `startRuntime` has run. */
let runtimeMemory: RuntimeMemory | null = null;

/**
 * Where the glue keeps a thrown exception's C++ type: its `ExceptionInfo`
 * header starts 24 bytes before the thrown pointer and holds the
 * `std::type_info*` at offset 4; a `type_info` holds its mangled name pointer
 * at offset 4 (Emscripten's JavaScript exception handling, which this build uses).
 */
const EXCEPTION_HEADER_BYTES = 24;
const HEADER_TYPE_OFFSET = 4;
const TYPE_INFO_NAME_OFFSET = 4;

/** The mangled C++ type of a thrown exception pointer, or null when it cannot be read. */
function cppExceptionType(pointer: number): string | null {
	if (!runtimeMemory) return null;
	try {
		const typeInfo = runtimeMemory.HEAPU32[(pointer - EXCEPTION_HEADER_BYTES + HEADER_TYPE_OFFSET) >> 2];
		const namePointer = runtimeMemory.HEAPU32[(typeInfo + TYPE_INFO_NAME_OFFSET) >> 2];
		return runtimeMemory.UTF8ToString(namePointer) || null;
	} catch {
		return null;
	}
}

/**
 * A C++ exception that escapes the runtime arrives as a bare number (a pointer
 * into its memory), which says nothing to a learner. Turns it into an Error
 * they can act on and logs the C++ type (e.g. `St9bad_alloc`,
 * `N3Ort9ExceptionE`) for whoever investigates. Other errors pass through.
 *
 * @param error What the runtime threw.
 * @param action What it was doing, e.g. "loading" or "speaking".
 * @returns An Error to throw instead.
 */
export function readableRuntimeError(error: unknown, action: string): Error {
	if (typeof error !== 'number') return error instanceof Error ? error : new Error(String(error));

	const type = cppExceptionType(error);
	console.error(`[sherpa-onnx] C++ exception while ${action}: ${type ?? 'unknown type'} (pointer ${error})`);

	const outOfMemory = type?.includes('bad_alloc') ?? false;
	const message = outOfMemory
		? 'This device ran out of memory for the Supertonic voices. Close other tabs or apps and try again.'
		: `The Supertonic voice failed while ${action}. Try again; if it keeps failing, choose another voice.`;
	return new Error(message, { cause: error });
}

/**
 * Starts the runtime, or returns the one already started in this worker.
 * A failure is not kept, so the next call tries again.
 *
 * @returns The runtime's file system and its `createOfflineTts`.
 */
export function loadSherpaRuntime(): Promise<SherpaRuntime> {
	runtimePromise ??= startRuntime().catch((error: unknown) => {
		runtimePromise = null;
		throw error;
	});
	return runtimePromise;
}

async function startRuntime(): Promise<SherpaRuntime> {
	const scope = globalThis as unknown as RuntimeGlobals;
	const initialized = Promise.withResolvers<void>();

	// Read by the glue when it runs; see the file comment for each hook.
	scope.Module = {
		locateFile: (path: string) => RUNTIME_BASE + path,
		getPreloadedPackage: () => new ArrayBuffer(0),
		onRuntimeInitialized: () => initialized.resolve(),
		onAbort: (reason: unknown) => initialized.reject(new Error(`${RUNTIME_UNAVAILABLE_MESSAGE} (${String(reason)})`)),
		print: () => {},
		printErr: (line: string) => console.warn('[sherpa-onnx]', line)
	} as unknown as RuntimeGlobals['Module'];

	await runClassicScript(RUNTIME_BASE + GLUE_SCRIPT);
	await runClassicScript(RUNTIME_BASE + TTS_API_SCRIPT);
	await initialized.promise;

	const module = scope.Module;
	const createOfflineTts = scope.createOfflineTts;
	if (!module || !createOfflineTts) throw new Error(RUNTIME_UNAVAILABLE_MESSAGE);
	runtimeMemory = module;

	return {
		fileSystem: module,
		createOfflineTts: (config) => createOfflineTts(module, config)
	};
}

/**
 * Runs a classic script in this worker's global scope, as `importScripts`
 * would. An indirect `eval` runs it as global code, so its `var` and
 * function declarations become globals the next script can see.
 *
 * It must stay a member call: the production bundler inlines
 * `const evaluate = eval; evaluate(source)` into a direct `eval`, which runs
 * the script in this function's strict scope, where the glue never sees our
 * `Module` hooks.
 */
async function runClassicScript(url: string): Promise<void> {
	const response = await fetch(url);
	const contentType = response.headers.get('content-type') ?? '';

	// A host's SPA fallback answers a missing file with the app's HTML page.
	const isScript = response.ok && contentType.includes('javascript');
	if (!isScript) {
		console.error(`[sherpa-onnx] ${url} is missing (HTTP ${response.status}, ${contentType || 'no type'}); run scripts/sherpa-tts-assets.sh`);
		throw new Error(RUNTIME_UNAVAILABLE_MESSAGE);
	}

	const source = await response.text();
	globalThis.eval(`${source}\n//# sourceURL=${url}`);
}
