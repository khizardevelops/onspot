// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguageVoice, PiperPlusVoice, PiperVoice } from '#lib/languages/index.js';
import {
	JAPANESE_G2P_BYTES,
	JAPANESE_G2P_TRANSFER_BYTES,
	SUPERTONIC_MODEL_FILES
} from '#lib/languages/voices.js';

/**
 * Where each on-device voice's downloads come from. Shared by the adapters
 * (which fetch them) and the language-data store (which checks whether they
 * are already in the TTS cache), so the two can never disagree. Kept free of
 * the engines themselves so the main thread can import it cheaply.
 */

/** rhasspy Piper voices; a voice's `voicePath` is relative to this. */
export const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

/**
 * piper-plus's OpenJTalk/jpreprocess phonemizer (NAIST-JDIC bundled), from the
 * npm release pinned in package.json and matched by the vendored glue in
 * ../piper/vendor/piper-plus-wasm. jsDelivr refuses files this large; unpkg
 * serves the byte-identical npm file with CORS/CORP headers.
 */
export const JAPANESE_G2P_URL = 'https://unpkg.com/piper-plus@0.7.0/dist/rust-wasm/piper_plus_wasm_bg.wasm';
export const JAPANESE_G2P_SHA256 = 'f94f140761e3b4733a339cab6c1cbe077788c7de8f5a014888082c94856ebca0';

/** The weights URL of a Piper or piper-plus voice (the piper-plus registry entry already stores a full URL). */
export function voiceModelUrl(voice: PiperVoice | PiperPlusVoice): string {
	return voice.engine === 'piper-plus' ? voice.voicePath : `${PIPER_VOICES_BASE}${voice.voicePath}`;
}

/** One cached download a voice needs. */
export interface VoiceAsset {
	url: string;
	/** What it occupies on the device. */
	bytes: number;
	/** What it costs to download (smaller when the host compresses it). */
	transferBytes: number;
}

/**
 * Every cached download a voice needs before it can speak offline. Downloads
 * shared by several voices keep the same URL in each list (the Japanese
 * dictionary, the Supertonic model), so a caller can count them once.
 *
 * @param voice The voice.
 * @returns Its downloads.
 */
export function voiceAssets(voice: LanguageVoice): VoiceAsset[] {
	if (voice.engine === 'supertonic') {
		return SUPERTONIC_MODEL_FILES.map((file) => ({ url: file.url, bytes: file.bytes, transferBytes: file.bytes }));
	}

	if (voice.engine === 'piper') {
		return [{ url: voiceModelUrl(voice), bytes: voice.downloadBytes, transferBytes: voice.downloadBytes }];
	}

	const modelBytes = Math.max(0, voice.downloadBytes - JAPANESE_G2P_BYTES);
	return [
		{ url: voiceModelUrl(voice), bytes: modelBytes, transferBytes: modelBytes },
		{ url: JAPANESE_G2P_URL, bytes: JAPANESE_G2P_BYTES, transferBytes: JAPANESE_G2P_TRANSFER_BYTES }
	];
}
