// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	NEUTRAL_TUNING,
	isNeutralTuning,
	type AudioProcessingProfile,
	type VoiceTuning
} from '#lib/languages/index.js';
import { loudnessNormalizingGain } from './loudness';
import { limitPeaks } from './peakLimiter';

/**
 * How an on-device voice's clip is processed before it plays, in order:
 *
 * 1. Tone: the voice's approved EQ and compressor (`AudioProcessingProfile`),
 *    with the learner's adjustments from Settings → Advanced on top.
 * 2. Level: one gain that brings the clip to the same loudness as every
 *    other voice's (`loudness.ts`), then the learner's volume.
 * 3. Peaks: a look-ahead limiter keeps the loudest moments under
 *    `PEAK_CEILING` (`peakLimiter.ts`).
 *
 * Every clip is made whole before it plays, so all of this runs once, when the
 * clip is made (a few milliseconds, against seconds of speaking), and the
 * stored clip replays as it is.
 */

function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

/** Fallback when a voice has no approved profile but the learner tunes it. */
function neutralProfile(): AudioProcessingProfile {
	return {
		lowShelf: { frequency: 200, gainDb: 0 },
		body: { frequency: 500, gainDb: 0, q: 1 },
		presence: { frequency: 1200, gainDb: 0, q: 0.9 },
		highShelf: { frequency: 3200, gainDb: 0 },
		dynamics: null
	};
}

/**
 * Layers the learner's per-voice adjustments on top of the approved profile.
 * Returns `null` when the tone has nothing to change: an untouched voice with
 * no approved profile keeps its own tone (its level is still evened out).
 */
export function resolveProfile(
	base: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning
): AudioProcessingProfile | null {
	if (!base && isNeutralTuning(tuning)) return null;
	const profile = base ?? neutralProfile();
	return {
		...profile,
		lowShelf: { ...profile.lowShelf, gainDb: profile.lowShelf.gainDb + tuning.bassDb },
		body: { ...profile.body, gainDb: profile.body.gainDb + tuning.bodyDb },
		presence: { ...profile.presence, gainDb: profile.presence.gainDb + tuning.presenceDb },
		highShelf: { ...profile.highShelf, gainDb: profile.highShelf.gainDb + tuning.trebleDb }
	};
}

/** One learner-adjustable EQ band, placed where the voice's profile puts it. */
export interface TuningBand {
	key: 'bassDb' | 'bodyDb' | 'presenceDb' | 'trebleDb';
	type: BiquadFilterType;
	frequency: number;
	/** Used by the peaking bands only. */
	q: number;
}

/** The four bands the learner's faders drive, low to high, at the profile's frequencies. */
export function tuningBands(base: AudioProcessingProfile | null | undefined): TuningBand[] {
	const profile = base ?? neutralProfile();
	return [
		{ key: 'bassDb', type: 'lowshelf', frequency: profile.lowShelf.frequency, q: 1 },
		{ key: 'bodyDb', type: 'peaking', frequency: profile.body.frequency, q: profile.body.q },
		{
			key: 'presenceDb',
			type: 'peaking',
			frequency: profile.presence.frequency,
			q: profile.presence.q
		},
		{ key: 'trebleDb', type: 'highshelf', frequency: profile.highShelf.frequency, q: 1 }
	];
}

/** The gain, in dB, of each band the learner's faders drive, as a resolved profile sets it. */
function bandGainsDb(profile: AudioProcessingProfile): Record<TuningBand['key'], number> {
	return {
		bassDb: profile.lowShelf.gainDb,
		bodyDb: profile.body.gainDb,
		presenceDb: profile.presence.gainDb,
		trebleDb: profile.highShelf.gainDb
	};
}

/**
 * The EQ as Web Audio biquads, low to high. Shared by the tone stage and the
 * Settings response curve so the plotted curve is exactly what is applied.
 */
function createEqFilters(
	context: BaseAudioContext,
	bands: TuningBand[],
	gainFor: (band: TuningBand) => number
): BiquadFilterNode[] {
	return bands.map((band) => {
		const filter = context.createBiquadFilter();
		filter.type = band.type;
		filter.frequency.value = band.frequency;
		filter.Q.value = band.q;
		filter.gain.value = gainFor(band);
		return filter;
	});
}

/** The tone stage as Web Audio nodes: the EQ, then the approved compressor when the profile has one. */
interface ToneStage {
	input: AudioNode;
	output: AudioNode;
	filters: BiquadFilterNode[];
	bands: TuningBand[];
}

function createToneStage(context: BaseAudioContext, profile: AudioProcessingProfile): ToneStage {
	const bands = tuningBands(profile);
	const gains = bandGainsDb(profile);
	const filters = createEqFilters(context, bands, (band) => gains[band.key]);
	for (let index = 1; index < filters.length; index++) filters[index - 1].connect(filters[index]);

	let output: AudioNode = filters[filters.length - 1];
	if (profile.dynamics) {
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = profile.dynamics.threshold;
		compressor.knee.value = profile.dynamics.knee;
		compressor.ratio.value = profile.dynamics.ratio;
		compressor.attack.value = profile.dynamics.attack;
		compressor.release.value = profile.dynamics.release;
		output.connect(compressor);
		output = compressor;
	}
	return { input: filters[0], output, filters, bands };
}

let responseContext: OfflineAudioContext | null = null;

/**
 * Combined dB response of the learner's EQ adjustments (not the approved
 * profile underneath, which is the 0 dB reference) at each frequency, from the
 * browser's own `BiquadFilterNode.getFrequencyResponse`.
 */
export function tuningResponseDb(
	bands: TuningBand[],
	tuning: VoiceTuning,
	frequencies: Float32Array<ArrayBuffer>,
	sampleRate = 22050
): Float32Array {
	const total = new Float32Array(frequencies.length);
	if (typeof OfflineAudioContext === 'undefined') return total;
	if (responseContext?.sampleRate !== sampleRate) {
		// Never rendered; it only hosts the filters being measured.
		responseContext = new OfflineAudioContext(1, 1, sampleRate);
	}
	const magnitude = new Float32Array(frequencies.length);
	const phase = new Float32Array(frequencies.length);
	for (const filter of createEqFilters(responseContext, bands, (band) => tuning[band.key])) {
		if (filter.gain.value === 0) continue;
		filter.getFrequencyResponse(frequencies, magnitude, phase);
		for (let i = 0; i < total.length; i++) total[i] += 20 * Math.log10(magnitude[i]);
	}
	return total;
}

/**
 * Compact, stable representation of a tuning for cache keys. Changing any
 * slider invalidates the stored audio for that voice, so a stale EQ is never
 * replayed. The Body band is appended only when set, so audio cached before it
 * existed keeps its key.
 */
export function tuningSignature(tuning: VoiceTuning): string {
	if (isNeutralTuning(tuning)) return 'n';
	const base = `${tuning.volumeDb},${tuning.bassDb},${tuning.presenceDb},${tuning.trebleDb}`;
	return tuning.bodyDb === 0 ? base : `${base},b${tuning.bodyDb}`;
}

/** Smoothing time constant for live parameter changes, in seconds. */
const LIVE_RAMP = 0.015;

/**
 * The highest a processed clip may peak: -1 dBFS, leaving room for Opus,
 * whose decoded peaks run a little above the original.
 */
const PEAK_CEILING = 0.89;

/** A voice's processing graph between a source and the destination, for live playback. */
export interface ProcessingChain {
	input: AudioNode;
	output: AudioNode;
	/** Applies new learner adjustments to the running graph, without rebuilding it. */
	setTuning(tuning: VoiceTuning): void;
	/** Sets the gain that brings the clip to the target loudness (`levelingGain`). */
	setLeveling(gain: number): void;
}

/**
 * The processing as a live Web Audio graph, for the Settings preview, which
 * plays the raw voice and applies the learner's faders as they move: the tone
 * stage, the leveling gain (worked out ahead with `levelingGain`, again after
 * a tone change), the learner's volume and the browser's limiter. The
 * browser's limiter is not a hard ceiling, which is fine for listening; a
 * clip that is kept is processed by `processPcm` instead.
 */
export function createProcessingChain(
	context: BaseAudioContext,
	base: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning,
	leveling: number
): ProcessingChain {
	const tone = createToneStage(context, resolveProfile(base, tuning) ?? neutralProfile());
	const approved = bandGainsDb(base ?? neutralProfile());

	const level = context.createGain();
	level.gain.value = leveling;
	tone.output.connect(level);

	const volume = context.createGain();
	volume.gain.value = dbToGain(tuning.volumeDb);
	level.connect(volume);

	const limiter = context.createDynamicsCompressor();
	limiter.threshold.value = 20 * Math.log10(PEAK_CEILING);
	limiter.knee.value = 0;
	limiter.ratio.value = 20;
	limiter.attack.value = 0.001;
	limiter.release.value = 0.05;
	volume.connect(limiter);

	return {
		input: tone.input,
		output: limiter,
		setTuning(next) {
			const at = context.currentTime;
			tone.filters.forEach((filter, index) => {
				const key = tone.bands[index].key;
				filter.gain.setTargetAtTime(approved[key] + next[key], at, LIVE_RAMP);
			});
			volume.gain.setTargetAtTime(dbToGain(next.volumeDb), at, LIVE_RAMP);
		},
		setLeveling(gain) {
			level.gain.setTargetAtTime(gain, context.currentTime, LIVE_RAMP);
		}
	};
}

/**
 * The clip through the tone stage, rendered by the browser's own DSP in an
 * `OfflineAudioContext`. A clip whose tone has nothing to change, or a browser
 * that cannot render offline, gets the clip back as it was.
 */
async function shapedTone(
	audio: Float32Array,
	sampleRate: number,
	profile: AudioProcessingProfile | null
): Promise<Float32Array> {
	if (!profile || typeof OfflineAudioContext === 'undefined') return audio;

	try {
		const context = new OfflineAudioContext(1, audio.length, sampleRate);
		const buffer = context.createBuffer(1, audio.length, sampleRate);
		buffer.getChannelData(0).set(audio);

		const source = context.createBufferSource();
		source.buffer = buffer;
		const tone = createToneStage(context, profile);
		source.connect(tone.input);
		tone.output.connect(context.destination);

		source.start();
		return (await context.startRendering()).getChannelData(0);
	} catch (error) {
		console.warn('[tts] the EQ could not be applied; leveling the voice as it is', error);
		return audio;
	}
}

/**
 * The gain that brings a clip, its tone shaped as `profile` and `tuning` say,
 * to the target loudness: what the live chain needs (`setLeveling`) to sound
 * like `processPcm`.
 */
export async function levelingGain(
	audio: Float32Array,
	sampleRate: number,
	profile: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning
): Promise<number> {
	const shaped = await shapedTone(audio, sampleRate, resolveProfile(profile, tuning));
	return loudnessNormalizingGain(shaped, sampleRate);
}

/**
 * Processes a voice's raw PCM for playing and keeping: its tone, the same
 * loudness as every other voice, the learner's volume, and peaks under the
 * ceiling. The input is not changed.
 *
 * @param audio Mono model output.
 * @param sampleRate Its rate in Hz.
 * @param profile The voice's approved EQ and compressor, if it has one.
 * @param tuning The learner's adjustments for the voice.
 * @returns The processed clip, the same length.
 */
export async function processPcm(
	audio: Float32Array,
	sampleRate: number,
	profile: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning = NEUTRAL_TUNING
): Promise<Float32Array> {
	if (audio.length === 0) return audio;

	const shaped = await shapedTone(audio, sampleRate, resolveProfile(profile, tuning));
	return leveled(shaped, sampleRate, tuning.volumeDb);
}

/**
 * Brings a clip to the shared loudness plus the learner's volume, with its
 * peaks under the ceiling. Limiting the spikiest voices takes up to a
 * decibel off their loudness (measured on 51 voices); that is made up once
 * and limited again, which leaves every voice within half a decibel.
 */
function leveled(samples: Float32Array, sampleRate: number, volumeDb: number): Float32Array {
	const volume = dbToGain(volumeDb);
	const gain = loudnessNormalizingGain(samples, sampleRate) * volume;
	const limited = limitPeaks(scaled(samples, gain), sampleRate, PEAK_CEILING);

	const shortfall = loudnessNormalizingGain(limited, sampleRate) * volume;
	return shortfall > 1 ? limitPeaks(scaled(limited, shortfall), sampleRate, PEAK_CEILING) : limited;
}

/** The samples times `gain`, as a new clip. */
function scaled(samples: Float32Array, gain: number): Float32Array {
	return samples.map((sample) => sample * gain);
}
