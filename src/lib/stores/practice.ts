// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get, writable } from 'svelte/store';
import {
	getDatabaseAdapter,
	type Attempt,
	type Correction,
	type Prompt,
	type RunMode,
	type FollowUp,
	type Session,
	type TextGlosses,
	type TranslationSet,
	type WordGlosses,
	type IDatabaseAdapter,
	TRANSLATION_SET_VERSION
} from '#lib/adapters/db/index.js';
import { appSettings, setSetting, settingsReady, type AppSettings } from './settings';
import { groqApiKey } from './secrets';
import { ttsApiOptions } from './ttsConfig';
import { resolveLlmEndpoint } from './llm';
import { firstMissingRequirement, processingReady } from './processing';
import { playTrack, primeAudioPlayback, setAudioLoading, stopAudio, type AudioKind } from './audio';
import { languageData, refreshLanguageData } from './languageData';
import { VoiceRecorder, type Recording } from '#lib/utils/recorder.js';
import { transcribeSpeech } from '#lib/speech/stt/service.js';
import {
	evaluateAttempt,
	generateTranslations,
	generateSectionGlosses,
	glossSectionOf,
	glossWords,
	hasMeaningAt,
	phraseContext,
	translatePhrase,
	separateFollowUp,
	speakableExplanation,
	type EvaluationResult
} from '#lib/adapters/llm/index.js';
import {
	preloadLocalVoice,
	isStoppedClip,
	synthesizeExplanation,
	synthesizeSpeech,
	type ExplanationSpeechOptions,
	type SpeechResult,
	type SynthesizeOptions
} from '#lib/speech/tts/service.js';
import { base64ToBlob, blobToBase64 } from '#lib/utils/base64.js';
import { ensurePromptsSeeded, pickRandomPrompt } from '#lib/practice/prompts.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	explanationVoicesFor,
	getExplanationVoice,
	getInstructionLanguage,
	getVoice,
	instructionLanguagesFor,
	requireLanguage
} from '#lib/languages/index.js';
import { MAX_RECORDING_SEC, capWords, countWords } from '#lib/config.js';
import { hashText } from '#lib/utils/hash.js';
import { toast } from './toast';
import type { ModelProgress } from '#lib/types.js';

export type PracticePhase = 'idle' | 'recording' | 'transcribing' | 'evaluating' | 'error';

export interface AttemptView {
	id: string;
	/** What the learner said, verbatim from speech-to-text. */
	transcript: string;
	/** The correct version ("Did you mean to say…?"). */
	correctedText: string;
	translation: string;
	translations: TranslationSet | null;
	/** Spoken coaching markup in the language of instruction (see `adapters/llm/explanation.ts`). */
	explanation: string;
	/** The follow-up question and its translation; older takes keep the question in `explanation`. */
	followUp: FollowUp | null;
	/** Hover translations per text, fetched on the first hover (see `ensureWordGlosses`). */
	wordGlosses: WordGlosses;
	corrections: Correction[];
	durationSec: number;
	wordCount: number;
	createdAt: string;
	audioUrl: string | null;
	/** Voice id / cloud model last used for this attempt's read-back audio. */
	ttsVoice: string | null;
}

export interface PracticeState {
	phase: PracticePhase;
	prompt: { id: string; title: string; text: string };
	/** Tone for the current session. Locked once a session exists. */
	mode: RunMode;
	elapsed: number;
	/** Mic level, 0..1, for the live waveform. */
	level: number;
	/** STT model download/load progress, when loading. */
	progress: ModelProgress | null;
	statusText: string;
	error: string | null;
	sessionId: string | null;
	attempts: AttemptView[];
	activeAttemptId: string | null;
}

const initialState: PracticeState = {
	phase: 'idle',
	prompt: { id: '', title: '', text: '' },
	mode: 'exam',
	elapsed: 0,
	level: 0,
	progress: null,
	statusText: '',
	error: null,
	sessionId: null,
	attempts: [],
	activeAttemptId: null
};

const store = writable<PracticeState>({ ...initialState });
export const practice = { subscribe: store.subscribe };

let db: IDatabaseAdapter | null = null;
let prompts: Prompt[] = [];
let recorder: VoiceRecorder | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const translationJobs = new Map<string, Promise<TranslationSet>>();
const glossJobs = new Map<string, Promise<void>>();
const phraseJobs = new Map<string, Promise<string>>();
let initialization: Promise<void> | null = null;
/** True while the microphone permission prompt / device start is pending. */
let starting = false;
/**
 * Identifies the current take's pipeline. Switching session, language or
 * cancelling bumps it, so a transcription or evaluation that finishes later
 * cannot write into the wrong session or reset a phase it no longer owns.
 */
let run = 0;
let analysis: AbortController | null = null;
/** Latest read-back request; an older synthesis that finishes later must not play over it. */
let speechRequest = 0;

/** The spoken tracks of an attempt card; the follow-up question can also be replayed on its own. */
export type AttemptTrackKind = Extract<AudioKind, 'said' | 'corrected' | 'explanation' | 'followUp'>;

const TRACK_LABEL: Record<AttemptTrackKind, string> = {
	said: 'You said',
	corrected: 'Correct version',
	explanation: 'Explanation',
	followUp: 'Follow-up question'
};

/**
 * Why the explanation cannot be spoken right now, or null when it can. It is
 * in the language of instruction with target-language words in it: a cloud
 * voice speaks both; on the device it takes two voices (see
 * `synthesizeExplanation`), so the English voice must be chosen and downloaded.
 */
export const explanationAudioUnavailable = derived([appSettings, languageData], ([settings, data]) => {
	if (settings.ttsMode === 'cloud') return null;
	// While the device's voices are being checked (a moment at start-up) nothing is known yet:
	// the button stays as it was meant to be; a press waits for the check (`playAttemptTrack`).
	if (data.status === 'checking') return null;

	const instruction = getInstructionLanguage(settings.instructionLanguage).name;
	if (explanationVoicesFor(settings.instructionLanguage).length === 0) {
		return `There is no on-device ${instruction} voice yet: explanation audio needs Cloud text-to-speech.`;
	}
	if (!getExplanationVoice(settings.instructionLanguage, settings.explanationVoice)) {
		return `Explanation audio on this device needs a ${instruction} voice. Choose one in Settings → Text-to-speech.`;
	}
	if (!data.installed.explanationVoice) {
		return `Install the ${instruction} voice for explanations: Settings → Text-to-speech → Install.`;
	}
	return null;
});

/** Whether the explanation can be spoken (see `explanationAudioUnavailable`). */
export const explanationAudioAvailable = derived(explanationAudioUnavailable, (reason) => reason === null);

/** The languages a take is worked in: the one studied, and the one it is taught in. */
function teachingLanguages(settings: AppSettings): { language: string; translationTarget: string } {
	return {
		language: requireLanguage(settings.targetLanguage).name,
		translationTarget: getInstructionLanguage(settings.instructionLanguage).name
	};
}

/**
 * True when a take's translations are current: the latest format, and in the
 * language of instruction now chosen (older sets carry no language: English).
 */
export function translationsCurrent(translations: TranslationSet | null | undefined, instructionLanguage: string): boolean {
	const language = translations?.instructionLanguage ?? DEFAULT_INSTRUCTION_LANGUAGE_ID;
	return translations?.version === TRANSLATION_SET_VERSION && language === instructionLanguage;
}

function newId(prefix: string): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function update(patch: Partial<PracticeState>): void {
	store.update((state) => ({ ...state, ...patch }));
}

/**
 * Loads persisted practice data exactly once. A browser refresh creates a new
 * Svelte store, so rehydrate the newest saved session instead of
 * presenting an empty draft while History still contains the learner's work.
 */
export function initPractice(): Promise<void> {
	initialization ??= hydratePractice().catch((error) => {
		// Permit a later retry after a transient database startup failure and make
		// the failure visible in Practice instead of leaving an empty-looking app.
		initialization = null;
		update({
			phase: 'error',
			error: error instanceof Error ? `Saved practice data could not be loaded: ${error.message}` : 'Saved practice data could not be loaded.'
		});
		throw error;
	});
	return initialization;
}

async function hydratePractice(): Promise<void> {
	db = await getDatabaseAdapter();
	const languageId = get(appSettings).targetLanguage;
	if (languageId) {
		prompts = await ensurePromptsSeeded(db, languageId);
	}
	const state = get(store);
	if (!state.sessionId && state.attempts.length === 0) {
		if (await hydrateLatestSession()) return;
	}
	if (!state.prompt.id && prompts.length > 0) {
		const prompt = pickRandomPrompt(prompts);
		update({ prompt: { id: prompt.id, title: prompt.title, text: prompt.text } });
	}
	if (!state.sessionId) {
		update({ mode: get(appSettings).mode });
	}
}

/** Re-read the newest session after startup or an in-app backup restore. */
export async function hydrateLatestSession(): Promise<boolean> {
	if (!db) db = await getDatabaseAdapter();
	const saved = await db.listSessions();
	if (saved.length === 0) return false;
	await openSession(saved[0].id);
	return true;
}

/**
 * Abandons whatever the current take is doing (recording, transcribing or
 * evaluating) so the view can switch session safely.
 */
function abandonTake(): void {
	run++;
	analysis?.abort();
	analysis = null;
	if (timer) clearInterval(timer);
	timer = null;
	recorder?.cancel();
	recorder = null;
}

/**
 * Switches the language being studied: persists the choice, reseeds that
 * language's prompts and starts a fresh session. The download itself stays
 * manual so a mis-click never commits the user to a large transfer.
 */
export async function setTargetLanguage(languageId: string): Promise<void> {
	const language = requireLanguage(languageId);
	setSetting('targetLanguage', language.id);
	// Nobody is taught a language in that same language: back to the default (or the first other).
	if (get(appSettings).instructionLanguage === language.id) {
		const fallback = instructionLanguagesFor(language).find((entry) => entry.id === DEFAULT_INSTRUCTION_LANGUAGE_ID);
		setSetting('instructionLanguage', (fallback ?? instructionLanguagesFor(language)[0]).id);
	}
	// A voice saved for another language does not exist here; fall back to the
	// listening-test default for this language.
	if (!getVoice(language.id, get(appSettings).ttsVoice)) {
		setSetting('ttsVoice', language.defaultVoice);
	}
	if (!db) db = await getDatabaseAdapter();
	prompts = await ensurePromptsSeeded(db, language.id);
	abandonTake();
	update({
		sessionId: null,
		attempts: [],
		activeAttemptId: null,
		phase: 'idle',
		error: null,
		elapsed: 0,
		level: 0,
		prompt: { id: '', title: '', text: '' }
	});
	nextPrompt();
	void refreshLanguageData(language.id);
}

/**
 * Changes the tone for a draft session. Once a session has attempts its mode is
 * fixed, so the switch is a no-op then.
 */
export function setSessionMode(mode: RunMode): void {
	if (get(store).sessionId) return;
	update({ mode });
	setSetting('mode', mode);
}

/** Starts a fresh session (draft): clears attempts and unlocks the mode. */
export function newSession(): void {
	abandonTake();
	update({
		sessionId: null,
		attempts: [],
		activeAttemptId: null,
		phase: 'idle',
		error: null,
		elapsed: 0,
		level: 0
	});
	nextPrompt();
}

export function nextPrompt(): void {
	if (prompts.length === 0) return;
	const current = get(store).prompt.id;
	const prompt = pickRandomPrompt(prompts, current);
	update({ prompt: { id: prompt.id, title: prompt.title, text: prompt.text } });
}

/** API read-back options shared by every synthesis call (ElevenLabs or OpenAI-compatible). */
function speechApiOptions(settings: AppSettings) {
	return ttsApiOptions(settings);
}

export async function startRecording(): Promise<void> {
	const state = get(store);
	// `starting` covers the permission prompt, during which the phase is still idle
	// and a second click would open a second microphone stream.
	if (starting || (state.phase !== 'idle' && state.phase !== 'error')) return;
	// Every take needs transcription, correction and read-back. If any chosen
	// path is missing, the take could only fail after they have spoken, so
	// refuse before the microphone opens.
	if (!get(processingReady)) {
		const missing = get(firstMissingRequirement);
		update({
			phase: 'error',
			error: missing
				? `${missing.detail} Finish setup in Settings before you start speaking.`
				: 'Finish setup in Settings before you start speaking.'
		});
		return;
	}
	starting = true;
	const token = run;
	// Inside the learner's tap: lets the explanation play by itself after this take.
	primeAudioPlayback();

	const next = new VoiceRecorder();
	next.onLevel = (level) => update({ level });

	try {
		await next.start();
	} catch (error) {
		starting = false;
		update({
			phase: 'error',
			error:
				error instanceof Error
					? `Microphone unavailable: ${error.message}`
					: 'Microphone unavailable.'
		});
		return;
	}
	starting = false;
	// The session changed while the permission prompt was open.
	if (token !== run) {
		next.cancel();
		return;
	}
	recorder = next;
	// The read-back would otherwise play into the microphone.
	stopAudio();
	warmLocalVoices();

	update({ phase: 'recording', elapsed: 0, level: 0, error: null, statusText: 'Recording…' });
	const startedAt = performance.now();
	timer = setInterval(() => {
		const elapsed = (performance.now() - startedAt) / 1000;
		update({ elapsed });
		if (elapsed >= MAX_RECORDING_SEC) void stopAndAnalyze();
	}, 250);
}

/**
 * Loads the on-device voices while the learner speaks, so the reply does not
 * wait for them: loading one takes seconds, and idle voices are released
 * after a while. Only voices already on the device (never a download).
 */
function warmLocalVoices(): void {
	const settings = get(appSettings);
	const data = get(languageData);
	if (settings.ttsMode !== 'local' || !data.installed.voice) return;

	void preloadLocalVoice(settings.ttsVoice).catch(() => {});
	if (getExplanationVoice(settings.instructionLanguage, settings.explanationVoice) && data.installed.explanationVoice) {
		void preloadLocalVoice(settings.explanationVoice).catch(() => {});
	}
}

/** Discards the take in progress: stops the microphone, or abandons its analysis. */
export function cancelRecording(): void {
	abandonTake();
	update({ phase: 'idle', elapsed: 0, level: 0, statusText: '', progress: null });
}

/**
 * Whisper invents text for silence, so a take with no audible signal is
 * rejected before transcription. Loudest 100ms window below about -46 dBFS
 * RMS is treated as silence.
 */
function isSilent(pcm: Float32Array, sampleRate = 16000): boolean {
	const window = Math.round(sampleRate / 10);
	for (let start = 0; start < pcm.length; start += window) {
		const end = Math.min(pcm.length, start + window);
		let sum = 0;
		for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
		if (Math.sqrt(sum / Math.max(1, end - start)) > 0.005) return false;
	}
	return true;
}

export async function stopAndAnalyze(): Promise<void> {
	const state = get(store);
	const active = recorder;
	if (state.phase !== 'recording' || !active) return;
	// Claimed synchronously: a double-click (or the 60s timer firing during a
	// click) must not stop the same recorder twice.
	recorder = null;
	// Still inside the Stop tap (the 60s timer has none, but Start already primed).
	primeAudioPlayback();
	if (timer) clearInterval(timer);
	timer = null;
	const token = run;

	let recording: Recording;
	try {
		recording = await active.stop();
	} catch (error) {
		if (token === run) update({ phase: 'error', level: 0, error: 'Could not finish the recording.' });
		return;
	}
	if (token !== run) {
		URL.revokeObjectURL(recording.url);
		return;
	}
	if (isSilent(recording.pcm)) {
		URL.revokeObjectURL(recording.url);
		update({
			phase: 'error',
			level: 0,
			elapsed: 0,
			statusText: '',
			error: 'No speech was heard in that take. Check that the right microphone is selected and unmuted, then try again.'
		});
		return;
	}
	update({ level: 0, phase: 'transcribing', statusText: 'Transcribing…', progress: null });

	const settings = get(appSettings);
	const language = requireLanguage(settings.targetLanguage);
	// What this take answered, captured now: the view may move on before it finishes.
	const { prompt, mode, sessionId } = get(store);
	const controller = new AbortController();
	analysis = controller;

	try {
		const heard = await transcribeSpeech({
			audio16kMono: recording.pcm,
			recording: recording.blob,
			mode: settings.sttMode,
			languageId: language.id,
			groqApiKey: get(groqApiKey) || undefined,
			onProgress: (progress) => {
				if (token !== run) return;
				// "Model ready / 100%" arrives before the transcription itself; keep saying what is happening.
				if (progress.progress >= 100) update({ progress: null, statusText: 'Transcribing…' });
				else update({ progress, statusText: progress.status });
			}
		});
		if (token !== run) return;

		update({ phase: 'evaluating', statusText: `Analyzing your ${language.name}…`, progress: null });

		// 60s of fast speech is ~240 words; cap there so a runaway transcript
		// cannot blow the LLM output budget.
		const transcript = capWords(heard);

		const evaluation = await evaluateAttempt({
			transcript,
			prompt: prompt.text,
			mode,
			level: settings.level,
			...teachingLanguages(settings),
			// Translations shown under every take come with the evaluation; otherwise only when asked for.
			endpoint: resolveLlmEndpoint(settings),
			signal: controller.signal
		});
		if (token !== run) return;

		const view = await persistAttempt(recording, transcript, evaluation, mode, prompt, sessionId);
		update({
			phase: 'idle',
			statusText: '',
			error: null,
			elapsed: 0,
			attempts: [...get(store).attempts, view],
			activeAttemptId: view.id
		});

		// The coach answers first; without explanation audio, the correct version plays instead.
		const canExplain = get(explanationAudioAvailable) && Boolean(view.explanation);
		void playAttemptTrack(view.id, canExplain ? 'explanation' : 'corrected');
		prepareTakeAudio(view.id, { first: true });
	} catch (error) {
		if (token !== run) return;
		update({
			phase: 'error',
			statusText: '',
			progress: null,
			error: error instanceof Error ? error.message : 'Something went wrong.'
		});
	} finally {
		if (analysis === controller) analysis = null;
		URL.revokeObjectURL(recording.url);
	}
}

async function persistAttempt(
	recording: Recording,
	transcript: string,
	evaluation: EvaluationResult,
	mode: RunMode,
	prompt: PracticeState['prompt'],
	existingSessionId: string | null
): Promise<AttemptView> {
	if (!db) db = await getDatabaseAdapter();
	const database = db;
	const now = new Date().toISOString();

	let sessionId = existingSessionId;
	if (!sessionId) {
		sessionId = newId('session');
		await database.putSession({
			id: sessionId,
			title: prompt.title,
			mode,
			startedAt: now,
			endedAt: null,
			createdAt: now,
			updatedAt: now
		});
		update({ sessionId });
	}

	const attemptId = newId('attempt');
	const audioKey = `attempt:${attemptId}`;
	const attempt: Attempt = {
		id: attemptId,
		sessionId,
		promptId: prompt.id || null,
		promptText: prompt.text,
		transcript,
		correctedText: evaluation.correctedText,
		// Translated only when the learner asks for it (the card's translation menu).
		translation: null,
		translations: null,
		ttsVoice: get(appSettings).ttsVoice,
		explanation: evaluation.explanation,
		followUp: evaluation.followUp,
		wordGlosses: null,
		durationSec: Math.round(recording.durationSec * 100) / 100,
		wordCount: countWords(transcript),
		audioKey,
		createdAt: now,
		updatedAt: now
	};
	await database.putAttempt(attempt);

	const corrections = buildCorrections(attemptId, transcript, evaluation, now);
	await database.replaceCorrections(attemptId, corrections);

	try {
		await database.putAudio({
			key: audioKey,
			attemptId,
			mime: recording.blob.type || 'audio/webm',
			dataBase64: await blobToBase64(recording.blob),
			createdAt: now
		});
	} catch (error) {
		// Audio is a convenience; failing to persist it must not lose the analysis.
		console.error('[practice] could not store audio', error);
	}

	return {
		id: attemptId,
		transcript,
		correctedText: evaluation.correctedText,
		translation: '',
		translations: null,
		explanation: evaluation.explanation,
		followUp: evaluation.followUp,
		wordGlosses: {},
		corrections,
		durationSec: attempt.durationSec,
		wordCount: attempt.wordCount,
		createdAt: now,
		audioUrl: null,
		ttsVoice: attempt.ttsVoice
	};
}

/**
 * Flattens the LLM result into correction rows.
 *
 * The schema and the prototype's insight columns only know four categories, so
 * vocabulary upgrades become `style` suggestions and connector advice becomes
 * `register` suggestions rather than introducing new categories.
 */
function buildCorrections(
	attemptId: string,
	transcript: string,
	evaluation: EvaluationResult,
	createdAt: string
): Correction[] {
	const rows: Correction[] = [];
	let order = 0;

	for (const correction of evaluation.corrections) {
		rows.push({
			id: newId('corr'),
			attemptId,
			category: correction.category,
			severity: correction.severity,
			label: correction.label,
			original: correction.original,
			replacement: correction.replacement,
			replacementTranslation: correction.replacementTranslation ?? null,
			start: null,
			end: null,
			explanation: correction.explanation,
			speakText: correction.speakText ?? null,
			examStatus: correction.examStatus ?? null,
			formalAlternatives: correction.formalAlternatives ?? [],
			sortOrder: order++,
			createdAt
		});
	}

	for (const vocab of evaluation.vocabulary) {
		rows.push({
			id: newId('corr'),
			attemptId,
			category: 'style',
			severity: 'suggestion',
			label: 'Vocabulary',
			original: vocab.original,
			replacement: vocab.suggestion,
			replacementTranslation: null,
			start: null,
			end: null,
			explanation: vocab.why,
			speakText: null,
			examStatus: null,
			formalAlternatives: [],
			sortOrder: order++,
			createdAt
		});
	}

	for (const connector of evaluation.connectors) {
		rows.push({
			id: newId('corr'),
			attemptId,
			category: 'register',
			severity: 'suggestion',
			label: 'Connector',
			original: connector.insteadOf ?? '',
			replacement: connector.connector,
			replacementTranslation: null,
			start: null,
			end: null,
			explanation: connector.why,
			speakText: null,
			examStatus: null,
			formalAlternatives: [],
			sortOrder: order++,
			createdAt
		});
	}

	// Resolve each `original` to a character range in the transcript, claiming
	// distinct occurrences so a repeated phrase is not marked twice and overlaps
	// are avoided. Falls back to null when the text is not found verbatim
	// (e.g. filler sounds the recogniser dropped).
	const used: Array<[number, number]> = [];
	for (const row of rows) {
		if (!row.original) continue;
		let from = 0;
		let chosen: [number, number] | null = null;
		for (;;) {
			const at = transcript.indexOf(row.original, from);
			if (at === -1) break;
			const range: [number, number] = [at, at + row.original.length];
			const overlaps = used.some(([start, end]) => range[0] < end && range[1] > start);
			if (!overlaps) {
				chosen = range;
				break;
			}
			from = at + row.original.length;
		}
		if (chosen) {
			row.start = chosen[0];
			row.end = chosen[1];
			used.push(chosen);
		}
	}

	return rows;
}

export function setActiveAttempt(id: string | null): void {
	update({ activeAttemptId: id });
	// The take being read is prepared before the rest.
	if (id) prepareTakeAudio(id, { first: true });
}

export function clearError(): void {
	// A read-back error can arrive while a new take is recording; dismissing it
	// must not reset that phase.
	store.update((state) => ({ ...state, error: null, phase: state.phase === 'error' ? 'idle' : state.phase }));
}

/**
 * Backfills all translation variants for an older attempt and persists them so
 * subsequent views do not make another provider request.
 */
export function ensureAttemptTranslations(
	attemptId: string,
	force = false
): Promise<TranslationSet> {
	const attempt = get(store).attempts.find((item) => item.id === attemptId);
	if (!attempt) return Promise.reject(new Error('Attempt not found.'));
	if (
		!force &&
		translationsCurrent(attempt.translations, get(appSettings).instructionLanguage) &&
		attempt.translations?.idiomatic &&
		attempt.translations.literal &&
		attempt.translations.wordForWord
	) {
		return Promise.resolve(attempt.translations);
	}

	const running = translationJobs.get(attemptId);
	if (running) return running;

	const job = (async () => {
		if (!db) db = await getDatabaseAdapter();
		// The correct version, not the transcript: what the learner meant, which is the transcript when it had no mistakes.
		const settings = get(appSettings);
		const generated = await generateTranslations(
			attempt.correctedText?.trim() || attempt.transcript,
			resolveLlmEndpoint(settings),
			teachingLanguages(settings)
		);
		const translations = { ...generated, instructionLanguage: settings.instructionLanguage };
		const row = await db.getAttempt(attemptId);
		if (!row) throw new Error('Attempt not found.');
		await db.putAttempt({
			...row,
			translation: translations.idiomatic,
			translations,
			updatedAt: new Date().toISOString()
		});
		update({
			attempts: get(store).attempts.map((item) =>
				item.id === attemptId
					? { ...item, translation: translations.idiomatic, translations }
					: item
			)
		});
		return translations;
	})().finally(() => translationJobs.delete(attemptId));

	translationJobs.set(attemptId, job);
	return job;
}

/**
 * The hover translations of one of an attempt's texts: one meaning per word
 * token (`glossWords`) and its phrases, or null until any have been fetched.
 * A text can hold translated selections before its word meanings
 * (`hasMeaningAt`).
 *
 * @param attempt The attempt the text belongs to.
 * @param text The transcript or the correct version.
 */
export function wordGlossesFor(
	attempt: AttemptView,
	text: string,
	instructionLanguage = get(appSettings).instructionLanguage
): TextGlosses | null {
	return attempt.wordGlosses[glossKey(text, instructionLanguage)] ?? null;
}

/**
 * Where a text's hover meanings are kept on its attempt: per language of
 * instruction, so a change of language fetches new ones. English keeps the
 * plain text hash, which is what meanings saved before this choice use.
 */
function glossKey(text: string, instructionLanguage = get(appSettings).instructionLanguage): string {
	return instructionLanguage === DEFAULT_INSTRUCTION_LANGUAGE_ID ? hashText(text) : `${instructionLanguage}:${hashText(text)}`;
}

/** Saves an attempt's hover translations in the view and the database. */
async function saveWordGlosses(attemptId: string, wordGlosses: WordGlosses): Promise<void> {
	update({
		attempts: get(store).attempts.map((item) => (item.id === attemptId ? { ...item, wordGlosses } : item))
	});

	if (!db) db = await getDatabaseAdapter();
	const row = await db.getAttempt(attemptId);
	if (row) await db.putAttempt({ ...row, wordGlosses, updatedAt: new Date().toISOString() });
}

/** Word-meaning requests in flight, one per text of an attempt. */
function glossJobKey(attemptId: string, text: string): string {
	return `${attemptId}:${glossKey(text)}`;
}

/**
 * The meaning of a range of words the learner selected: one small LLM call
 * that translates exactly those words in context, saved so selecting them
 * again answers at once. Expressions found by the word meanings are not
 * reused: their glosses are written for hovering and can be too terse for a
 * deliberate selection.
 *
 * @param attemptId The attempt the text belongs to.
 * @param text The transcript or the correct version.
 * @param start First selected word token (`glossWords` index).
 * @param end Last selected word token, inclusive.
 * @param phrase The selected words exactly as they appear in the text.
 * @returns The meaning in the language of instruction.
 * @throws With a readable message when the LLM call fails.
 */
export function ensurePhraseMeaning(
	attemptId: string,
	text: string,
	start: number,
	end: number,
	phrase: string
): Promise<string> {
	const jobKey = `${attemptId}:${glossKey(text)}:${start}-${end}`;
	const running = phraseJobs.get(jobKey);
	if (running) return running;

	const job = (async () => {
		const findSaved = () => {
			const attempt = get(store).attempts.find((item) => item.id === attemptId);
			const glosses = attempt ? wordGlossesFor(attempt, text) : null;
			return glosses?.phrases.find(
				(saved) => saved.origin === 'selection' && saved.start === start && saved.end === end
			)?.meaning;
		};
		const saved = findSaved();
		if (saved) return saved;

		const settings = get(appSettings);
		const context = phraseContext(text, start, end);
		const meaning = await translatePhrase(phrase, context, resolveLlmEndpoint(settings), teachingLanguages(settings));

		const attempt = get(store).attempts.find((item) => item.id === attemptId);
		if (attempt) {
			const key = glossKey(text);
			const current = attempt.wordGlosses[key] ?? { words: [], phrases: [] };
			const phrases = [...current.phrases, { start, end, meaning, origin: 'selection' as const }];
			await saveWordGlosses(attemptId, { ...attempt.wordGlosses, [key]: { ...current, phrases } });
		}
		return meaning;
	})().finally(() => phraseJobs.delete(jobKey));

	phraseJobs.set(jobKey, job);
	return job;
}

/**
 * Fetches the hover translations around the word the learner is pointing at:
 * the section of the text it is in (`glossSections`, about a paragraph), in
 * one small LLM call, and saves them on the attempt so later hovers are
 * instant and work offline. The rest of a long take is fetched only where
 * the learner points, and the other text (transcript or correct version)
 * only if they point at it too. Concurrent hovers in one section share one
 * request.
 *
 * @param attemptId The attempt whose words were hovered.
 * @param text The transcript or the correct version.
 * @param wordIndex The word pointed at (`glossWords` index).
 * @throws With a readable message when the LLM call fails.
 */
export function ensureWordGlosses(attemptId: string, text: string, wordIndex: number): Promise<void> {
	const attempt = get(store).attempts.find((item) => item.id === attemptId);
	if (!attempt) return Promise.reject(new Error('Attempt not found.'));

	const section = glossSectionOf(text, wordIndex);
	if (!section || hasMeaningAt(wordGlossesFor(attempt, text), wordIndex)) return Promise.resolve();

	const jobKey = `${glossJobKey(attemptId, text)}:${section.start}`;
	const running = glossJobs.get(jobKey);
	if (running) return running;

	const job = (async () => {
		const settings = get(appSettings);
		const fetched = await generateSectionGlosses(text, section, resolveLlmEndpoint(settings), teachingLanguages(settings));

		// Merged into what is saved now: other sections and selections may have arrived meanwhile.
		const key = glossKey(text);
		const current = get(store).attempts.find((item) => item.id === attemptId);
		const saved = current?.wordGlosses[key];
		const wordCount = glossWords(text).length;
		const words = Array.from({ length: wordCount }, (_, index) =>
			index >= section.start && index <= section.end ? fetched.words[index - section.start] : (saved?.words[index] ?? '')
		);
		const merged = {
			words,
			phrases: [...(saved?.phrases ?? []), ...fetched.phrases],
			sections: [...(saved?.sections ?? []), section]
		};
		await saveWordGlosses(attemptId, { ...(current?.wordGlosses ?? {}), [key]: merged });
	})().finally(() => glossJobs.delete(jobKey));

	glossJobs.set(jobKey, job);
	return job;
}

/** The text an attempt track reads aloud. */
function trackText(attempt: AttemptView, kind: AttemptTrackKind): string {
	if (kind === 'said') return attempt.transcript;
	if (kind === 'corrected') return attempt.correctedText || attempt.transcript;
	if (kind === 'followUp') return followUpQuestion(attempt);

	// The coach ends by asking the follow-up question aloud; its translation stays on screen only.
	const explanation = speakableExplanation(attempt.explanation);
	const question = attempt.followUp?.question ?? '';
	return [explanation, question].filter(Boolean).join(' ');
}

/**
 * The follow-up question in the target language; older takes carried it inside the explanation.
 *
 * @param attempt The take.
 * @returns The question, or an empty string when the take has none.
 */
export function followUpQuestion(attempt: AttemptView): string {
	return attempt.followUp?.question || separateFollowUp(attempt.explanation).askedQuestion || '';
}

/**
 * Speaks one of an attempt's tracks: what the learner said, the correct
 * version, or the explanation.
 *
 * @param id The attempt to play.
 * @param kind Which track to speak.
 */
export async function playAttemptTrack(id: string, kind: AttemptTrackKind): Promise<void> {
	const attempt = get(store).attempts.find((a) => a.id === id);
	if (!attempt) return;

	if (kind === 'explanation') {
		await languageDataChecked();
		const unavailable = get(explanationAudioUnavailable);
		if (unavailable) {
			update({ error: unavailable });
			return;
		}
		if (get(appSettings).ttsMode === 'local') {
			await playLocalExplanation(attempt);
			return;
		}
	}

	await playAttemptText(attempt, trackText(attempt, kind), kind);
}

/** Resolves once the device's voices have been checked (they are re-checked at start-up and on changes). */
function languageDataChecked(): Promise<void> {
	return new Promise((resolve) => {
		let stop: (() => void) | undefined;
		stop = languageData.subscribe((data) => {
			if (data.status === 'checking') return;
			queueMicrotask(() => stop?.());
			resolve();
		});
	});
}

/**
 * Speaks an explanation on the device: its English with the chosen English
 * voice, its target-language words and the follow-up question with the
 * attempt's voice, starting before the whole explanation is spoken.
 */
function playLocalExplanation(attempt: AttemptView): Promise<void> {
	return playAttemptSpeech(attempt, 'explanation', TRACK_LABEL.explanation, undefined, () =>
		synthesizeExplanation({ ...localExplanationOptions(attempt, get(appSettings)), stream: true })
	);
}

/*
 * What each kind of speech is made with. Playing a clip and preparing it
 * ahead of time use the same options, so they find the same stored clip.
 */

/** An attempt's track (or one of its sentences), in the attempt's voice. */
function trackSpeechOptions(attempt: AttemptView, text: string, settings: AppSettings): SynthesizeOptions {
	return {
		text,
		mode: settings.ttsMode,
		languageId: settings.targetLanguage,
		voice: attempt.ttsVoice ?? settings.ttsVoice,
		...speechApiOptions(settings),
		attemptId: attempt.id
	};
}

/** A correction's read-back, in the voice chosen in Settings. */
function correctionSpeechOptions(text: string, settings: AppSettings): SynthesizeOptions {
	return {
		text,
		mode: settings.ttsMode,
		languageId: settings.targetLanguage,
		voice: settings.ttsVoice,
		...speechApiOptions(settings)
	};
}

/** An explanation spoken on the device by two voices. */
function localExplanationOptions(attempt: AttemptView, settings: AppSettings): ExplanationSpeechOptions {
	return {
		markup: attempt.explanation,
		question: attempt.followUp?.question ?? '',
		languageId: settings.targetLanguage,
		targetVoice: attempt.ttsVoice ?? settings.ttsVoice,
		instructionLanguage: settings.instructionLanguage,
		explanationVoice: settings.explanationVoice,
		attemptId: attempt.id
	};
}

/*
 * On-device read-back costs nothing, so every clip of a take is made ahead of
 * time and is ready when tapped: the explanation, the follow-up question, the
 * correct version, what was said, then each correction's read-back. Takes
 * wait in a queue: a new take, or the one being read, goes first; then the
 * rest of the session, newest first. One clip is made at a time, so a tap
 * never waits behind a queue of them (and joins the clip if it is the one
 * being made). Cloud read-back is never prepared: it costs credits.
 */
const preparationQueue: string[] = [];
let preparing = false;

/** Stops the clip being prepared (at its next piece) once preparing is no longer allowed. */
let preparationStop = new AbortController();

/**
 * True when clips can be prepared: the learner's settings are loaded (until
 * then the defaults say on-device), read-back is on the device, and its
 * voice is already downloaded (preparing must never start a download of its own).
 */
function canPrepareAudio(): boolean {
	return get(settingsReady) && get(appSettings).ttsMode === 'local' && get(languageData).installed.voice;
}

/** Read-back moved to the cloud, or the voice went: the queue is dropped and the clip being made stops. */
function stopPreparingIfNotAllowed(): void {
	if (canPrepareAudio()) return;

	preparationQueue.length = 0;
	preparationStop.abort();
}
appSettings.subscribe(stopPreparingIfNotAllowed);

/** Queues a take's clips; `first` puts it at the front, ahead of the take being prepared. */
function prepareTakeAudio(attemptId: string, { first = false } = {}): void {
	if (!canPrepareAudio()) return;

	const queued = preparationQueue.indexOf(attemptId);
	if (queued >= 0) preparationQueue.splice(queued, 1);
	if (first) preparationQueue.unshift(attemptId);
	else preparationQueue.push(attemptId);

	if (!preparing) void prepareQueuedAudio();
}

/** Queues every take of the session, newest first, behind anything already queued. */
function prepareSessionAudio(attempts: readonly AttemptView[]): void {
	for (const attempt of [...attempts].reverse()) prepareTakeAudio(attempt.id);
}

// The voice is confirmed on the device a moment after start-up (or once it is
// downloaded): that is when the open session's clips can be prepared.
let voiceWasInstalled = false;
languageData.subscribe((data) => {
	const installed = data.installed.voice && data.status !== 'checking';
	if (installed && !voiceWasInstalled) prepareSessionAudio(get(store).attempts);
	voiceWasInstalled = installed;
	stopPreparingIfNotAllowed();
});
// Settings finish loading after start-up: that can be the moment preparing becomes allowed.
settingsReady.subscribe((ready) => {
	if (ready && get(languageData).installed.voice && get(languageData).status !== 'checking') {
		prepareSessionAudio(get(store).attempts);
	}
});

async function prepareQueuedAudio(): Promise<void> {
	preparing = true;
	if (preparationStop.signal.aborted) preparationStop = new AbortController();
	try {
		while (preparationQueue.length > 0) {
			const attemptId = preparationQueue[0];
			for (const makeClip of takeClips(attemptId)) {
				if (!canPrepareAudio()) {
					preparationQueue.length = 0;
					return;
				}
				// Another take went to the front: it is prepared now, this one after it
				// (its clips made so far are stored, so picking up again is quick).
				if (preparationQueue[0] !== attemptId) break;

				try {
					URL.revokeObjectURL((await makeClip(preparationStop.signal)).url);
				} catch (error) {
					if (!isStoppedClip(error)) console.warn('[practice] a clip could not be prepared', error);
				}
			}
			if (preparationQueue[0] === attemptId) preparationQueue.shift();
		}
	} finally {
		preparing = false;
	}
}

/** A take's clips, most important first; `signal` stops one being made when preparing is no longer allowed. */
function takeClips(attemptId: string): Array<(signal: AbortSignal) => Promise<SpeechResult>> {
	const attempt = get(store).attempts.find((item) => item.id === attemptId);
	if (!attempt) return [];

	// Made in the background: a clip the learner is listening to always goes first.
	const settings = get(appSettings);
	const clips: Array<(signal: AbortSignal) => Promise<SpeechResult>> = [];
	if (attempt.explanation && get(explanationAudioAvailable)) {
		clips.push((signal) => synthesizeExplanation({ ...localExplanationOptions(attempt, settings), background: true, signal }));
	}
	for (const kind of ['followUp', 'corrected', 'said'] as const) {
		const text = trackText(attempt, kind);
		if (text.trim()) clips.push((signal) => synthesizeSpeech({ ...trackSpeechOptions(attempt, text, settings), background: true, signal }));
	}
	for (const correction of attempt.corrections) {
		const text = correction.speakText ?? correction.replacement;
		if (text?.trim()) clips.push((signal) => synthesizeSpeech({ ...correctionSpeechOptions(text, settings), background: true, signal }));
	}
	return clips;
}

/** Plays one sentence/segment of an attempt with that attempt's voice. */
export async function playSegment(id: string, text: string, index: number): Promise<void> {
	const attempt = get(store).attempts.find((a) => a.id === id);
	await playAttemptText(attempt, text, 'segment', index);
}

async function playAttemptText(
	attempt: AttemptView | undefined,
	text: string,
	kind: AttemptTrackKind | 'segment',
	index?: number
): Promise<void> {
	if (!attempt || !text.trim()) return;
	const settings = get(appSettings);
	const label = kind === 'segment' ? text : TRACK_LABEL[kind];
	await playAttemptSpeech(attempt, kind, label, index, () =>
		// Starts playing while it arrives (cloud); replays come from the stored clip.
		synthesizeSpeech({ ...trackSpeechOptions(attempt, text, settings), stream: true })
	);
}

/**
 * Plays an attempt's speech on the shared player: shows it loading, then
 * plays it, unless a newer request took over meanwhile.
 */
async function playAttemptSpeech(
	attempt: AttemptView,
	kind: AttemptTrackKind | 'segment',
	label: string,
	index: number | undefined,
	synthesize: () => Promise<SpeechResult>
): Promise<void> {
	const request = ++speechRequest;
	setAudioLoading(true, {
		attemptId: attempt.id,
		kind,
		segmentIndex: index,
		label,
		url: ''
	});
	try {
		const speech = await synthesize();
		if (request !== speechRequest) {
			URL.revokeObjectURL(speech.url);
			return;
		}
		playTrack({
			attemptId: attempt.id,
			kind,
			segmentIndex: index,
			label,
			url: speech.url
		});
	} catch (error) {
		if (request !== speechRequest) return;
		setAudioLoading(false);
		console.error('[practice] speech failed', error);
		update({ error: error instanceof Error ? error.message : 'Speech playback failed.' });
	}
}

/**
 * Re-renders an attempt's correct version with a different voice/model and
 * remembers the choice. Audio is cached per voice, so switching back is instant.
 */
export async function setAttemptVoice(attemptId: string, voice: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const attempt = get(store).attempts.find((a) => a.id === attemptId);
	if (!attempt) return;
	const text = trackText(attempt, 'corrected');
	const request = ++speechRequest;
	const settings = get(appSettings);
	try {
		const speech = await synthesizeSpeech({
			text,
			mode: settings.ttsMode,
			languageId: settings.targetLanguage,
			voice,
			...speechApiOptions(settings),
			attemptId,
			force: true
		});
		const row = await db.getAttempt(attemptId);
		if (row) {
			await db.putAttempt({ ...row, ttsVoice: voice, updatedAt: new Date().toISOString() });
		}
		update({
			attempts: get(store).attempts.map((a) =>
				a.id === attemptId ? { ...a, ttsVoice: voice } : a
			)
		});
		if (request === speechRequest) playTrack({ attemptId, kind: 'corrected', label: TRACK_LABEL.corrected, url: speech.url });
		else URL.revokeObjectURL(speech.url);
	} catch (error) {
		toast(error instanceof Error ? error.message : 'Could not re-render audio.');
	}
}

/** Synthesizes and plays arbitrary target-language text (used for correction read-back). */
export async function speakText(text: string): Promise<void> {
	if (!text.trim()) return;
	const settings = get(appSettings);
	const request = ++speechRequest;
	setAudioLoading(true, { attemptId: '', kind: 'correction', label: text, url: '' });
	try {
		const speech = await synthesizeSpeech(correctionSpeechOptions(text, settings));
		if (request !== speechRequest) {
			URL.revokeObjectURL(speech.url);
			return;
		}
		playTrack({ attemptId: '', kind: 'correction', label: text, url: speech.url });
	} catch (error) {
		if (request !== speechRequest) return;
		setAudioLoading(false);
		console.error('[practice] speech failed', error);
		update({
			error: error instanceof Error ? error.message : 'Speech playback failed.'
		});
	}
}

/** Replays an attempt's stored recording, from the database. */
export async function playRecording(id: string): Promise<void> {
	await playStoredAudio(id);
}

/** Plays stored audio by attempt id, without needing it loaded in the store. */
export async function playStoredAudio(attemptId: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const request = ++speechRequest;
	const stored = await db.getAudio(`attempt:${attemptId}`);
	if (request !== speechRequest) return;
	if (!stored) {
		toast('No audio stored for this attempt.');
		return;
	}
	const blob = base64ToBlob(stored.dataBase64, stored.mime);
	playTrack({
		attemptId,
		kind: 'recording',
		label: 'Your recording',
		url: URL.createObjectURL(blob)
	});
}

/** Renames a session. */
export async function renameSession(id: string, title: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const session = await db.getSession(id);
	if (!session) return;
	await db.putSession({ ...session, title, updatedAt: new Date().toISOString() });
	if (get(store).sessionId === id) {
		update({ prompt: { ...get(store).prompt, title } });
	}
}

/**
 * Deletes a session and everything under it.
 *
 * Attempts, corrections and audio are removed explicitly rather than relying on
 * `ON DELETE CASCADE`, because the Tauri plugin may run each statement on a
 * different pooled connection where `PRAGMA foreign_keys` was not set.
 */
export async function deleteSession(id: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const database = db;
	const attempts = await database.listAttempts(id);
	for (const attempt of attempts) {
		await database.deleteAudio(`attempt:${attempt.id}`);
		await database.deleteAttemptAudio(attempt.id);
		await database.replaceCorrections(attempt.id, []);
		await database.deleteAttempt(attempt.id);
	}
	await database.deleteSession(id);
	if (get(store).sessionId === id) {
		abandonTake();
		update({ sessionId: null, attempts: [], activeAttemptId: null, phase: 'idle', elapsed: 0, level: 0 });
	}
}

/** Loads a session's attempts from the database into the view. */
export async function openSession(sessionId: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const [session, attempts] = await Promise.all([
		db.getSession(sessionId),
		db.listAttempts(sessionId)
	]);

	const correctionLists = await Promise.all(
		attempts.map((attempt) => db!.listCorrections(attempt.id))
	);
	const views: AttemptView[] = attempts.map((attempt, index) => {
		return {
			id: attempt.id,
			transcript: attempt.transcript,
			correctedText: attempt.correctedText ?? '',
			translation: attempt.translation ?? '',
			translations: attempt.translations,
			explanation: attempt.explanation ?? '',
			followUp: attempt.followUp,
			wordGlosses: attempt.wordGlosses ?? {},
			corrections: correctionLists[index],
			durationSec: attempt.durationSec,
			wordCount: attempt.wordCount,
			createdAt: attempt.createdAt,
			audioUrl: null,
			ttsVoice: attempt.ttsVoice
		};
	});

	const latest = views.at(-1)?.id ?? null;
	const prompt = session
		? await sessionPrompt(db, session, attempts.find((attempt) => attempt.promptId)?.promptId ?? null)
		: get(store).prompt;
	// A take still recording or being analysed belongs to the previous view.
	abandonTake();
	update({
		sessionId,
		attempts: views,
		activeAttemptId: latest,
		mode: session?.mode ?? get(store).mode,
		phase: 'idle',
		error: null,
		elapsed: 0,
		level: 0,
		statusText: '',
		progress: null,
		prompt
	});
	// After the view holds the takes: preparing reads them from it.
	prepareSessionAudio(views);
}

/**
 * The prompt a reopened session was answering. Previously only the title was
 * restored, so "Your prompt" came back empty. Uses the stored prompt when an
 * attempt links one, else the language's prompt with the same title (older
 * sessions and renamed-back titles), else the title itself.
 */
async function sessionPrompt(
	db: IDatabaseAdapter,
	session: Session,
	promptId: string | null
): Promise<{ id: string; title: string; text: string }> {
	const stored = promptId ? await db.getPrompt(promptId).catch(() => null) : null;
	if (stored) return { id: stored.id, title: session.title, text: stored.text };
	const language = requireLanguage(get(appSettings).targetLanguage);
	const match = language.prompts.find((prompt) => prompt.title === session.title);
	return { id: '', title: session.title, text: match?.text ?? session.title };
}
