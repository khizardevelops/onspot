// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A look-ahead peak limiter for whole clips. Bringing a voice to the target
 * loudness (`loudness.ts`) can push its loudest syllables past the ceiling;
 * the limiter turns down just those moments, smoothly, and leaves the rest of
 * the clip as it was.
 *
 * It runs on a clip that is already complete, so it can see each peak coming
 * and lower the gain before it, which is what a live limiter can only do by
 * delaying the sound. Here that costs no playback delay at all.
 */

/** The gain starts going down this long before a peak, so it never jumps. */
const LOOK_AHEAD_SECONDS = 0.005;

/** After a peak the gain comes back with this time constant, slowly enough not to distort or pump. */
const RELEASE_SECONDS = 0.06;

/**
 * The lowest value of `values` in the window starting at each index and
 * `windowLength` long (values past the end count as 1, which never lowers it).
 */
function forwardMinimum(values: Float32Array, windowLength: number): Float32Array {
	const minimum = new Float32Array(values.length);
	// Indices whose values increase from front to back: the front is the window's minimum.
	const queue = new Int32Array(values.length);
	let front = 0;
	let back = 0;

	for (let index = values.length - 1; index >= 0; index--) {
		while (back > front && values[queue[back - 1]] >= values[index]) back--;
		queue[back++] = index;
		if (queue[front] >= index + windowLength) front++;
		minimum[index] = values[queue[front]];
	}
	return minimum;
}

/**
 * Keeps every sample of a clip within ±`ceiling`, lowering the gain only
 * around the peaks that pass it.
 *
 * @param samples A whole clip; not changed.
 * @param sampleRate Its rate in Hz.
 * @param ceiling The highest a sample may reach, 0–1.
 * @returns The limited clip, the same length (the samples themselves when none passes the ceiling).
 */
export function limitPeaks(samples: Float32Array, sampleRate: number, ceiling: number): Float32Array {
	// The gain each sample needs on its own to stay under the ceiling.
	const needed = new Float32Array(samples.length);
	let isOver = false;
	for (let index = 0; index < samples.length; index++) {
		const magnitude = Math.abs(samples[index]);
		needed[index] = magnitude > ceiling ? ceiling / magnitude : 1;
		if (magnitude > ceiling) isOver = true;
	}
	if (!isOver) return samples;

	const lookAhead = Math.max(1, Math.round(LOOK_AHEAD_SECONDS * sampleRate));
	const releaseDecay = Math.exp(-1 / (RELEASE_SECONDS * sampleRate));

	// 1. Hold: each sample already gets the gain of the loudest peak in the look-ahead.
	const held = forwardMinimum(needed, lookAhead + 1);

	// 2. Release: after a peak, the gain comes back gradually (only ever lower, so still safe).
	const released = new Float32Array(samples.length);
	let reduction = 0;
	for (let index = 0; index < samples.length; index++) {
		reduction = Math.max(1 - held[index], reduction * releaseDecay);
		released[index] = 1 - reduction;
	}

	// 3. Attack: the gain is the average over the look-ahead behind each sample, so it ramps
	// down over the look-ahead instead of stepping. Every value averaged already holds this
	// sample's peak, so the average does too.
	const limited = new Float32Array(samples.length);
	let windowSum = 0;
	for (let index = 0; index < samples.length; index++) {
		windowSum += released[index];
		if (index > lookAhead) windowSum -= released[index - lookAhead - 1];
		const gain = windowSum / Math.min(index + 1, lookAhead + 1);
		// Rounding in the running sum must not let a sample through.
		limited[index] = Math.max(-ceiling, Math.min(ceiling, samples[index] * gain));
	}
	return limited;
}
