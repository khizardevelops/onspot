import {
	NEUTRAL_TUNING,
	isNeutralTuning,
	type AudioProcessingProfile,
	type VoiceTuning
} from '$lib/languages';

function dbToGain(db: number): number {
	return Math.pow(10, db / 20);
}

/** Fallback when a voice has no approved profile but the learner tunes it. */
function neutralProfile(): AudioProcessingProfile {
	return {
		targetPeak: 0.92,
		lowShelf: { frequency: 200, gainDb: 0 },
		body: { frequency: 500, gainDb: 0, q: 1 },
		presence: { frequency: 1200, gainDb: 0, q: 0.9 },
		highShelf: { frequency: 3200, gainDb: 0 },
		dynamics: null,
		makeupGainDb: 0
	};
}

/**
 * Layers the learner's per-voice adjustments on top of the approved profile.
 * Returns `null` when there is nothing to process, so an untouched voice with
 * no approved profile keeps its raw model output.
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

/**
 * The EQ as Web Audio biquads, low to high. Shared by `processPcm` and the
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

/** A voice's processing graph between a source and the destination. */
export interface ProcessingChain {
	input: AudioNode;
	output: AudioNode;
	/** Applies new learner adjustments to the running graph, without rebuilding it. */
	setTuning(tuning: VoiceTuning): void;
}

/**
 * Builds the voice's studio profile plus the learner's adjustments as Web Audio
 * nodes: 4-band EQ, the approved compressor, makeup gain, peak normalization,
 * the learner's volume and a final limiter so boosts cannot clip.
 *
 * `processPcm` renders it offline for read-backs; the Settings preview runs the
 * same graph live, so what the learner hears while tuning is what gets rendered.
 * When `resolveProfile` says there is nothing to process, the chain passes the
 * raw model output through untouched, exactly like `processPcm`.
 */
export function createProcessingChain(
	context: BaseAudioContext,
	base: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning,
	inputPeak: number
): ProcessingChain {
	const profile = base ?? neutralProfile();
	const bands = tuningBands(profile);
	const approved: Record<TuningBand['key'], number> = {
		bassDb: profile.lowShelf.gainDb,
		bodyDb: profile.body.gainDb,
		presenceDb: profile.presence.gainDb,
		trebleDb: profile.highShelf.gainDb
	};

	const input = context.createGain();
	const output = context.createGain();
	const wet = context.createGain();
	const dry = context.createGain();

	const filters = createEqFilters(context, bands, (band) => approved[band.key] + tuning[band.key]);
	let tail: AudioNode = input;
	for (const filter of filters) {
		tail.connect(filter);
		tail = filter;
	}

	if (profile.dynamics) {
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = profile.dynamics.threshold;
		compressor.knee.value = profile.dynamics.knee;
		compressor.ratio.value = profile.dynamics.ratio;
		compressor.attack.value = profile.dynamics.attack;
		compressor.release.value = profile.dynamics.release;
		tail.connect(compressor);
		tail = compressor;
	}

	const makeup = context.createGain();
	makeup.gain.value = dbToGain(profile.makeupGainDb);
	tail.connect(makeup);

	// Normalize against the input peak. EQ/compression can move the peak a
	// little; the final limiter absorbs any overshoot.
	const normalize = context.createGain();
	normalize.gain.value = inputPeak > 1e-6 ? Math.min(profile.targetPeak / inputPeak, 4) : 1;
	makeup.connect(normalize);

	const volume = context.createGain();
	volume.gain.value = dbToGain(tuning.volumeDb);
	normalize.connect(volume);

	const limiter = context.createDynamicsCompressor();
	limiter.threshold.value = -1;
	limiter.knee.value = 0;
	limiter.ratio.value = 20;
	limiter.attack.value = 0.001;
	limiter.release.value = 0.05;
	volume.connect(limiter);
	limiter.connect(wet);
	wet.connect(output);

	// Untouched voices without an approved profile play raw, as in `processPcm`.
	input.connect(dry);
	dry.connect(output);

	const route = (next: VoiceTuning) => (resolveProfile(base, next) ? 1 : 0);
	wet.gain.value = route(tuning);
	dry.gain.value = 1 - wet.gain.value;

	return {
		input,
		output,
		setTuning(next) {
			const at = context.currentTime;
			filters.forEach((filter, index) => {
				const key = bands[index].key;
				filter.gain.setTargetAtTime(approved[key] + next[key], at, LIVE_RAMP);
			});
			volume.gain.setTargetAtTime(dbToGain(next.volumeDb), at, LIVE_RAMP);
			const processed = route(next);
			wet.gain.setTargetAtTime(processed, at, LIVE_RAMP);
			dry.gain.setTargetAtTime(1 - processed, at, LIVE_RAMP);
		}
	};
}

/** Largest absolute sample, used for peak normalization. */
export function peakOf(audio: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < audio.length; i++) {
		const magnitude = Math.abs(audio[i]);
		if (magnitude > peak) peak = magnitude;
	}
	return peak;
}

/**
 * Renders the voice's processing chain over raw TTS PCM in an
 * `OfflineAudioContext`, so the browser's own DSP does the work. Returns the
 * input untouched when there is nothing to apply or the browser cannot render
 * offline audio (the read-back must still play).
 */
export async function processPcm(
	audio: Float32Array,
	sampleRate: number,
	profile: AudioProcessingProfile | null | undefined,
	tuning: VoiceTuning = NEUTRAL_TUNING
): Promise<Float32Array> {
	if (!resolveProfile(profile, tuning) || audio.length === 0) return audio;
	if (typeof OfflineAudioContext === 'undefined') return audio;

	try {
		const context = new OfflineAudioContext(1, audio.length, sampleRate);
		const buffer = context.createBuffer(1, audio.length, sampleRate);
		buffer.getChannelData(0).set(audio);

		const source = context.createBufferSource();
		source.buffer = buffer;
		const chain = createProcessingChain(context, profile, tuning, peakOf(audio));
		source.connect(chain.input);
		chain.output.connect(context.destination);

		source.start();
		const rendered = await context.startRendering();
		return rendered.getChannelData(0);
	} catch (error) {
		console.warn('[tts] audio profile failed; using raw model output', error);
		return audio;
	}
}
