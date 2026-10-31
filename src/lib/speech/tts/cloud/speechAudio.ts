// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The audio a cloud speech service sends back. It is kept compressed, as it
 * arrives, for playback and storage; it is decoded to PCM only where samples
 * are needed (the adapters' PCM interface, or compressing a WAV for storage).
 */

/** Is this clip uncompressed WAV (the fallback some speech servers answer with)? */
export function isWav(audio: Blob): boolean {
	return /^audio\/(x-)?wav/i.test(audio.type);
}

/**
 * Decodes a clip to mono PCM.
 *
 * @param audio Any format the platform can play (Opus, MP3, WAV).
 * @returns The first channel's samples and their rate.
 */
export async function decodeSpeech(audio: Blob): Promise<{ audio: Float32Array; samplingRate: number }> {
	const context = new AudioContext();
	try {
		const decoded = await context.decodeAudioData(await audio.arrayBuffer());
		return { audio: new Float32Array(decoded.getChannelData(0)), samplingRate: decoded.sampleRate };
	} finally {
		await context.close();
	}
}
