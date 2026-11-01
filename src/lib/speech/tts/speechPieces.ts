// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AudioProcessingProfile, VoiceTuning } from '#lib/languages/index.js';
import { processPcm } from '#lib/utils/audioEffects.js';
import { OPUS_SAMPLE_RATE } from '../audioFormat';
import type { PcmSink } from './streamingPlayback';

/**
 * Speech made on the device a piece at a time: the sentences of a long text
 * (see `textPieces.ts`), or the parts of an explanation each of its two
 * voices speaks (see `explanationSpeech.ts`). Each piece goes through its
 * voice and that voice's processing, loses the silence the voice puts around
 * it, and is resampled to the clip's rate; the pieces are joined with pauses
 * where the punctuation asks for them, and handed on as they are made, so
 * playback can start after the first.
 */

/** A voice and how its output is processed. */
export interface PieceVoice {
	id: string;
	profile: AudioProcessingProfile | null;
	tuning?: VoiceTuning;
}

/** One piece of a clip and the voice that speaks it. */
export interface SpeechPiece {
	text: string;
	voice: PieceVoice;
}

/** Speaks text with one on-device voice: raw PCM and its sample rate. */
export type SynthesizePcm = (voiceId: string, text: string) => Promise<{ audio: Float32Array; samplingRate: number }>;

/** A piece with no letters (a lone comma or dash between two quotes) is a pause, not speech. */
function isSpeakable(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

/** Pauses between pieces, by the punctuation at the join: within a sentence, at a comma, at a sentence end. */
const PAUSE_MS = { within: 60, comma: 150, sentence: 300 } as const;

const SENTENCE_END = /[.!?…。！？]["»”'」』]?$/;
const CLAUSE_END = /[,;:—–\-、]$/;
/** Punctuation a piece starts with: it belongs to the join before it, not to the voice. */
const LEADING_PUNCTUATION = /^[\s,;:.!?…—–\-、。！？]+/;

/**
 * The pause between a piece and the next. A comma can sit on either side of
 * the join ("You said <wrong>…</wrong>, but…"): without a pause there, short
 * pieces run together.
 */
function pauseBetween(text: string, next: string | undefined): number {
	const opening = next?.match(LEADING_PUNCTUATION)?.[0].trim() ?? '';
	if (SENTENCE_END.test(text) || /[.!?…。！？]/.test(opening)) return PAUSE_MS.sentence;
	if (CLAUSE_END.test(text) || /[,;:—–\-、]/.test(opening)) return PAUSE_MS.comma;
	return PAUSE_MS.within;
}

/** Below this, a sample counts as silence when trimming a piece's edges. */
const SILENCE_THRESHOLD = 0.01;
/** Kept on each side of the speech, so a word's first and last sounds are not cut. */
const EDGE_MARGIN_MS = 15;

/** Cuts the silence a voice puts before and after each piece; the joins add their own pauses. */
function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
	let start = 0;
	while (start < samples.length && Math.abs(samples[start]) < SILENCE_THRESHOLD) start++;
	let end = samples.length;
	while (end > start && Math.abs(samples[end - 1]) < SILENCE_THRESHOLD) end--;

	const margin = Math.round((EDGE_MARGIN_MS / 1000) * sampleRate);
	return samples.subarray(Math.max(0, start - margin), Math.min(samples.length, end + margin));
}

/** Resamples to the clip's rate with the browser's own resampler (an offline audio context). */
async function resample(samples: Float32Array, fromRate: number): Promise<Float32Array> {
	if (fromRate === OPUS_SAMPLE_RATE || samples.length === 0) return samples;

	const length = Math.ceil((samples.length * OPUS_SAMPLE_RATE) / fromRate);
	const context = new OfflineAudioContext(1, length, OPUS_SAMPLE_RATE);
	const buffer = context.createBuffer(1, samples.length, fromRate);
	buffer.getChannelData(0).set(samples);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.start();
	return (await context.startRendering()).getChannelData(0);
}

function silence(ms: number): Float32Array {
	return new Float32Array(Math.round((ms / 1000) * OPUS_SAMPLE_RATE));
}

function concatenate(pieces: Float32Array[]): Float32Array {
	const joined = new Float32Array(pieces.reduce((length, piece) => length + piece.length, 0));
	let offset = 0;
	for (const piece of pieces) {
		joined.set(piece, offset);
		offset += piece.length;
	}
	return joined;
}

/** One piece through its voice and that voice's processing, without its edge silence, at the clip's rate. */
async function speakPiece(text: string, voice: PieceVoice, synthesize: SynthesizePcm): Promise<Float32Array> {
	const raw = await synthesize(voice.id, text);
	const processed = await processPcm(raw.audio, raw.samplingRate, voice.profile, voice.tuning);
	const trimmed = trimSilence(processed, raw.samplingRate);

	return resample(trimmed, raw.samplingRate);
}

/**
 * Speaks pieces in order, each with its voice, and joins them into one clip.
 *
 * @param pieces The clip's text in reading order, each part with the voice that speaks it.
 * @param synthesize Runs one on-device voice.
 * @param sink Receives each piece (and each pause) as soon as it is ready, so playback can start before the end.
 * @returns The whole clip, mono at 48 kHz.
 */
export async function speakPieces(
	pieces: readonly SpeechPiece[],
	synthesize: SynthesizePcm,
	sink?: PcmSink
): Promise<Float32Array> {
	const spoken: Float32Array[] = [];
	const emit = (samples: Float32Array) => {
		spoken.push(samples);
		sink?.push(samples);
	};

	try {
		for (const [index, piece] of pieces.entries()) {
			const text = piece.text.replace(LEADING_PUNCTUATION, '');
			if (isSpeakable(text)) emit(await speakPiece(text, piece.voice, synthesize));

			const nextText = pieces[index + 1]?.text;
			emit(silence(pauseBetween(piece.text, nextText)));
		}
	} finally {
		sink?.end();
	}

	return concatenate(spoken);
}
