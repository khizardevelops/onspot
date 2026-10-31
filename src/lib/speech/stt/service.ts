// SPDX-License-Identifier: AGPL-3.0-or-later

import { requireLanguage } from '#lib/languages/index.js';
import type { ModelProgress } from '#lib/types.js';
import { GroqWhisperAdapter } from './cloud/GroqWhisperAdapter';
import { localSttEngine, removeSupersededStt } from './localEngine';
import type { SttModelInfo } from './LocalSttEngine';

/**
 * Speech-to-text for the rest of the app. Local transcription goes to this
 * build's on-device engine (`localEngine.ts`); cloud transcription to Groq,
 * when the user opted in with their own key.
 */

export interface TranscribeOptions {
	audio16kMono: Float32Array;
	/** The take as recorded (compressed); cloud transcription uploads it rather than the much larger PCM. */
	recording?: Blob;
	mode: 'local' | 'cloud';
	/** Target language id; selects the model and the decoder language. */
	languageId: string;
	groqApiKey?: string;
	onProgress?: (progress: ModelProgress) => void;
}

export async function transcribeSpeech(options: TranscribeOptions): Promise<string> {
	const language = requireLanguage(options.languageId);
	if (options.mode === 'local') {
		return localSttEngine().transcribe(options.audio16kMono, language, options.onProgress);
	}

	if (!options.groqApiKey) {
		throw new Error('Cloud speech-to-text needs a Groq API key. Add one in Settings.');
	}
	const adapter = cloudAdapter(options.groqApiKey);
	await adapter.load(options.onProgress);
	const result = await adapter.transcribe(options.audio16kMono, {
		language: language.stt.code,
		encodedAudio: options.recording
	});
	return result.text;
}

/** The on-device model for a language: name and full download size. */
export function localSttModel(languageId: string): SttModelInfo {
	return localSttEngine().model(requireLanguage(languageId));
}

/** Bytes of the on-device model still to download; 0 when it is installed. */
export function missingLocalSttBytes(languageId: string): Promise<number> {
	return localSttEngine().missingBytes(requireLanguage(languageId));
}

/** Downloads (if needed) and loads the on-device model. */
export async function prepareLocalStt(
	languageId: string,
	onProgress?: (progress: ModelProgress) => void
): Promise<void> {
	const language = requireLanguage(languageId);
	await localSttEngine().prepare(language, onProgress);
	await removeSupersededStt(language);
}

export function cancelLocalSttPrepare(): void {
	localSttEngine().cancelPrepare();
}

const cloudAdapters = new Map<string, GroqWhisperAdapter>();

function cloudAdapter(apiKey: string): GroqWhisperAdapter {
	let adapter = cloudAdapters.get(apiKey);
	if (!adapter) {
		adapter = new GroqWhisperAdapter({ apiKey });
		cloudAdapters.set(apiKey, adapter);
	}
	return adapter;
}
