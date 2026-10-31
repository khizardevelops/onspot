// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AudioProcessingProfile, VoiceTuning } from '#lib/languages/index.js';
import { parseExplanation } from '#lib/adapters/llm/explanation.js';
import { processPcm } from '#lib/utils/audioEffects.js';
import { OPUS_SAMPLE_RATE } from '../audioFormat';
import type { PcmSink } from './streamingPlayback';

/**
 * An explanation read on the device by two voices. It is written in the
 * language of instruction (English) with the target language's words and
 * phrases in it, and an on-device voice speaks one language: the English goes
 * to the explanation voice the learner chose, and every target-language span
 * (the tagged `wrong` / `right` / `key` / `ask` parts) and the follow-up
 * question to their target voice. The pieces are joined into one clip, with
 * pauses where the punctuation asks for them.
 */

/** Which of the two voices speaks a piece. */
export type ExplanationVoiceRole = 'explanation' | 'target';

/** One piece of an explanation, spoken by one voice. */
export interface ExplanationSegment {
	role: ExplanationVoiceRole;
	text: string;
}

/** A voice and how its output is processed. */
export interface SegmentVoice {
	id: string;
	profile: AudioProcessingProfile | null;
	tuning?: VoiceTuning;
}

/** Speaks text with one on-device voice: raw PCM and its sample rate. */
export type SynthesizePcm = (voiceId: string, text: string) => Promise<{ audio: Float32Array; samplingRate: number }>;

/** The explanation's pieces, in reading order, with neighbours for the same voice merged. */
export function explanationSegments(markup: string, question: string): ExplanationSegment[] {
	const segments: ExplanationSegment[] = [];
	const add = (role: ExplanationVoiceRole, text: string) => {
		const last = segments.at(-1);
		if (last?.role === role) last.text += text;
		else segments.push({ role, text });
	};

	for (const part of parseExplanation(markup)) add(part.highlight ? 'target' : 'explanation', part.text);
	if (question.trim()) add('target', ` ${question.trim()}`);

	return segments.map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ').trim() })).filter((segment) => segment.text);
}

/** A piece with no letters (a lone comma or dash between two quotes) is a pause, not speech. */
function isSpeakable(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

/** Pauses between pieces, by the punctuation at the join: within a sentence, at a comma, at a sentence end. */
const PAUSE_MS = { within: 60, comma: 150, sentence: 300 } as const;

const SENTENCE_END = /[.!?…]["»”']?$/;
const CLAUSE_END = /[,;:—–-]$/;
/** Punctuation a piece starts with: it belongs to the join before it, not to the voice. */
const LEADING_PUNCTUATION = /^[\s,;:.!?…—–-]+/;

/**
 * The pause between a piece and the next. A comma can sit on either side of
 * the join ("You said <wrong>…</wrong>, but…"): without a pause there, short
 * pieces run together.
 */
function pauseBetween(text: string, next: string | undefined): number {
	const opening = next?.match(LEADING_PUNCTUATION)?.[0].trim() ?? '';
	if (SENTENCE_END.test(text) || /[.!?…]/.test(opening)) return PAUSE_MS.sentence;
	if (CLAUSE_END.test(text) || /[,;:—–-]/.test(opening)) return PAUSE_MS.comma;
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

/**
 * The explanation voice runs through the target voice's loudness chain
 * (compression, makeup gain, peak target) without its EQ, which was tuned to
 * that voice's timbre: both voices then sit at the same level in one clip.
 */
function loudnessOnly(profile: AudioProcessingProfile | null): AudioProcessingProfile | null {
	if (!profile) return null;
	return {
		...profile,
		lowShelf: { ...profile.lowShelf, gainDb: 0 },
		body: { ...profile.body, gainDb: 0 },
		presence: { ...profile.presence, gainDb: 0 },
		highShelf: { ...profile.highShelf, gainDb: 0 }
	};
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
 * Speaks an explanation's pieces in order, each with its voice, and joins them.
 *
 * @param segments From `explanationSegments`.
 * @param voices The target voice (with its profile and the learner's tuning) and the explanation voice.
 * @param synthesize Runs one on-device voice.
 * @param sink Receives each piece as soon as it is ready, so playback can start before the end.
 * @returns The whole clip, mono at 48 kHz.
 */
export async function speakExplanation(
	segments: readonly ExplanationSegment[],
	voices: { target: SegmentVoice; explanation: SegmentVoice },
	synthesize: SynthesizePcm,
	sink?: PcmSink
): Promise<Float32Array> {
	const explanationProfile = loudnessOnly(voices.target.profile);
	const pieces: Float32Array[] = [];
	const emit = (piece: Float32Array) => {
		pieces.push(piece);
		sink?.push(piece);
	};

	try {
		for (const [index, segment] of segments.entries()) {
			const spoken = segment.text.replace(LEADING_PUNCTUATION, '');
			if (isSpeakable(spoken)) {
				const voice = voices[segment.role];
				const raw = await synthesize(voice.id, spoken);
				const profile = segment.role === 'target' ? voice.profile : explanationProfile;
				const processed = await processPcm(raw.audio, raw.samplingRate, profile, voice.tuning);
				emit(await resample(trimSilence(processed, raw.samplingRate), raw.samplingRate));
			}
			emit(silence(pauseBetween(segment.text, segments[index + 1]?.text)));
		}
	} finally {
		sink?.end();
	}

	return concatenate(pieces);
}
