/**
 * Minimal 16-bit PCM WAV encoder.
 *
 * Cloud STT endpoints want an audio file, not raw samples, so mono Float32 PCM
 * is wrapped in a WAV container. Kept separate from `utils/audio.ts` (which
 * decodes) so the dependency direction stays one-way.
 */
export function encodeWav(audio: Float32Array, sampleRate: number): Blob {
	const buffer = new ArrayBuffer(44 + audio.length * 2);
	const view = new DataView(buffer);
	const writeString = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + audio.length * 2, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeString(36, 'data');
	view.setUint32(40, audio.length * 2, true);

	let offset = 44;
	for (let i = 0; i < audio.length; i++, offset += 2) {
		const clamped = Math.max(-1, Math.min(1, audio[i]));
		view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}

	return new Blob([view], { type: 'audio/wav' });
}
