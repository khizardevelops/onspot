// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How loud speech sounds, measured as ITU-R BS.1770-4 integrated loudness
 * (LUFS), and the gain that brings a clip to one loudness for every voice.
 *
 * The voices differ by 14 dB in how loud they speak (51 voices measured
 * 2026-11-08, docs/benchmarks/tts.md), and their peaks say little about it:
 * most Supertonic voices already peak near full scale yet differ by 5 dB in
 * loudness, so scaling by the peak cannot even them out. The measure here
 * follows hearing instead: it weights frequencies as the ear does
 * (K-weighting), averages power over 400 ms blocks, so one loud spike barely
 * moves it, and leaves out the pauses (gating), so a long silence does not
 * make a clip measure quiet.
 */

/** Every clip is brought to this loudness (mono). Chosen from the measurements: see docs/benchmarks/tts.md. */
export const TARGET_LOUDNESS_LUFS = -20;

/** A clip is never raised by more than this, so a nearly silent clip is not blown up into noise. */
const MAX_GAIN_DB = 20;

/** Loudness is averaged over blocks this long, each starting this long after the previous one (BS.1770). */
const BLOCK_SECONDS = 0.4;
const BLOCK_STEP_SECONDS = 0.1;

/** Blocks quieter than this are silence (absolute gate). */
const ABSOLUTE_GATE_LUFS = -70;

/** Blocks this far below the clip's ungated loudness are pauses (relative gate). */
const RELATIVE_GATE_LU = 10;

/** The offset in BS.1770's loudness formula, from mean square power to LUFS. */
const LOUDNESS_OFFSET = -0.691;

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

/**
 * The two K-weighting filters for a sample rate: a high shelf (+4 dB above
 * about 1.7 kHz, the effect of the head) and a high-pass (below about 38 Hz).
 * BS.1770 gives coefficients for 48 kHz only; these are derived from the
 * filters' analogue parameters, so they match the standard's at 48 kHz and
 * hold at the voices' 22.05 and 44.1 kHz.
 */
function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
	const shelfGainDb = 3.99984385397;
	const shelfQ = 0.7071752369554193;
	const shelfFrequency = 1681.9744509555319;
	let k = Math.tan((Math.PI * shelfFrequency) / sampleRate);
	const vh = Math.pow(10, shelfGainDb / 20);
	const vb = Math.pow(vh, 0.499666774155);
	let a0 = 1 + k / shelfQ + k * k;
	const shelf: Biquad = {
		b0: (vh + (vb * k) / shelfQ + k * k) / a0,
		b1: (2 * (k * k - vh)) / a0,
		b2: (vh - (vb * k) / shelfQ + k * k) / a0,
		a1: (2 * (k * k - 1)) / a0,
		a2: (1 - k / shelfQ + k * k) / a0
	};

	const highPassQ = 0.5003270373253953;
	const highPassFrequency = 38.13547087613982;
	k = Math.tan((Math.PI * highPassFrequency) / sampleRate);
	a0 = 1 + k / highPassQ + k * k;
	const highPass: Biquad = {
		b0: 1,
		b1: -2,
		b2: 1,
		a1: (2 * (k * k - 1)) / a0,
		a2: (1 - k / highPassQ + k * k) / a0
	};
	return [shelf, highPass];
}

/** Runs one biquad over the samples (direct form I), in double precision. */
function filtered(input: Float64Array, filter: Biquad): Float64Array {
	const output = new Float64Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let index = 0; index < input.length; index++) {
		const x = input[index];
		const y = filter.b0 * x + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
		output[index] = y;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
	}
	return output;
}

function loudnessOfPower(meanSquare: number): number {
	return LOUDNESS_OFFSET + 10 * Math.log10(meanSquare);
}

/** The mean square power of each block of the K-weighted samples; one block for a clip shorter than a block. */
function blockPowers(weighted: Float64Array, sampleRate: number): number[] {
	// Running sums of the squares: each block's power is then one subtraction.
	const squareSums = new Float64Array(weighted.length + 1);
	for (let index = 0; index < weighted.length; index++) {
		squareSums[index + 1] = squareSums[index] + weighted[index] * weighted[index];
	}

	const blockLength = Math.round(BLOCK_SECONDS * sampleRate);
	if (weighted.length < blockLength) return [squareSums[weighted.length] / weighted.length];

	const step = Math.round(BLOCK_STEP_SECONDS * sampleRate);
	const powers: number[] = [];
	for (let start = 0; start + blockLength <= weighted.length; start += step) {
		powers.push((squareSums[start + blockLength] - squareSums[start]) / blockLength);
	}
	return powers;
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The clip's integrated loudness (ITU-R BS.1770-4, one channel).
 *
 * @param samples Mono audio, full scale ±1.
 * @param sampleRate Its rate in Hz.
 * @returns Loudness in LUFS; `-Infinity` for a clip that is silent throughout.
 */
export function integratedLoudness(samples: Float32Array, sampleRate: number): number {
	if (samples.length === 0) return -Infinity;

	const [shelf, highPass] = kWeightingFilters(sampleRate);
	const weighted = filtered(filtered(Float64Array.from(samples), shelf), highPass);

	const audible = blockPowers(weighted, sampleRate).filter((power) => loudnessOfPower(power) > ABSOLUTE_GATE_LUFS);
	if (audible.length === 0) return -Infinity;

	const relativeGate = loudnessOfPower(mean(audible)) - RELATIVE_GATE_LU;
	const speech = audible.filter((power) => loudnessOfPower(power) > relativeGate);
	return loudnessOfPower(mean(speech));
}

/**
 * The gain that brings a clip to `TARGET_LOUDNESS_LUFS`, as a factor: below 1
 * turns it down, above 1 up (at most `MAX_GAIN_DB`). A silent clip keeps its level.
 */
export function loudnessNormalizingGain(samples: Float32Array, sampleRate: number): number {
	const loudness = integratedLoudness(samples, sampleRate);
	if (!Number.isFinite(loudness)) return 1;

	const gainDb = Math.min(TARGET_LOUDNESS_LUFS - loudness, MAX_GAIN_DB);
	return Math.pow(10, gainDb / 20);
}
