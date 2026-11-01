// SPDX-License-Identifier: AGPL-3.0-or-later

import { ElevenLabsTtsAdapter, PaidPlanVoiceError } from './cloud/ElevenLabsTtsAdapter';
import { DEFAULT_ELEVENLABS_VOICE_ID } from './cloud/elevenLabsVoices';
import { OpenAITtsAdapter } from './cloud/OpenAITtsAdapter';
import { WorkerPiperAdapter, type SpeechPriority } from './piper/WorkerPiperAdapter';
import { localVoiceChoices } from './voices';
import { encodeWav } from '#lib/utils/wav.js';
import { OPUS_MIME_TYPE, OPUS_SAMPLE_RATE, encodeSpeechOpus } from '../audioFormat';
import { canStreamOpus, canStreamPcm, playOggOpusStream, playPcmStream, type PcmFeed, type PcmSink } from './streamingPlayback';
import { explanationSegments, speakExplanation, type ExplanationVoices } from './explanationSpeech';
import { speakPieces, type PieceVoice, type SynthesizePcm } from './speechPieces';
import { splitForSpeech } from './textPieces';
import { decodeSpeech, isWav } from './cloud/speechAudio';
import { hashText } from '#lib/utils/hash.js';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import { base64ToBlob, blobToBase64 } from '#lib/utils/base64.js';
import { getExplanationVoice, getInstructionLanguage, getVoice, requireLanguage, type VoiceTuning } from '#lib/languages/index.js';
import { processPcm, tuningSignature } from '#lib/utils/audioEffects.js';
import { appSettings, voiceTuning } from '#lib/stores/settings.js';
import { noteLibraryVoiceRefused, replaceUnusableElevenLabsVoice } from '#lib/stores/elevenLabsVoice.js';
import { get } from 'svelte/store';
import type { ModelProgress, TtsChoice } from '#lib/types.js';

export interface SynthesizeOptions {
	text: string;
	mode: 'local' | 'cloud';
	/** Target language id; selects the voice set and its audio profile. */
	languageId: string;
	/** Local Piper voice id, e.g. `piper-tom-medium`. */
	voice?: string;
	/** API read-back: provider, key, base URL, model and voice. */
	apiProvider?: 'elevenlabs' | 'openai';
	apiKey?: string;
	apiBaseUrl?: string;
	apiModel?: string;
	apiVoice?: string;
	/** Tie the cached audio to an attempt (optional metadata). */
	attemptId?: string;
	onProgress?: (progress: ModelProgress) => void;
	/** Skip the cache and regenerate. */
	force?: boolean;
	/**
	 * Return the model output without the voice profile or the learner's
	 * tuning. The Settings preview applies both live, so tuning never needs a
	 * regeneration there.
	 */
	raw?: boolean;
	/**
	 * Start playing while the clip is still arriving, where the provider and
	 * the platform allow it (ElevenLabs, and a long on-device text after its
	 * first sentence; see `streamingPlayback.ts`). The URL then plays only in a
	 * media element, and the whole clip is still stored.
	 */
	stream?: boolean;
	/**
	 * Made ahead of time, so it is ready when tapped (on-device clips are
	 * prepared in the background). A clip the learner is listening to goes
	 * first; this one becomes listened if the learner taps it while it is made.
	 */
	background?: boolean;
	/**
	 * Stops a background clip made in pieces at its next piece (preparing is
	 * no longer wanted: read-back moved to the cloud, say). A clip someone is
	 * listening to finishes regardless. Nothing is stored for a stopped clip.
	 */
	signal?: AbortSignal;
}

export interface SpeechResult {
	/** Object URL of the clip (Opus, or WAV), ready for an `<audio>` element. */
	url: string;
	model: string;
	durationSec: number;
	/** True when served from the stored cache (no model call). */
	cached: boolean;
}

/** Local Piper voices available for a target language. */
export function listLocalVoices(languageId: string): TtsChoice[] {
	return localVoiceChoices(languageId);
}

let localPiper: WorkerPiperAdapter | null = null;

function getLocalPiper(): WorkerPiperAdapter {
	localPiper ??= new WorkerPiperAdapter();
	return localPiper;
}

/**
 * Downloads and initializes a local voice without synthesizing. Called by the
 * language-data download so a session never starts with a cold voice.
 */
export async function preloadLocalVoice(
	voiceId: string,
	onProgress?: (progress: ModelProgress) => void
): Promise<void> {
	await getLocalPiper().preload(voiceId, onProgress);
}

/** Cancels an in-flight local voice download by tearing the worker down. */
export function cancelLocalVoiceDownload(): void {
	localPiper?.dispose();
	localPiper = null;
}

/** A clip as synthesized, before it is stored. */
interface GeneratedSpeech {
	/** Playable audio: compressed as a cloud service sent it, or WAV from a local voice. */
	audio: Blob;
	/** The samples behind a WAV clip, so it can be compressed for storage without decoding it again. */
	pcm?: { samples: Float32Array; sampleRate: number };
	model: string;
	durationSec: number;
}

/** A clip ready to play, and whether it came from storage (no model call). */
interface SpeechClip {
	speech: GeneratedSpeech;
	cached: boolean;
}

/**
 * Clips being looked up, synthesized or stored, by cache key. A second request
 * for the same clip (a tap while the explanation is still on its way) waits
 * for the first instead of paying for it again.
 */
const pendingSpeech = new Map<string, Promise<SpeechClip>>();

/**
 * Synthesizes the target language's text, caching the clip by
 * (mode, language, voice, text).
 *
 * A given phrase/voice is deterministic, so a repeat costs no model call and is
 * available instantly (survives reload, since the cache lives in the database).
 * Changing the voice produces a new key, which is what makes retroactive
 * re-rendering of an attempt work. A new clip plays as soon as it exists; it
 * is stored compactly (Opus) in the background. A text too long for one run
 * of an on-device voice is spoken a sentence at a time, and with `stream`
 * starts playing after the first.
 */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<SpeechResult> {
	try {
		return await synthesizeCached(options);
	} catch (error) {
		const isPaidVoice = error instanceof PaidPlanVoiceError;
		if (!isPaidVoice || options.apiVoice === DEFAULT_ELEVENLABS_VOICE_ID) throw error;

		// The plan cannot use this voice. Remember that, switch to a voice every
		// plan can use, and still answer, so the learner hears the reply instead
		// of an error.
		noteLibraryVoiceRefused(options.apiKey ?? '');
		const usableVoice = replaceUnusableElevenLabsVoice();
		return synthesizeSpeech({ ...options, apiVoice: usableVoice });
	}
}

async function synthesizeCached(options: SynthesizeOptions): Promise<SpeechResult> {
	const language = requireLanguage(options.languageId);
	const voice = options.voice || language.defaultVoice;
	const cacheKey = speechCacheKey(options, language.id, voice);

	// Too long for one run of an on-device voice: spoken a sentence at a time. The
	// Settings preview (`raw`) is one short sentence that needs the voice's own output.
	const canSplit = options.mode === 'local' && !options.raw;
	const pieces = canSplit ? splitForSpeech(options.text, language.writing) : [];
	if (pieces.length > 1) return synthesizeLongText(cacheKey, options, language.id, voice, pieces);

	return cachedClip(cacheKey, options, async () => {
		if (options.stream && canStream(options)) return streamCloudSpeech(options);

		const speech = await generate(options, language.id, voice);
		return { url: URL.createObjectURL(speech.audio), model: speech.model, whole: Promise.resolve(speech) };
	});
}

/** A new clip: playable at once (`url`), and complete, for storage, when `whole` resolves. */
interface ClipProduction {
	url: string;
	model: string;
	whole: Promise<GeneratedSpeech>;
}

/**
 * Serves a clip from storage, or makes it with `produce` and stores it in the
 * background. A request for a clip already on its way joins it instead of
 * paying again; the clip stays pending until it is stored.
 */
async function cachedClip(
	cacheKey: string,
	options: { force?: boolean; attemptId?: string },
	produce: () => Promise<ClipProduction>
): Promise<SpeechResult> {
	// Joined, and registered, before anything is awaited: two requests at once must find each other.
	const pending = options.force ? undefined : pendingSpeech.get(cacheKey);
	if (pending) return playable((await pending).speech, true);

	const clip = Promise.withResolvers<SpeechClip>();
	pendingSpeech.set(cacheKey, clip.promise);
	const release = () => {
		if (pendingSpeech.get(cacheKey) === clip.promise) pendingSpeech.delete(cacheKey);
	};
	// Playback never waits for the database.
	clip.promise.then(
		({ speech, cached }) => (cached ? release() : void storeSpeech(cacheKey, speech, options.attemptId).finally(release)),
		release
	);

	try {
		const stored = options.force ? null : await loadStoredSpeech(cacheKey);
		if (stored) {
			clip.resolve({ speech: stored, cached: true });
			return playable(stored, true);
		}

		const made = await produce();
		made.whole.then((speech) => clip.resolve({ speech, cached: false }), clip.reject);
		return { url: made.url, model: made.model, durationSec: 0, cached: false };
	} catch (error) {
		clip.reject(error);
		throw error;
	}
}

export interface ExplanationSpeechOptions {
	/** The explanation's markup: the language of instruction with tagged target-language spans. */
	markup: string;
	/** The follow-up question it ends with, in the target language. */
	question: string;
	languageId: string;
	/** The target-language voice (the attempt's, or the one chosen in Settings). */
	targetVoice?: string;
	/** The language of instruction it is written in (an `INSTRUCTION_LANGUAGES` id). */
	instructionLanguage: string;
	/** The voice chosen for that language. */
	explanationVoice: string;
	attemptId?: string;
	/** Start playing while the rest is still being spoken, where the platform allows it. */
	stream?: boolean;
	/** Made ahead of time (see `SynthesizeOptions.background`). */
	background?: boolean;
	/** Stops it, while nobody listens (see `SynthesizeOptions.signal`). */
	signal?: AbortSignal;
}

/**
 * Speaks an explanation on the device with two voices: its English with the
 * explanation voice, its target-language words, phrases and follow-up
 * question with the target voice (see `explanationSpeech.ts`). Cached and
 * shared like any other clip; with `stream`, sound starts after the first piece.
 */
export async function synthesizeExplanation(options: ExplanationSpeechOptions): Promise<SpeechResult> {
	const language = requireLanguage(options.languageId);
	const targetVoice = options.targetVoice || language.defaultVoice;
	const explanationVoice = getExplanationVoice(options.instructionLanguage, options.explanationVoice);
	if (!explanationVoice) {
		const instruction = getInstructionLanguage(options.instructionLanguage).name;
		throw new Error(`Choose a ${instruction} voice for explanations in Settings → Text-to-speech.`);
	}

	const target = processedVoice(language.id, targetVoice);
	const textHash = hashText(`${options.markup}\n${options.question}`);
	const cacheKey = `tts:explanation:${language.id}:${targetVoice}:${tuningSignature(target.tuning)}:${explanationVoice.id}:${textHash}`;
	const model = `${targetVoice}+${explanationVoice.id}`;
	const voices: ExplanationVoices = { target, explanationVoiceId: explanationVoice.id };

	return synthesizeInPieces(cacheKey, options, model, (sink, run) => {
		const segments = explanationSegments(options.markup, options.question);
		return speakExplanation(segments, voices, synthesizeLocalPcm(run), sink);
	});
}

/**
 * Speaks a text too long for one run of an on-device voice a piece at a time
 * (see `textPieces.ts`), every piece with the one voice, its profile and the
 * learner's tuning. Cached under the same key as a clip made in one run;
 * with `stream`, sound starts after the first piece.
 */
function synthesizeLongText(
	cacheKey: string,
	options: SynthesizeOptions,
	languageId: string,
	voiceId: string,
	pieces: readonly string[]
): Promise<SpeechResult> {
	const voice = processedVoice(languageId, voiceId);
	const spokenPieces = pieces.map((text) => ({ text, voice }));

	return synthesizeInPieces(cacheKey, options, voiceId, (sink, run) =>
		speakPieces(spokenPieces, synthesizeLocalPcm(run, options.onProgress), sink)
	);
}

/** An on-device voice with the processing it is played with: its listening-test profile and the learner's tuning. */
function processedVoice(languageId: string, voiceId: string): PieceVoice & { tuning: VoiceTuning } {
	return {
		id: voiceId,
		profile: getVoice(languageId, voiceId)?.processing ?? null,
		tuning: voiceTuning(get(appSettings), voiceId)
	};
}

/** How a clip's pieces are run, read again for every piece: at what priority, and whether to stop. */
interface PieceRun {
	priority: () => SpeechPriority;
	/** A background clip nobody listens to, no longer wanted. */
	stopped: () => boolean;
}

/** Ends a clip that was stopped; not an error worth reporting. */
const CLIP_STOPPED = 'StoppedError';

/**
 * Runs an on-device voice on one piece, as the clip's run says;
 * `onProgress` reports a voice that has to be loaded first.
 */
function synthesizeLocalPcm(run: PieceRun, onProgress?: (progress: ModelProgress) => void): SynthesizePcm {
	return (voiceId, text) => {
		if (run.stopped()) return Promise.reject(new DOMException('The clip is no longer wanted.', CLIP_STOPPED));
		return getLocalPiper().synthesize(voiceId, text, onProgress, run.priority);
	};
}

/** True for the error a stopped clip ends with (see `SynthesizeOptions.signal`). */
export function isStoppedClip(error: unknown): boolean {
	return error instanceof DOMException && error.name === CLIP_STOPPED;
}

/** How a clip made in pieces is cached and played. */
interface PieceClipOptions {
	attemptId?: string;
	/** Skip the cache, and any production already under way, and make it again. */
	force?: boolean;
	/** Start playing after the first piece, where the platform allows it. */
	stream?: boolean;
	/** Made ahead of time: a listened clip goes first until the learner taps this one. */
	background?: boolean;
	/** Stops it at its next piece while nobody listens. */
	signal?: AbortSignal;
}

/**
 * Makes a clip on the device piece by piece, cached and shared like any other
 * clip. A streamed request for a clip that is being made (prepared in the
 * background, say) joins it: it plays from the start of what is made, and on
 * live. A new clip plays after its first piece when streamed, or once whole.
 *
 * @param cacheKey The clip's identity in storage.
 * @param options Caching and streaming.
 * @param model What made it, for the result.
 * @param speak Makes the clip as the run says, handing each piece to the sink as it is ready;
 *   resolves to the whole clip at 48 kHz.
 * @returns The clip, ready for the shared player.
 */
async function synthesizeInPieces(
	cacheKey: string,
	options: PieceClipOptions,
	model: string,
	speak: (sink: PcmSink, run: PieceRun) => Promise<Float32Array>
): Promise<SpeechResult> {
	const isStreamed = Boolean(options.stream) && (await canStreamPcm());

	if (isStreamed && !options.force) {
		const live = await liveClip(cacheKey);
		if (live) return { url: live.join(), model, durationSec: 0, cached: false };
	}
	// A learner waiting for the whole clip (no streaming here) still puts it ahead of the clips being prepared.
	if (!options.background) liveClips.get(cacheKey)?.markListened();

	return cachedClip(cacheKey, options, async () => {
		const pieces = new LivePieces();
		startLiveClip(cacheKey, pieces);
		if (!options.background) pieces.markListened();

		const run: PieceRun = {
			priority: () => (pieces.listened ? 'foreground' : 'background'),
			stopped: () => Boolean(options.signal?.aborted) && !pieces.listened
		};
		const whole = speak(pieces, run)
			.then((samples) => wholePcmSpeech(samples, model))
			.finally(() => endLiveClip(cacheKey, pieces));
		whole.catch((error) => {
			if (!isStoppedClip(error)) console.warn('[tts] the clip could not be spoken on the device', error);
		});

		if (isStreamed) return { url: pieces.join(), model, whole };

		const speech = await whole;
		return { url: URL.createObjectURL(speech.audio), model, whole: Promise.resolve(speech) };
	});
}

/** A clip made in pieces, whole: WAV to play, and its samples to store as Opus. */
function wholePcmSpeech(samples: Float32Array, model: string): GeneratedSpeech {
	return {
		audio: encodeWav(samples, OPUS_SAMPLE_RATE),
		pcm: { samples, sampleRate: OPUS_SAMPLE_RATE },
		model,
		durationSec: samples.length / OPUS_SAMPLE_RATE
	};
}

/**
 * The pieces of a clip being made, kept so a player can join at any point:
 * it gets everything made so far, then the rest as it comes. A clip someone
 * is listening to (or waiting for) is made ahead of clips being prepared.
 */
class LivePieces implements PcmSink {
	#pieces: Float32Array[] = [];
	#players = new Set<PcmFeed>();
	#ended = false;
	#listened = false;

	get listened(): boolean {
		return this.#listened;
	}

	markListened(): void {
		this.#listened = true;
	}

	push(samples: Float32Array): void {
		this.#pieces.push(samples);
		for (const player of this.#players) player.push(samples);
	}

	end(): void {
		this.#ended = true;
		for (const player of this.#players) player.end();
		this.#players.clear();
	}

	/** A new player of the clip; returns its URL. */
	join(): string {
		this.#listened = true;
		const player = playPcmStream();
		for (const samples of this.#pieces) player.push(samples);
		if (this.#ended) player.end();
		else this.#players.add(player);
		return player.url;
	}
}

/** Clips being made on the device piece by piece, by cache key. */
const liveClips = new Map<string, LivePieces>();

/** Players waiting for a clip that is pending but not yet being made, by cache key. */
const liveClipWaiters = new Map<string, Array<() => void>>();

function startLiveClip(cacheKey: string, pieces: LivePieces): void {
	liveClips.set(cacheKey, pieces);
	for (const wake of liveClipWaiters.get(cacheKey) ?? []) wake();
	liveClipWaiters.delete(cacheKey);
}

/** Forgets a finished clip, unless a newer production of it (a forced one) took its place. */
function endLiveClip(cacheKey: string, pieces: LivePieces): void {
	if (liveClips.get(cacheKey) === pieces) liveClips.delete(cacheKey);
}

/**
 * The clip's live pieces, if it is being made. A pending clip that has not
 * started yet (it is checking storage first) is waited for: it either starts,
 * and is joined live, or resolves whole (stored), and is played as that.
 */
async function liveClip(cacheKey: string): Promise<LivePieces | undefined> {
	const live = liveClips.get(cacheKey);
	const pending = pendingSpeech.get(cacheKey);
	if (live || !pending) return live;

	let wake = () => {};
	const started = new Promise<void>((resolve) => (wake = resolve));
	liveClipWaiters.set(cacheKey, [...(liveClipWaiters.get(cacheKey) ?? []), wake]);
	await Promise.race([started, pending.catch(() => {})]);

	const waiters = liveClipWaiters.get(cacheKey)?.filter((waiter) => waiter !== wake) ?? [];
	if (waiters.length > 0) liveClipWaiters.set(cacheKey, waiters);
	else liveClipWaiters.delete(cacheKey);
	return liveClips.get(cacheKey);
}

async function loadStoredSpeech(cacheKey: string): Promise<GeneratedSpeech | null> {
	const db = await getDatabaseAdapter();
	const hit = await db.getAudio(cacheKey);
	return hit ? { audio: base64ToBlob(hit.dataBase64, hit.mime), model: 'cache', durationSec: 0 } : null;
}

/** Streaming needs a provider that streams Opus (ElevenLabs) and a platform that plays it as it arrives. */
function canStream(options: SynthesizeOptions): boolean {
	return options.mode === 'cloud' && options.apiProvider === 'elevenlabs' && canStreamOpus();
}

/**
 * Streams a cloud clip: playable at once, while the whole clip is collected
 * for storage. The collecting runs to the end even when the learner stops
 * the sound or plays something else: the credits are spent when the request
 * is sent, so keeping the clip is what makes its replays free.
 */
async function streamCloudSpeech(
	options: SynthesizeOptions
): Promise<{ url: string; model: string; whole: Promise<GeneratedSpeech> }> {
	const adapter = elevenLabsAdapter(options);
	await adapter.load(options.onProgress);
	const [toPlayer, toStorage] = (await adapter.streamSpeech(options.text)).tee();

	const model = options.apiModel ?? 'elevenlabs';
	const whole = new Response(toStorage)
		.blob()
		.then((blob) => ({ audio: new Blob([blob], { type: OPUS_MIME_TYPE }), model, durationSec: 0 }));
	whole.catch((error) => console.warn('[tts] the streamed clip was cut off; it will be requested again', error));

	return { url: playOggOpusStream(toPlayer), model, whole };
}

function elevenLabsAdapter(options: SynthesizeOptions): ElevenLabsTtsAdapter {
	return new ElevenLabsTtsAdapter({
		apiKey: options.apiKey,
		baseUrl: options.apiBaseUrl,
		model: options.apiModel,
		voiceId: options.apiVoice
	});
}

/**
 * The cache identity of a clip. Advanced per-voice adjustments are part of it
 * (changing a slider must not replay audio rendered with the old EQ). Cloud
 * audio is neither a Piper voice nor EQ-processed; its key includes the
 * endpoint, model and API voice so switching providers cannot replay audio
 * generated by another one.
 */
function speechCacheKey(options: SynthesizeOptions, languageId: string, voice: string): string {
	const textHash = hashText(options.text);
	if (options.mode === 'cloud') {
		const provider = options.apiProvider ?? 'openai';
		const identity = `${provider}:${options.apiBaseUrl ?? ''}:${options.apiModel ?? ''}:${options.apiVoice ?? ''}`;
		return `tts:cloud:${languageId}:${identity}:${textHash}`;
	}

	const signature = options.raw ? 'raw' : tuningSignature(voiceTuning(get(appSettings), voice));
	return `tts:${options.mode}:${languageId}:${voice}:${signature}:${textHash}`;
}

/** A playable result; every caller gets its own object URL to revoke. */
function playable(speech: GeneratedSpeech, cached: boolean): SpeechResult {
	return { url: URL.createObjectURL(speech.audio), model: speech.model, durationSec: speech.durationSec, cached };
}

/**
 * Stores a clip compactly: compressed audio as it arrived; a WAV clip as Opus
 * where the platform can encode it (otherwise as the WAV). Caching is an
 * optimisation, so a failure here never fails the speech.
 */
async function storeSpeech(key: string, speech: GeneratedSpeech, attemptId?: string): Promise<void> {
	try {
		const compressed = speech.pcm
			? await encodeSpeechOpus(speech.pcm.samples, speech.pcm.sampleRate).catch((error) => {
					console.warn('[tts] could not compress audio; storing it as WAV', error);
					return null;
				})
			: null;
		const audio = compressed ?? speech.audio;

		const db = await getDatabaseAdapter();
		await db.putAudio({
			key,
			attemptId: attemptId ?? null,
			mime: audio.type || 'audio/wav',
			dataBase64: await blobToBase64(audio),
			createdAt: new Date().toISOString()
		});
	} catch (error) {
		console.warn('[tts] could not cache audio', error);
	}
}

async function generate(options: SynthesizeOptions, languageId: string, voice: string): Promise<GeneratedSpeech> {
	if (options.mode === 'cloud') {
		const adapter =
			options.apiProvider === 'elevenlabs'
				? elevenLabsAdapter(options)
				: new OpenAITtsAdapter({
						apiKey: options.apiKey,
						baseUrl: options.apiBaseUrl,
						model: options.apiModel,
						voice: options.apiVoice
					});
		await adapter.load(options.onProgress);
		const audio = await adapter.fetchSpeech(options.text);

		// A server without Opus answered with WAV: keep its samples so it is stored compressed.
		const decoded = isWav(audio) ? await decodeSpeech(audio) : null;
		const pcm = decoded ? { samples: decoded.audio, sampleRate: decoded.samplingRate } : undefined;
		return { audio, pcm, model: options.apiModel ?? options.apiProvider ?? 'cloud', durationSec: 0 };
	}

	const priority = (): SpeechPriority => (options.background ? 'background' : 'foreground');
	const synthesis = await getLocalPiper().synthesize(voice, options.text, options.onProgress, priority);
	if (synthesis.peak < 0.001) {
		throw new Error('The voice returned silence.');
	}

	// The voice's listening-test correction (EQ / loudness) plus the learner's
	// adjustments in Settings → Advanced are applied to the PCM before playback.
	const profile = getVoice(languageId, voice)?.processing;
	const tuning = voiceTuning(get(appSettings), voice);
	const samples = options.raw
		? synthesis.audio
		: await processPcm(synthesis.audio, synthesis.samplingRate, profile, tuning);

	return {
		audio: encodeWav(samples, synthesis.samplingRate),
		pcm: { samples, sampleRate: synthesis.samplingRate },
		model: synthesis.modelName,
		durationSec: synthesis.durationSec
	};
}
