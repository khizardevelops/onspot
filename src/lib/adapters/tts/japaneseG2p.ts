/**
 * Japanese grapheme-to-phoneme for the piper-plus voices.
 *
 * piper-plus compiles an OpenJTalk-compatible front end (jpreprocess, with the
 * NAIST-JDIC dictionary built in) to WASM. It turns kanji/kana into the
 * phoneme IDs the voice expects plus per-phoneme pitch-accent features
 * (A1/A2/A3), which the voice uses for natural intonation.
 *
 * The binary is 60 MB (≈20 MB compressed), so it is not bundled with the app:
 * like the voices it is downloaded on demand, kept in the TTS cache, and run
 * only after its SHA-256 matches the file published to npm as
 * piper-plus@0.7.0. Loaded once per worker and shared by every Japanese voice.
 */
import { cachedFetch } from './cachedFetch';
import { JAPANESE_G2P_BYTES } from '#lib/languages/index.js';
import { JAPANESE_G2P_SHA256 as G2P_SHA256, JAPANESE_G2P_URL as G2P_URL } from './assets';
import initPhonemizer, { WasmPhonemizer } from './vendor/piper-plus-wasm/piper_plus_wasm.js';

const CACHE_NAME = 'onspot-tts-cache';

let ready: Promise<void> | null = null;

async function sha256(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function download(onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
	// The CDN compresses the transfer, so Content-Length (if any) is not the
	// size of the bytes read; report progress against the known file size.
	const bytes = await cachedFetch(G2P_URL, (loaded) => onProgress?.(loaded, JAPANESE_G2P_BYTES));
	if ((await sha256(bytes)) !== G2P_SHA256) {
		// Never run unverified code, and never keep serving a bad cached copy.
		await caches
			.open(CACHE_NAME)
			.then((cache) => cache.delete(G2P_URL))
			.catch(() => undefined);
		throw new Error('The Japanese dictionary download was corrupted or altered. Try the download again.');
	}
	return bytes;
}

/** Downloads (or reads from cache), verifies and initializes the Japanese G2P. */
export function loadJapaneseG2p(onProgress?: (loaded: number, total: number) => void): Promise<void> {
	ready ??= download(onProgress)
		.then((bytes) => initPhonemizer({ module_or_path: bytes }))
		.then(() => undefined)
		.catch((error) => {
			ready = null;
			throw error;
		});
	return ready;
}

/**
 * A phonemizer for one voice config (it needs the voice's `phoneme_id_map`
 * and `language_id_map`). Throws unless the voice's language is supported —
 * piper-plus itself would silently fall back to a G2P that cannot read
 * Japanese.
 */
export function createPhonemizer(configJson: string, language: string): WasmPhonemizer {
	const phonemizer = new WasmPhonemizer(configJson);
	if (!phonemizer.getSupportedLanguages().includes(language)) {
		phonemizer.free();
		throw new Error(`This voice's phonemizer does not support "${language}".`);
	}
	return phonemizer;
}

export type { WasmPhonemizer };
