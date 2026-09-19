import { get, writable } from 'svelte/store';
import {
	getDatabaseAdapter,
	type Attempt,
	type Correction,
	type Prompt,
	type RunMode,
	type TranslationSet,
	type IDatabaseAdapter
} from '$lib/adapters/db';
import { appSettings, setSetting } from './settings';
import { groqApiKey, openaiApiKey } from './secrets';
import { resolveLlmEndpoint } from './llm';
import { playTrack, setAudioLoading } from './audio';
import { refreshLanguageData } from './languageData';
import { VoiceRecorder, type Recording } from '$lib/utils/recorder';
import { transcribeSpeech } from '$lib/adapters/stt/service';
import { evaluateAttempt, generateTranslations, type EvaluationResult } from '$lib/adapters/llm';
import { synthesizeSpeech } from '$lib/adapters/tts/service';
import { base64ToBlob, blobToBase64 } from '$lib/utils/base64';
import { ensurePromptsSeeded, pickRandomPrompt } from '$lib/practice/prompts';
import { requireLanguage, getVoice } from '$lib/languages';
import { MAX_RECORDING_SEC, capWords, countWords } from '$lib/config';
import { toast } from './toast';
import type { ModelProgress } from '$lib/types';

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

function newId(prefix: string): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function update(patch: Partial<PracticeState>): void {
	store.update((state) => ({ ...state, ...patch }));
}

/** Loads the database and seeds the prompt set. Call once on startup. */
export async function initPractice(): Promise<void> {
	db = await getDatabaseAdapter();
	const languageId = get(appSettings).targetLanguage;
	if (languageId) {
		prompts = await ensurePromptsSeeded(db, languageId);
	}
	const state = get(store);
	if (!state.prompt.id && prompts.length > 0) {
		const prompt = pickRandomPrompt(prompts);
		update({ prompt: { id: prompt.id, title: prompt.title, text: prompt.text } });
	}
	if (!state.sessionId) {
		update({ mode: get(appSettings).mode });
	}
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
	if (state.phase !== 'idle' && state.phase !== 'error') return;

	recorder = new VoiceRecorder();
	recorder.onLevel = (level) => update({ level });

	try {
		await recorder.start();
	} catch (error) {
		update({
			phase: 'error',
			error:
				error instanceof Error
					? `Microphone unavailable: ${error.message}`
					: 'Microphone unavailable.'
		});
		recorder = null;
		return;
	}

	update({ phase: 'recording', elapsed: 0, level: 0, error: null, statusText: 'Recording…' });
	const startedAt = performance.now();
	timer = setInterval(() => {
		const elapsed = (performance.now() - startedAt) / 1000;
		update({ elapsed });
		if (elapsed >= MAX_RECORDING_SEC) void stopAndAnalyze();
	}, 250);
}

export function cancelRecording(): void {
	if (timer) clearInterval(timer);
	timer = null;
	recorder?.cancel();
	recorder = null;
	update({ phase: 'idle', elapsed: 0, level: 0, statusText: '' });
}

export async function stopAndAnalyze(): Promise<void> {
	const state = get(store);
	if (state.phase !== 'recording' || !recorder) return;
	if (timer) clearInterval(timer);
	timer = null;

	let recording: Recording;
	try {
		recording = await recorder.stop();
	} catch (error) {
		update({ phase: 'error', error: 'Could not finish the recording.' });
		recorder = null;
		return;
	}
	recorder = null;
	update({ level: 0, phase: 'transcribing', statusText: 'Transcribing…', progress: null });

	const settings = get(appSettings);
	const language = requireLanguage(settings.targetLanguage);

	try {
		const stt = await transcribeSpeech({
			audio16kMono: recording.pcm,
			mode: settings.sttMode,
			languageId: language.id,
			groqApiKey: get(groqApiKey) || undefined,
			onProgress: (progress) => update({ progress, statusText: progress.status })
		});

		update({ phase: 'evaluating', statusText: `Analyzing your ${language.name}…`, progress: null });

		// 60s of fast speech is ~240 words; cap there so a runaway transcript
		// cannot blow the LLM output budget.
		const transcript = capWords(stt.text);

		const evaluation = await evaluateAttempt({
			transcript,
			prompt: get(store).prompt.text,
			mode: get(store).mode,
			level: settings.level,
			language: language.name,
			translationTarget: language.translationTarget,
			endpoint: resolveLlmEndpoint(settings)
		});

		const view = await persistAttempt(recording, transcript, evaluation, get(store).mode);
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
		update({
			phase: 'error',
			statusText: '',
			error: error instanceof Error ? error.message : 'Something went wrong.'
		});
	} finally {
		URL.revokeObjectURL(recording.url);
	}
}

async function persistAttempt(
	recording: Recording,
	transcript: string,
	evaluation: EvaluationResult,
	mode: RunMode
): Promise<AttemptView> {
	if (!db) db = await getDatabaseAdapter();
	const database = db;
	const now = new Date().toISOString();
	const state = get(store);

	let sessionId = state.sessionId;
	if (!sessionId) {
		sessionId = newId('session');
		await database.putSession({
			id: sessionId,
			title: state.prompt.title,
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
		promptId: state.prompt.id || null,
		promptText: state.prompt.text,
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
	update({ error: null, phase: 'idle' });
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
		playTrack({
			attemptId: attempt.id,
			kind,
			segmentIndex: index,
			label: kind === 'segment' ? text : 'Corrected audio',
			url: speech.url
		});
	} catch (error) {
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
		playTrack({ attemptId, kind: 'attempt', label: 'Corrected audio', url: speech.url });
	} catch (error) {
		toast(error instanceof Error ? error.message : 'Could not re-render audio.');
	}
}

/** Synthesizes and plays arbitrary target-language text (used for correction read-back). */
export async function speakText(text: string): Promise<void> {
	if (!text.trim()) return;
	const settings = get(appSettings);
	setAudioLoading(true, { attemptId: '', kind: 'correction', label: text, url: '' });
	try {
		const speech = await synthesizeSpeech({
			text,
			mode: settings.ttsMode,
			languageId: settings.targetLanguage,
			voice: settings.ttsVoice,
			openaiApiKey: get(openaiApiKey) || undefined
		});
		playTrack({ attemptId: '', kind: 'correction', label: text, url: speech.url });
	} catch (error) {
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
	const stored = await db.getAudio(`attempt:${attemptId}`);
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
		await database.replaceCorrections(attempt.id, []);
		await database.deleteAttempt(attempt.id);
	}
	await database.deleteSession(id);
	if (get(store).sessionId === id) {
		update({ sessionId: null, attempts: [], activeAttemptId: null });
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
	update({
		sessionId,
		attempts: views,
		activeAttemptId: latest,
		mode: session?.mode ?? get(store).mode,
		phase: 'idle',
		error: null,
		prompt: session
			? { id: '', title: session.title, text: '' }
			: get(store).prompt
	});
}
