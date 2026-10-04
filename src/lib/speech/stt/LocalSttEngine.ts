import type { LanguageDefinition } from '#lib/languages/index.js';
import type { ModelProgress } from '#lib/types.js';

/** What an engine downloads for a language, as shown in Settings. */
export interface SttModelInfo {
	label: string;
	bytes: number;
}

/**
 * An on-device speech-to-text engine.
 *
 * The app runs exactly one, picked per runtime in `localEngine.ts`. Everything
 * else reaches it through `service.ts`, so adding an engine means one new
 * folder that implements this interface plus one line in `localEngine.ts`.
 */
export interface LocalSttEngine {
	model(language: LanguageDefinition): SttModelInfo;

	/** Bytes still to download before `language` can be transcribed; 0 when installed. */
	missingBytes(language: LanguageDefinition): Promise<number>;

	/** Downloads the model if it is missing, then loads it. */
	prepare(language: LanguageDefinition, onProgress?: (progress: ModelProgress) => void): Promise<void>;

	/** Stops an in-flight `prepare` and frees whatever it had loaded. */
	cancelPrepare(): void;

	/** 16 kHz mono PCM in, text out. Prepares the model first if it is not loaded. */
	transcribe(
		pcm16k: Float32Array,
		language: LanguageDefinition,
		onProgress?: (progress: ModelProgress) => void
	): Promise<string>;
}
