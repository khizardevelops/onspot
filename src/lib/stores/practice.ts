import { get, writable } from 'svelte/store';
import {
	getDatabaseAdapter,
	type Attempt,
	type Correction,
	type Prompt,
	type RunMode,
	type Session,
	type TranslationSet,
	type IDatabaseAdapter
} from '#lib/adapters/db/index.js';
import { appSettings, setSetting } from './settings';
import { groqApiKey, openaiApiKey } from './secrets';
import { llmConfigured, resolveLlmEndpoint } from './llm';
import { playTrack, setAudioLoading, stopAudio } from './audio';
import { refreshLanguageData } from './languageData';
import { VoiceRecorder, type Recording } from '#lib/utils/recorder.js';
import { transcribeSpeech } from '#lib/adapters/stt/service.js';
import { evaluateAttempt, generateTranslations, type EvaluationResult } from '#lib/adapters/llm/index.js';
import { synthesizeSpeech } from '#lib/adapters/tts/service.js';
import { base64ToBlob, blobToBase64 } from '#lib/utils/base64.js';
import { ensurePromptsSeeded, pickRandomPrompt } from '#lib/practice/prompts.js';
import { requireLanguage, getVoice } from '#lib/languages/index.js';
import { MAX_RECORDING_SEC, capWords, countWords } from '#lib/config.js';
import { toast } from './toast';
import type { ModelProgress } from '#lib/types.js';

export type PracticePhase = 'idle' | 'recording' | 'transcribing' | 'evaluating' | 'error';

export interface AttemptView {
	id: string;
	transcript: string;
	correctedText: string;
	naturalSpeech: string;
	translation: string;
	translations: TranslationSet | null;
	summary: string;
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

export async function startRecording(): Promise<void> {
	const state = get(store);
	// `starting` covers the permission prompt, during which the phase is still idle
	// and a second click would open a second microphone stream.
	if (starting || (state.phase !== 'idle' && state.phase !== 'error')) return;
	// Every take is evaluated by the learner's LLM. Without one the take could
	// only fail after they have spoken, so refuse before the microphone opens.
	if (!get(llmConfigured)) {
		update({
			phase: 'error',
			error: 'Set up your AI provider (API key, or URL and model for a custom one) in Settings → AI provider before you start speaking.'
		});
		return;
	}
	starting = true;
	const token = run;

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

	update({ phase: 'recording', elapsed: 0, level: 0, error: null, statusText: 'Recording…' });
	const startedAt = performance.now();
	timer = setInterval(() => {
		const elapsed = (performance.now() - startedAt) / 1000;
		update({ elapsed });
		if (elapsed >= MAX_RECORDING_SEC) void stopAndAnalyze();
	}, 250);
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
		const stt = await transcribeSpeech({
			audio16kMono: recording.pcm,
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
		const transcript = capWords(stt.text);

		const evaluation = await evaluateAttempt({
			transcript,
			prompt: prompt.text,
			mode,
			level: settings.level,
			language: language.name,
			translationTarget: language.translationTarget,
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

		void playAttempt(view.id);
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
		naturalSpeech: evaluation.naturalSpeech,
		translation: evaluation.translations.idiomatic || null,
		translations: evaluation.translations,
		ttsVoice: get(appSettings).ttsVoice,
		summary: evaluation.summary,
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
		naturalSpeech: evaluation.naturalSpeech,
		translation: evaluation.translations.idiomatic,
		translations: evaluation.translations,
		summary: evaluation.summary,
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
		attempt.translations?.version === 2 &&
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
		const language = requireLanguage(get(appSettings).targetLanguage);
		const translations = await generateTranslations(
			attempt.transcript,
			resolveLlmEndpoint(get(appSettings)),
			{ language: language.name, translationTarget: language.translationTarget }
		);
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

/** Speaks an attempt's natural rewrite (falls back to the corrected text). */
export async function playAttempt(id: string): Promise<void> {
	const attempt = get(store).attempts.find((a) => a.id === id);
	if (!attempt) return;
	await playAttemptText(attempt, attempt.naturalSpeech || attempt.correctedText, 'attempt');
}

/** Plays one sentence/segment of an attempt with that attempt's voice. */
export async function playSegment(id: string, text: string, index: number): Promise<void> {
	const attempt = get(store).attempts.find((a) => a.id === id);
	await playAttemptText(attempt, text, 'segment', index);
}

async function playAttemptText(
	attempt: AttemptView | undefined,
	text: string,
	kind: 'attempt' | 'segment',
	index?: number
): Promise<void> {
	if (!attempt || !text.trim()) return;
	const settings = get(appSettings);
	const request = ++speechRequest;
	setAudioLoading(true, {
		attemptId: attempt.id,
		kind,
		segmentIndex: index,
		label: kind === 'segment' ? text : 'Corrected audio',
		url: ''
	});
	try {
		const speech = await synthesizeSpeech({
			text,
			mode: settings.ttsMode,
			languageId: settings.targetLanguage,
			voice: attempt.ttsVoice ?? settings.ttsVoice,
			openaiApiKey: get(openaiApiKey) || undefined,
			attemptId: attempt.id
		});
		if (request !== speechRequest) {
			URL.revokeObjectURL(speech.url);
			return;
		}
		playTrack({
			attemptId: attempt.id,
			kind,
			segmentIndex: index,
			label: kind === 'segment' ? text : 'Corrected audio',
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
 * Re-renders an attempt's read-back with a different voice/model and remembers
 * the choice. Audio is cached per voice, so switching back is instant.
 */
export async function setAttemptVoice(attemptId: string, voice: string): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const attempt = get(store).attempts.find((a) => a.id === attemptId);
	if (!attempt) return;
	const text = attempt.naturalSpeech || attempt.correctedText;
	const request = ++speechRequest;
	try {
		const speech = await synthesizeSpeech({
			text,
			mode: get(appSettings).ttsMode,
			languageId: get(appSettings).targetLanguage,
			voice,
			openaiApiKey: get(openaiApiKey) || undefined,
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
		if (request === speechRequest) playTrack({ attemptId, kind: 'attempt', label: 'Corrected audio', url: speech.url });
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
		const speech = await synthesizeSpeech({
			text,
			mode: settings.ttsMode,
			languageId: settings.targetLanguage,
			voice: settings.ttsVoice,
			openaiApiKey: get(openaiApiKey) || undefined
		});
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
			naturalSpeech: attempt.naturalSpeech ?? '',
			translation: attempt.translation ?? '',
			translations: attempt.translations,
			summary: attempt.summary ?? '',
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
