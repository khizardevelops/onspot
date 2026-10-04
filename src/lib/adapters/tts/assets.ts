import { JAPANESE_G2P_BYTES, JAPANESE_G2P_TRANSFER_BYTES, type LanguageVoice } from '#lib/languages/index.js';

/**
 * Where each local voice's downloads come from. Shared by the adapters (which
 * fetch them) and the language-data store (which checks whether they are
 * already in the TTS cache), so the two can never disagree. Kept free of the
 * engines themselves so the main thread can import it cheaply.
 */

/** rhasspy Piper voices; a voice's `voicePath` is relative to this. */
export const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

/**
 * piper-plus's OpenJTalk/jpreprocess phonemizer (NAIST-JDIC bundled), from the
 * npm release pinned in package.json and matched by the vendored glue in
 * ./vendor/piper-plus-wasm. jsDelivr refuses files this large; unpkg serves the
 * byte-identical npm file with CORS/CORP headers.
 */
export const JAPANESE_G2P_URL = 'https://unpkg.com/piper-plus@0.7.0/dist/rust-wasm/piper_plus_wasm_bg.wasm';
export const JAPANESE_G2P_SHA256 = 'f94f140761e3b4733a339cab6c1cbe077788c7de8f5a014888082c94856ebca0';

/** The voice's weights URL (the piper-plus registry entry already stores a full URL). */
export function voiceModelUrl(voice: Pick<LanguageVoice, 'engine' | 'voicePath'>): string {
	return voice.engine === 'piper-plus' ? voice.voicePath : `${PIPER_VOICES_BASE}${voice.voicePath}`;
}

/**
 * Every cached download a voice needs before it can speak offline:
 * `bytes` is what it occupies on the device, `transferBytes` what it costs to
 * download (smaller when the host compresses it). The Japanese dictionary is
 * its own entry: it is shared by all Japanese voices, so switching voice does
 * not fetch it again.
 */
export function voiceAssets(
	voice: Pick<LanguageVoice, 'engine' | 'voicePath' | 'downloadBytes'>
): Array<{ url: string; bytes: number; transferBytes: number }> {
	if (voice.engine !== 'piper-plus') {
		return [{ url: voiceModelUrl(voice), bytes: voice.downloadBytes, transferBytes: voice.downloadBytes }];
	}
	const model = Math.max(0, voice.downloadBytes - JAPANESE_G2P_BYTES);
	return [
		{ url: voiceModelUrl(voice), bytes: model, transferBytes: model },
		{ url: JAPANESE_G2P_URL, bytes: JAPANESE_G2P_BYTES, transferBytes: JAPANESE_G2P_TRANSFER_BYTES }
	];
}
