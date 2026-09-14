import { OpenAITtsAdapter } from './OpenAITtsAdapter';
import { WorkerPiperAdapter } from './WorkerPiperAdapter';
import { localVoiceChoices } from './voices';
import { pcmToWavUrl } from './roundTrip';
import { getDatabaseAdapter } from '$lib/adapters/db';
import { base64ToBlob, blobToBase64 } from '$lib/utils/base64';
import type { ModelProgress, TtsChoice } from '../../types';

export interface SynthesizeOptions {
	text: string;
	mode: 'local' | 'cloud';
	/** Local Piper voice id, e.g. `piper-tom-medium`. */
	voice?: string;
	openaiApiKey?: string;
	/** Tie the cached audio to an attempt (optional metadata). */
	attemptId?: string;
	onProgress?: (progress: ModelProgress) => void;
	/** Skip the cache and regenerate. */
	force?: boolean;
}

export interface SpeechResult {
	/** WAV object URL, ready for an `<audio>` element. */
	url: string;
	model: string;
	durationSec: number;
	/** True when served from the stored cache (no model call). */
	cached: boolean;
}

/** Local Piper voices available to the product, ranked by the listening test. */
export function listLocalVoices(): TtsChoice[] {
	return localVoiceChoices();
}

let localPiper: WorkerPiperAdapter | null = null;

function getLocalPiper(): WorkerPiperAdapter {
	localPiper ??= new WorkerPiperAdapter();
	return localPiper;
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
 * Synthesizes French text, caching the WAV by (mode, voice, text).
 *
 * A given phrase/voice is deterministic, so a repeat costs no model call and is
 * available instantly (survives reload, since the cache lives in the database).
 * Changing the voice produces a new key, which is what makes retroactive
 * re-rendering of an attempt work.
 */
export async function synthesizeFrench(options: SynthesizeOptions): Promise<SpeechResult> {
	const voice = options.voice ?? 'piper-tom-medium';
	const cacheKey = `tts:${options.mode}:${voice}:${hashText(options.text)}`;
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

	const generated = await generate(options, voice);

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
	return {
		url: pcmToWavUrl(synthesis.audio, synthesis.samplingRate),
		model: synthesis.modelName,
		durationSec: synthesis.durationSec
	};
}
