import { currentRuntime } from '#lib/platform/runtime.js';
import type { LanguageDefinition } from '#lib/languages/index.js';
import type { LocalSttEngine } from './LocalSttEngine';
import { nativeWhisperEngine } from './native/nativeEngine';
import { transformersEngine } from './transformers/transformersEngine';

/**
 * The on-device STT engine for this build, and the only place that decides:
 * the desktop and Android apps run whisper.cpp natively; the browser build,
 * which cannot, runs Whisper through Transformers.js.
 */
export function localSttEngine(): LocalSttEngine {
	return currentRuntime() === 'web' ? transformersEngine : nativeWhisperEngine;
}

/**
 * Builds before the native engine kept whisper-small in the webview's cache
 * (299 MB). Once the native model is in place, that copy is dead weight.
 */
export async function removeSupersededStt(language: LanguageDefinition): Promise<void> {
	if (localSttEngine() === transformersEngine) return;
	await transformersEngine.remove(language);
}
