// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AudioProcessingProfile, VoiceTuning } from '#lib/languages/index.js';
import { processPcm } from '#lib/utils/audioEffects.js';
import { CLAUSE_END_MARKS, SENTENCE_END_MARKS, endsSentence } from '#lib/utils/segments.js';
import { OPUS_SAMPLE_RATE } from '../audioFormat';
import type { PcmSink } from './streamingPlayback';

/**
 * Speech made on the device a piece at a time: the sentences of a long text
 * (see `textPieces.ts`), or the parts of an explanation each of its two
 * voices speaks (see `explanationSpeech.ts`). Each piece goes through its
 * voice, loses the silence the voice puts around it, goes through that
 * voice's processing (which brings every piece, in either voice, to the same
 * loudness) and is resampled to the clip's rate; the pieces are joined with pauses
 * where the punctuation asks for them, and handed on as they are made, so
 * playback can start after the first.
 */

/** A voice, how fast it speaks and how its output is processed. */
export interface PieceVoice {
	id: string;
	profile: AudioProcessingProfile | null;
	tuning?: VoiceTuning;
	/** A share of the voice's natural speaking rate; natural when absent. */
	pace?: number;
}

/** One piece of a clip and the voice that speaks it. */
export interface SpeechPiece {
	text: string;
	voice: PieceVoice;
}

/** Speaks text with one on-device voice at a pace (1 = natural): raw PCM and its sample rate. */
export type SynthesizePcm = (
	voiceId: string,
	text: string,
	pace: number
) => Promise<{ audio: Float32Array; samplingRate: number }>;

/** The voice's own speaking rate. */
const NATURAL_PACE = 1;

/** A piece with no letters (a lone comma or dash between two quotes) is a pause, not speech. */
function isSpeakable(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

/** Pauses between pieces, by the punctuation at the join: within a sentence, at a comma, at a sentence end. */
const PAUSE_MS = { within: 60, comma: 150, sentence: 300 } as const;

/** A sentence's or a clause's last mark, in any script (`segments.ts`); a hyphen also ends a clause here. */
const SENTENCE_MARK = new RegExp(`[${SENTENCE_END_MARKS}]`);
const CLAUSE_MARK = new RegExp(`[${CLAUSE_END_MARKS}\\-]`);
const CLAUSE_END = new RegExp(`[${CLAUSE_END_MARKS}\\-]$`);
/** Punctuation a piece starts with: it belongs to the join before it, not to the voice. */
const LEADING_PUNCTUATION = new RegExp(`^[\\s${CLAUSE_END_MARKS}${SENTENCE_END_MARKS}\\-]+`);

/**
 * The pause between a piece and the next. A comma can sit on either side of
 * the join ("You said <wrong>…</wrong>, but…"): without a pause there, short
 * pieces run together.
 */
function pauseBetween(text: string, next: string | undefined): number {
	const opening = next?.match(LEADING_PUNCTUATION)?.[0].trim() ?? '';
	if (endsSentence(text) || SENTENCE_MARK.test(opening)) return PAUSE_MS.sentence;
	if (CLAUSE_END.test(text) || CLAUSE_MARK.test(opening)) return PAUSE_MS.comma;
	return PAUSE_MS.within;
}

/** Loudness is measured over windows this long when finding a piece's speech. */
const LOUDNESS_WINDOW_MS = 5;

/**
 * A piece's speech runs from the first to the last window at least this share
 * of its loudest window's level (−40 dB). Relative, not absolute: a fixed
 * sample threshold of 0.01 cut the soft start and end of the first and last
 * word (up to 180 ms of a quiet Supertonic voice, measured 2026-11-08), which
 * made those words sound wrong. The voices' padding is far below this level.
 */
const SPEECH_RELATIVE_LEVEL = 0.01;

/** Kept on each side of the speech found, for breaths and fading consonants. */
const EDGE_MARGIN_MS = 30;

/** The loudness (RMS) of each window of `samples`. */
function loudnessWindows(samples: Float32Array, windowLength: number): Float32Array {
	const windowCount = Math.floor(samples.length / windowLength);
	const levels = new Float32Array(windowCount);
	for (let window = 0; window < windowCount; window++) {
		let energy = 0;
		for (let index = window * windowLength; index < (window + 1) * windowLength; index++) energy += samples[index] ** 2;
		levels[window] = Math.sqrt(energy / windowLength);
	}
	return levels;
}

/** Cuts the silence a voice puts before and after each piece; the joins add their own pauses. */
function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
	const windowLength = Math.max(1, Math.round((LOUDNESS_WINDOW_MS / 1000) * sampleRate));
	const levels = loudnessWindows(samples, windowLength);
	const loudest = levels.reduce((highest, level) => Math.max(highest, level), 0);
	if (loudest === 0) return samples;

	const speechLevel = loudest * SPEECH_RELATIVE_LEVEL;
	const firstWindow = levels.findIndex((level) => level >= speechLevel);
	const lastWindow = levels.findLastIndex((level) => level >= speechLevel);

	const margin = Math.round((EDGE_MARGIN_MS / 1000) * sampleRate);
	const start = Math.max(0, firstWindow * windowLength - margin);
	const end = Math.min(samples.length, (lastWindow + 1) * windowLength + margin);
	return samples.subarray(start, end);
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

/**
 * One piece through its voice, without its edge silence, then that voice's
 * processing, at the clip's rate. The silence goes first so a piece of one
 * word is leveled as speech, not as speech and padding.
 */
async function speakPiece(text: string, voice: PieceVoice, synthesize: SynthesizePcm): Promise<Float32Array> {
	const raw = await synthesize(voice.id, text, voice.pace ?? NATURAL_PACE);
	const trimmed = trimSilence(raw.audio, raw.samplingRate);
	const processed = await processPcm(trimmed, raw.samplingRate, voice.profile, voice.tuning);

	return resample(processed, raw.samplingRate);
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
