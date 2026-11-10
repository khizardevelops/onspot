// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseExplanation } from '#lib/adapters/llm/explanation.js';
import { speakPieces, type PieceVoice, type SynthesizePcm } from './speechPieces';
import type { PcmSink } from './streamingPlayback';

/**
 * An explanation read on the device by two voices. It is written in the
 * language of instruction (English) with the target language's words and
 * phrases in it, and an on-device voice speaks one language: the English goes
 * to the explanation voice the learner chose, and every target-language span
 * (the tagged `wrong` / `right` / `key` / `ask` parts) and the follow-up
 * question to their target voice. The pieces are spoken and joined like any
 * clip made in pieces (see `speechPieces.ts`).
 */

/** Which of the two voices speaks a piece. */
export type ExplanationVoiceRole = 'explanation' | 'target';

/** One piece of an explanation, spoken by one voice. */
export interface ExplanationSegment {
	role: ExplanationVoiceRole;
	text: string;
}

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

/**
 * The two voices of an explanation, each with its own processing. Every piece
 * is brought to the same loudness, so the two voices match in level whatever
 * each one's own is.
 */
export interface ExplanationVoices {
	/** The target-language voice, with its profile and the learner's tuning. */
	target: PieceVoice;
	/** The voice for the language of instruction, with its profile. */
	explanation: PieceVoice;
}

/**
 * Speaks an explanation's segments in order, each with its voice, and joins them.
 *
 * @param segments From `explanationSegments`.
 * @param voices The target voice and the explanation voice.
 * @param synthesize Runs one on-device voice.
 * @param sink Receives each piece as soon as it is ready, so playback can start before the end.
 * @returns The whole clip, mono at 48 kHz.
 */
export function speakExplanation(
	segments: readonly ExplanationSegment[],
	voices: ExplanationVoices,
	synthesize: SynthesizePcm,
	sink?: PcmSink
): Promise<Float32Array> {
	const pieces = segments.map((segment) => ({
		text: segment.text,
		voice: segment.role === 'target' ? voices.target : voices.explanation
	}));

	return speakPieces(pieces, synthesize, sink);
}
