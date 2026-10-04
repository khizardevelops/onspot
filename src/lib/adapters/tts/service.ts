import { OpenAITtsAdapter } from './OpenAITtsAdapter';
import { WorkerPiperAdapter } from './WorkerPiperAdapter';
import { localVoiceChoices } from './voices';
import { pcmToWavUrl } from './roundTrip';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import { base64ToBlob, blobToBase64 } from '#lib/utils/base64.js';
import { getVoice, requireLanguage } from '#lib/languages/index.js';
import { processPcm, tuningSignature } from '#lib/utils/audioEffects.js';
import { appSettings, voiceTuning } from '#lib/stores/settings.js';
import { get } from 'svelte/store';
import type { ModelProgress, TtsChoice } from '../../types';

export interface SynthesizeOptions {
	text: string;
	mode: 'local' | 'cloud';
	/** Target language id; selects the voice set and its audio profile. */
	languageId: string;
	/** Local Piper voice id, e.g. `piper-tom-medium`. */
	voice?: string;
	openaiApiKey?: string;
	/** Tie the cached audio to an attempt (optional metadata). */
	attemptId?: string;
	onProgress?: (progress: ModelProgress) => void;
	/** Skip the cache and regenerate. */
	force?: boolean;
	/**
	 * Return the model output without the voice profile or the learner's
	 * tuning. The Settings preview applies both live, so tuning never needs a
	 * regeneration there.
	 */
	raw?: boolean;
}

export interface SpeechResult {
	/** WAV object URL, ready for an `<audio>` element. */
	url: string;
	model: string;
	durationSec: number;
	/** True when served from the stored cache (no model call). */
	cached: boolean;
}

/** Local Piper voices available for a target language. */
export function listLocalVoices(languageId: string): TtsChoice[] {
	return localVoiceChoices(languageId);
}

let localPiper: WorkerPiperAdapter | null = null;

function getLocalPiper(): WorkerPiperAdapter {
	localPiper ??= new WorkerPiperAdapter();
	return localPiper;
}

/**
 * Downloads and initializes a local voice without synthesizing. Called by the
 * language-data download so a session never starts with a cold voice.
 */
export async function preloadLocalVoice(
	voiceId: string,
	onProgress?: (progress: ModelProgress) => void
): Promise<void> {
	await getLocalPiper().preload(voiceId, onProgress);
}

/** Cancels an in-flight local voice download by tearing the worker down. */
export function cancelLocalVoiceDownload(): void {
	localPiper?.dispose();
	localPiper = null;
}

/** FNV-1a plus length: short, stable, collision-resistant enough for a cache key. */
function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(36)}`;
}

/**
 * Synthesizes the target language's text, caching the WAV by
 * (mode, language, voice, text).
 *
 * A given phrase/voice is deterministic, so a repeat costs no model call and is
 * available instantly (survives reload, since the cache lives in the database).
 * Changing the voice produces a new key, which is what makes retroactive
 * re-rendering of an attempt work.
 */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<SpeechResult> {
	const language = requireLanguage(options.languageId);
	const voice = options.voice || language.defaultVoice;
	// Advanced per-voice adjustments are part of the cache identity: changing a
	// slider must not replay audio rendered with the old EQ.
	const tuning = voiceTuning(get(appSettings), voice);
	const signature = options.raw ? 'raw' : tuningSignature(tuning);
	// Cloud audio is neither a Piper voice nor EQ-processed, so keying it by
	// those would re-buy identical OpenAI audio after every voice/EQ change.
	const cacheKey =
		options.mode === 'cloud'
			? `tts:cloud:${language.id}:openai:${hashText(options.text)}`
			: `tts:${options.mode}:${language.id}:${voice}:${signature}:${hashText(options.text)}`;
	const db = await getDatabaseAdapter();

	if (!options.force) {
		const hit = await db.getAudio(cacheKey);
		if (hit) {
			return {
				url: URL.createObjectURL(base64ToBlob(hit.dataBase64, hit.mime)),
				model: 'cache',
				durationSec: 0,
				cached: true
			};
		}
	}

	const generated = await generate(options, language.id, voice);

	try {
		const blob = await (await fetch(generated.url)).blob();
		await db.putAudio({
			key: cacheKey,
			attemptId: options.attemptId ?? null,
			mime: blob.type || 'audio/wav',
			dataBase64: await blobToBase64(blob),
			createdAt: new Date().toISOString()
		});
	} catch (error) {
		// Caching is an optimisation; never fail synthesis over it.
		console.warn('[tts] could not cache audio', error);
	}

	return { ...generated, cached: false };
}

async function generate(
	options: SynthesizeOptions,
	languageId: string,
	voice: string
): Promise<{ url: string; model: string; durationSec: number }> {
	if (options.mode === 'cloud') {
		if (!options.openaiApiKey) {
			throw new Error('Cloud speech needs an OpenAI API key. Add one in Settings.');
		}
		const adapter = new OpenAITtsAdapter({ apiKey: options.openaiApiKey });
		await adapter.load(options.onProgress);
		const synthesis = await adapter.synthesize(options.text);
		return {
			url: pcmToWavUrl(synthesis.audio, synthesis.samplingRate),
			model: synthesis.modelName,
			durationSec: synthesis.durationSec
		};
	}

	const synthesis = await getLocalPiper().synthesize(voice, options.text, options.onProgress);
	if (synthesis.peak < 0.001) {
		throw new Error('The voice returned silence.');
	}

	// The voice's listening-test correction (EQ / loudness) plus the learner's
	// adjustments in Settings → Advanced are applied to the PCM before playback.
	const profile = getVoice(languageId, voice)?.processing;
	const tuning = voiceTuning(get(appSettings), voice);
	const audio = options.raw
		? synthesis.audio
		: await processPcm(synthesis.audio, synthesis.samplingRate, profile, tuning);

	return {
		url: pcmToWavUrl(audio, synthesis.samplingRate),
		model: synthesis.modelName,
		durationSec: synthesis.durationSec
	};
}
