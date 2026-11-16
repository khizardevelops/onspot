// SPDX-License-Identifier: AGPL-3.0-or-later

import { derived, get, writable } from 'svelte/store';
import {
	type Correction,
	type RunMode,
	type FollowUp,
	type TextGlosses,
	type TranslationSet,
	type WordGlosses,
	TRANSLATION_SET_VERSION
} from '#lib/adapters/db/index.js';
import { appSettings, setSetting, settingsReady, type AppSettings } from './settings';
import { ttsApiOptions } from './ttsConfig';
import { coreLlmEndpoint, llmConfigured } from './llm';
import { firstMissingRequirement, processingReady } from './processing';
import { playTrack, primeAudioPlayback, setAudioLoading, type AudioKind } from './audio';
import { languageData, refreshLanguageData } from './languageData';
import { pronounceableWords, wordSpeechOptions } from './pronunciation';
import { recordPracticeActivity } from './reminders';
import { separateFollowUp, speakableExplanation } from '#lib/adapters/llm/index.js';
import {
	preloadLocalVoice,
	isStoppedClip,
	synthesizeExplanation,
	synthesizeSpeech,
	type ExplanationSpeechOptions,
	type SpeechResult,
	type SynthesizeOptions
} from '#lib/speech/tts/service.js';
import { base64ToBlob } from '#lib/utils/base64.js';
import { startPromptSubmissionSync } from '#lib/practice/promptSubmissions.js';
import { sameSetup, setupFromSettings, type SessionSetup } from '#lib/practice/sessionSetup.js';
import {
	getAudio,
	latestSessionSetup,
	openSessionSetup as openSessionSetupCore,
	saveSessionSetup
} from '#lib/core-client/records.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	defaultInstructionLanguageFor,
	explanationVoicesFor,
	getExplanationVoice,
	getInstructionLanguage,
	requireLanguage,
	type LanguageDefinition
} from '#lib/languages/index.js';
import { MAX_RECORDING_SEC } from '#lib/config.js';
import { getCoreClient, getCoreHost } from '#lib/core-client/client.js';
import type { CoreHost } from '#lib/core-client/coreHost.js';
import { practiceApi, type PracticeApi } from '#lib/core-client/practice.js';
import type {
	PracticeConfig,
	PracticeSnapshot as CorePracticeSnapshot,
	UiEvent
} from '../core-client/types.gen';
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
	/**
	 * True when the prompt is an English catalogue entry because nothing could
	 * be written in the learner's language of instruction, so the UI says so.
	 */
	promptEnglishFallback: boolean;
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
	promptEnglishFallback: false,
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

/*
 * The session mode is the app's accent colour (Exam red, Casual blue: the
 * [data-mode] tokens in app.css). Mirrored onto <html> here, so every page
 * follows the live mode, not only the practice screen.
 */
if (typeof document !== 'undefined') {
	store.subscribe(({ mode }) => {
		document.documentElement.dataset.mode = mode;
	});
}

const glossJobs = new Map<string, Promise<void>>();
const phraseJobs = new Map<string, Promise<string>>();
let initialization: Promise<void> | null = null;
/** Latest read-back request; an older synthesis that finishes later must not play over it. */
let speechRequest = 0;
/** Latest prompt request; a slow model answer must not replace a newer prompt. */
let promptRequest = 0;
/** The model call behind the latest prompt request, stopped when a newer one starts. */
let promptGeneration: AbortController | null = null;

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

function update(patch: Partial<PracticeState>): void {
	store.update((state) => ({ ...state, ...patch }));
}

/* ------------------------------------------------------- Core practice --- */

let coreApi: PracticeApi | null = null;
let coreHost: CoreHost | null = null;
let coreReady: Promise<void> | null = null;
let coreTimer: ReturnType<typeof setInterval> | null = null;

/** Today's learner-facing copy for each stable core error code (I6). */
function coreErrorCopy(error: { code: string; message: string } | null): string | null {
	if (!error) return null;
	switch (error.code) {
		case 'practice.take_silent':
			return 'No speech was heard in that take. Check that the right microphone is selected and unmuted, then try again.';
		case 'practice.microphone_unavailable':
			return `Microphone unavailable: ${error.message}`;
		case 'practice.recording_failed':
			return 'Could not finish the recording.';
		case 'practice.transcription_failed':
		case 'practice.evaluation_failed':
		case 'practice.speech_failed':
			return error.message;
		default:
			return error.message;
	}
}

function coreConfig(): PracticeConfig {
	const settings = get(appSettings);
	const target = requireLanguage(settings.targetLanguage);
	const instruction = getInstructionLanguage(settings.instructionLanguage);
	return {
		targetLanguageId: target.id,
		targetLanguageName: target.name,
		instructionLanguageId: instruction.id,
		instructionLanguageName: instruction.name,
		level: settings.level,
		mode: settings.mode,
		ttsMode: settings.ttsMode,
		sttMode: settings.sttMode,
		ttsVoice: settings.ttsVoice,
		explanationVoice: settings.explanationVoice,
		pace: settings.targetSpeechPace,
		explanationAudioAvailable: get(explanationAudioAvailable),
		llmConfigured: get(llmConfigured),
		llmEndpoint: coreLlmEndpoint(settings),
		maxSeconds: MAX_RECORDING_SEC
	};
}

/** Replaces the view with a core snapshot, keeping P5-only fields already shown. */
function applyCoreSnapshot(snapshot: CorePracticeSnapshot): void {
	const before = new Map(get(store).attempts.map((attempt) => [attempt.id, attempt]));
	const attempts: AttemptView[] = snapshot.attempts.map(({ attempt, corrections }) => {
		const previous = before.get(attempt.id);
		return {
			id: attempt.id,
			transcript: attempt.transcript,
			correctedText: attempt.correctedText ?? '',
			translation: previous?.translation ?? attempt.translation ?? '',
			translations: previous?.translations ?? (attempt.translations as unknown as TranslationSet | null),
			explanation: attempt.explanation ?? '',
			followUp: (attempt.followUp as unknown as FollowUp | null) ?? null,
			wordGlosses:
				previous?.wordGlosses ??
				(attempt.wordGlosses as unknown as WordGlosses | null) ??
				{},
			corrections: corrections as unknown as Correction[],
			durationSec: attempt.durationSec,
			wordCount: attempt.wordCount,
			createdAt: attempt.createdAt,
			audioUrl: previous?.audioUrl ?? null,
			ttsVoice: previous?.ttsVoice ?? attempt.ttsVoice ?? null
		};
	});

	update({
		phase: snapshot.phase,
		prompt: {
			id: snapshot.prompt.id,
			title: snapshot.prompt.title,
			text: snapshot.prompt.text
		},
		promptEnglishFallback: snapshot.prompt.englishFallback,
		mode: snapshot.mode as RunMode,
		elapsed: snapshot.elapsedSeconds,
		level: snapshot.level,
		progress: snapshot.progress,
		statusText: snapshot.statusText,
		error: coreErrorCopy(snapshot.error),
		sessionId: snapshot.sessionId,
		attempts,
		activeAttemptId: snapshot.activeAttemptId
	});
	syncCoreTimer();
}

/** The bridge timer ticks at the legacy 250 ms cadence; the core enforces 60 s. */
function syncCoreTimer(): void {
	if (get(store).phase === 'recording') {
		coreTimer ??= setInterval(() => {
			void tickCore();
		}, 250);
	} else if (coreTimer) {
		clearInterval(coreTimer);
		coreTimer = null;
	}
}

async function tickCore(): Promise<void> {
	if (!coreApi) return;
	try {
		applyCoreSnapshot((await coreApi.tick()).snapshot);
	} catch {
		if (coreTimer) clearInterval(coreTimer);
		coreTimer = null;
	}
}

/** Applies the events the core emits for the practice view. */
async function handleCoreEvent(event: UiEvent): Promise<void> {
	// Host requests are answered by the shared client host (`core-client/client.ts`)
	// before they reach this view listener.
	switch (event.event) {
		case 'practice_state_changed':
			applyCoreSnapshot(event.snapshot);
			break;
		case 'audio_level':
			update({ level: event.level });
			break;
		case 'transcription_progress':
			update({
				progress: { progress: event.progress, status: event.status },
				statusText: event.status
			});
			break;
		case 'attempt_persisted':
			recordPracticeActivity();
			prepareTakeAudio(event.attempt_id, { first: true });
			break;
		case 'take_silent':
			break;
		case 'speak_track':
			void playAttemptTrack(event.attempt_id, event.kind as AttemptTrackKind);
			break;
		case 'play_segment':
			void playSegment(event.attempt_id, event.text, event.index);
			break;
		case 'speak_text':
			void speakText(event.text);
			break;
		case 'play_recording':
			void playStoredAudio(event.attempt_id);
			break;
		case 'glosses_ready':
			update({
				attempts: get(store).attempts.map((attempt) =>
					attempt.id === event.attempt_id
						? {
								...attempt,
								wordGlosses: {
									...attempt.wordGlosses,
									[event.key]: event.glosses as unknown as TextGlosses
								}
							}
						: attempt
				)
			});
			break;
		case 'phrase_ready':
			break;
		case 'translations_ready':
			update({
				attempts: get(store).attempts.map((attempt) =>
					attempt.id === event.attempt_id
						? {
								...attempt,
								translation: event.translations.idiomatic,
								translations: event.translations as unknown as TranslationSet
							}
						: attempt
				)
			});
			break;
		default:
			break;
	}
}

/** Boots the bridge once and installs the practice host before any command. */
async function ensureCore(): Promise<void> {
	coreReady ??= (async () => {
		const client = await getCoreClient();
		coreHost = await getCoreHost();
		coreApi = practiceApi(client);
		client.subscribe((event) => {
			void handleCoreEvent(event);
		});
		await configureCore();
	})().catch((error) => {
		coreReady = null;
		throw error;
	});
	return coreReady;
}

/** Sends the current settings snapshot to the core and paints its answer. */
async function configureCore(): Promise<void> {
	if (!coreApi) return;
	applyCoreSnapshot((await coreApi.configure(coreConfig())).snapshot);
}

async function hydrateCorePractice(): Promise<void> {
	await ensureCore();
	// Send prompts generated earlier that were not shared yet.
	startPromptSubmissionSync();
	const state = get(store);
	if (!state.sessionId && state.attempts.length === 0) {
		if (await hydrateLatestSessionCore()) return;
	}
	if (!get(store).sessionId) {
		update({ mode: get(appSettings).mode });
	}
	if (!get(store).prompt.id) {
		await requestPromptCore();
	}
}

/** Reopens the newest session at startup, when it is in the languages Settings has now. */
async function hydrateLatestSessionCore(): Promise<boolean> {
	const latest = await latestSessionSetup();
	if (!latest) return false;
	const settings = get(appSettings);
	const sameLanguages =
		latest.setup.targetLanguage === settings.targetLanguage &&
		latest.setup.instructionLanguage === settings.instructionLanguage;
	if (!sameLanguages) return false;
	await openSessionCore(latest.sessionId, { restoreSetup: false });
	return true;
}

async function requestPromptCore(): Promise<void> {
	await ensureCore();
	const request = ++promptRequest;
	await configureCore();
	const response = await coreApi!.nextPrompt();
	if (request !== promptRequest) return;
	applyCoreSnapshot(response.snapshot);
}

async function startRecordingCore(): Promise<void> {
	await ensureCore();
	const state = get(store);
	if (state.phase !== 'idle' && state.phase !== 'error') return;
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
	// Still inside the learner's tap, so the reply may play by itself.
	primeAudioPlayback();
	await configureCore();
	try {
		applyCoreSnapshot((await coreApi!.startRecording()).snapshot);
	} catch (error) {
		update({
			phase: 'error',
			error: error instanceof Error ? `Microphone unavailable: ${error.message}` : 'Microphone unavailable.'
		});
	}
}

async function stopAndAnalyzeCore(): Promise<void> {
	await ensureCore();
	primeAudioPlayback();
	applyCoreSnapshot((await coreApi!.stopAndAnalyze()).snapshot);
}

async function cancelRecordingCore(): Promise<void> {
	await ensureCore();
	coreHost?.cancel();
	applyCoreSnapshot((await coreApi!.cancelRecording()).snapshot);
}

async function setActiveAttemptCore(id: string | null): Promise<void> {
	await ensureCore();
	applyCoreSnapshot((await coreApi!.setActiveAttempt(id)).snapshot);
	if (id) prepareTakeAudio(id, { first: true });
}

async function clearErrorCore(): Promise<void> {
	await ensureCore();
	applyCoreSnapshot((await coreApi!.clearError()).snapshot);
}

async function openSessionCore(
	sessionId: string,
	{ restoreSetup = true } = {}
): Promise<void> {
	await ensureCore();
	promptRequest++;
	promptGeneration?.abort();

	openSessionSetup = null;
	// The core works out the setup (recorded, inferred, or the current
	// settings) and saves it on the session; Settings take it on here.
	const setup = (await openSessionSetupCore(sessionId, restoreSetup)) ?? setupFromSettings(get(appSettings));
	if (restoreSetup) await adoptSessionSetup(setup);

	await configureCore();
	const response = await coreApi!.openSession(sessionId);
	applyCoreSnapshot(response.snapshot);
	openSessionSetup = { sessionId, setup };
	prepareSessionAudio(get(store).attempts);
}

async function renameSessionCore(id: string, title: string): Promise<void> {
	await ensureCore();
	await coreApi!.renameSession(id, title);
}

async function deleteSessionCore(id: string): Promise<void> {
	await ensureCore();
	await coreApi!.deleteSession(id);
	applyCoreSnapshot((await coreApi!.snapshot()).snapshot);
}

/**
 * Loads persisted practice data exactly once. A browser refresh creates a new
 * Svelte store, so rehydrate the newest saved session instead of
 * presenting an empty draft while History still contains the learner's work.
 */
export function initPractice(): Promise<void> {
	initialization ??= hydrateCorePractice().catch((error) => {
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

/**
 * Re-reads the newest session after startup or an in-app backup restore, when
 * it was practised in the languages Settings has now: starting the app never
 * changes the learner's languages (a session in other languages stays in
 * History, and opening it from there brings its setup back).
 */
export async function hydrateLatestSession(): Promise<boolean> {
	return hydrateLatestSessionCore();
}

/**
 * Switches the language being studied: persists the choice, reseeds that
 * language's prompts and starts a fresh session. The download itself stays
 * manual so a mis-click never commits the user to a large transfer.
 */
export async function setTargetLanguage(languageId: string): Promise<void> {
	const language = requireLanguage(languageId);
	// A fresh session starts below: the open one keeps the setup it has.
	openSessionSetup = null;
	setSetting('targetLanguage', language.id);
	useCloudWhereNotLocal(language);
	// Nobody is taught a language in that same language.
	if (get(appSettings).instructionLanguage === language.id) {
		setSetting('instructionLanguage', defaultInstructionLanguageFor(language.id));
	}
	void (async () => {
		await ensureCore();
		await configureCore();
		applyCoreSnapshot((await coreApi!.newSession()).snapshot);
		await requestPromptCore();
	})();
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
	void configureCore();
}

/** Starts a fresh session (draft): clears attempts and unlocks the mode. */
export function newSession(): void {
	openSessionSetup = null;
	void (async () => {
		await ensureCore();
		applyCoreSnapshot((await coreApi!.newSession()).snapshot);
		await requestPromptCore();
	})();
}

/**
 * Shows a new prompt for the current languages.
 *
 * The learner's own LLM writes it in their language of instruction and it is
 * stored for next time. Without a model, or when it fails or repeats a recent
 * topic, the stored prompts for that pair are used; when there are none, the
 * English catalogue is the last resort and the UI says it is in English.
 */
export async function requestPrompt(): Promise<void> {
	await requestPromptCore();
}

/** Shows a new prompt; the model call runs in the background. */
export function nextPrompt(): void {
	void requestPrompt();
}

/**
 * Changes the instruction language. A draft gets a prompt written in the new
 * language right away; a session with takes keeps the prompt it was recorded
 * with, and the new language applies from the next prompt on.
 */
export function setInstructionLanguage(languageId: string): void {
	setSetting('instructionLanguage', languageId);
	const state = get(store);
	if (state.sessionId || state.attempts.length > 0) return;
	void configureCore();
	void requestPrompt();
}

/** API read-back options shared by every synthesis call (ElevenLabs or OpenAI-compatible). */
function speechApiOptions(settings: AppSettings) {
	return ttsApiOptions(settings);
}

export async function startRecording(): Promise<void> {
	await startRecordingCore();
}

/** Discards the take in progress: stops the microphone, or abandons its analysis. */
export function cancelRecording(): void {
	void cancelRecordingCore();
}

export async function stopAndAnalyze(): Promise<void> {
	await stopAndAnalyzeCore();
}

export function setActiveAttempt(id: string | null): void {
	void setActiveAttemptCore(id);
}

export function clearError(): void {
	void clearErrorCore();
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

	return (async () => {
		await ensureCore();
		const client = await getCoreClient();
		const response = await client.command<{ translations: TranslationSet }>(
			'translations.ensure',
			{ attemptId }
		);
		const translations = response.translations;
		update({
			attempts: get(store).attempts.map((item) =>
				item.id === attemptId
					? { ...item, translation: translations.idiomatic, translations }
					: item
			)
		});
		return translations;
	})();
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
 * Meanings saved before word meanings were asked for by word number
 * (2026-11-02) may be shifted by a word: the model's plain list was matched by
 * position, and one skipped word moved every meaning after it (see
 * `alignedGlosses`). They are left unread under their old keys, and fetched
 * again on the next hover.
 */
const GLOSS_KEY_PREFIX = 'numbered';

/**
 * Where a text's hover meanings are kept on its attempt: per language of
 * instruction, so a change of language fetches new ones.
 */
function glossKey(text: string, instructionLanguage = get(appSettings).instructionLanguage): string {
	const textKey = instructionLanguage === DEFAULT_INSTRUCTION_LANGUAGE_ID ? hashText(text) : `${instructionLanguage}:${hashText(text)}`;
	return `${GLOSS_KEY_PREFIX}:${textKey}`;
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
		await ensureCore();
		const client = await getCoreClient();
		const response = await client.command<{ meaning: string }>('phrases.ensure', {
			attemptId,
			text,
			start,
			end,
			phrase
		});
		const key = glossKey(text);
		update({
			attempts: get(store).attempts.map((item) => {
				if (item.id !== attemptId) return item;
				const current = item.wordGlosses[key] ?? { words: [], phrases: [] };
				return {
					...item,
					wordGlosses: {
						...item.wordGlosses,
						[key]: {
							...current,
							phrases: [
								...current.phrases,
								{ start, end, meaning: response.meaning, origin: 'selection' as const }
							]
						}
					}
				};
			})
		});
		return response.meaning;
	})().finally(() => phraseJobs.delete(jobKey));
	phraseJobs.set(jobKey, job);
	return job;
}

/**
 * Fetches the hover translations of a text the learner points at, in one LLM
 * call through the core, which saves them on the attempt so later hovers are
 * instant and work offline. The other text (transcript or correct version)
 * is fetched only if they point at it too. Concurrent hovers on one text
 * share one request.
 *
 * @param attemptId The attempt whose words were hovered.
 * @param text The transcript or the correct version.
 * @throws With a readable message when the LLM call fails.
 */
export function ensureWordGlosses(attemptId: string, text: string): Promise<void> {
	const attempt = get(store).attempts.find((item) => item.id === attemptId);
	if (!attempt) return Promise.reject(new Error('Attempt not found.'));

	const key = glossJobKey(attemptId, text);
	const running = glossJobs.get(key);
	if (running) return running;
	const job = (async () => {
		await ensureCore();
		const client = await getCoreClient();
		const response = await client.command<{
			key: string;
			glosses: TextGlosses;
		}>('glosses.ensure', { attemptId, text, withPos: get(appSettings).showWordPos });
		update({
			attempts: get(store).attempts.map((item) =>
				item.id === attemptId
					? {
							...item,
							wordGlosses: {
								...item.wordGlosses,
								[response.key]: response.glosses as unknown as TextGlosses
							}
						}
					: item
			)
		});
	})().finally(() => glossJobs.delete(key));
	glossJobs.set(key, job);
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
 *
 * The take being read also gets its words prepared, right after its
 * explanation: each word of the correct version and of the follow-up
 * question, so tapping one plays at once instead of waiting seconds for the voice. Only that take:
 * preparing every word of a whole session would keep the device busy for long.
 */
const preparationQueue: string[] = [];
let preparing = false;

/** Takes whose words are prepared too: the ones that went to the front of the queue (new, or being read). */
const takesWithWords = new Set<string>();

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
	if (first) {
		preparationQueue.unshift(attemptId);
		takesWithWords.add(attemptId);
	} else {
		preparationQueue.push(attemptId);
	}

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

	// The words a learner taps, right after the explanation (which plays first anyway): a
	// tap is the one wait a learner feels, and the sentence clips can follow while they read.
	// Made with the options a tap uses, so a tap finds them stored.
	if (takesWithWords.has(attemptId)) {
		const tappableText = `${trackText(attempt, 'corrected')} ${trackText(attempt, 'followUp')}`;
		for (const word of pronounceableWords(tappableText)) {
			clips.push((signal) => synthesizeSpeech({ ...wordSpeechOptions(word, settings), background: true, signal }));
		}
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
	await ensureCore();
	applyCoreSnapshot((await coreApi!.setAttemptVoice(attemptId, voice)).snapshot);
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
	const request = ++speechRequest;
	const stored = await getAudio(`attempt:${attemptId}`);
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
	await renameSessionCore(id, title);
}

/**
 * Deletes a session and everything under it.
 *
 * Attempts, corrections and audio are removed explicitly rather than relying on
 * `ON DELETE CASCADE`, because the Tauri plugin may run each statement on a
 * different pooled connection where `PRAGMA foreign_keys` was not set.
 */
export async function deleteSession(id: string): Promise<void> {
	await deleteSessionCore(id);
}

/**
 * Loads a session's attempts from the database into the view, and puts the
 * session's setup (languages, speech mode, voices, pace) back into Settings,
 * so its takes are read, translated and explained as they were practised.
 *
 * @param options.restoreSetup False at startup: Settings stay as they are,
 *   and the session takes them on (`hydrateLatestSession` only opens a
 *   session in the same languages).
 */
export async function openSession(sessionId: string, { restoreSetup = true } = {}): Promise<void> {
	await openSessionCore(sessionId, { restoreSetup });
}

// ---------------------------------------------------------- Session setup ---

/** The open session and the setup it was recorded with; null while none is open (or one is being opened). */
let openSessionSetup: { sessionId: string; setup: SessionSetup } | null = null;

/**
 * Moves the steps a language cannot run on the device (no approved local
 * engine) to Cloud.
 */
function useCloudWhereNotLocal(language: LanguageDefinition): void {
	if (!language.local.stt) setSetting('sttMode', 'cloud');
	if (!language.local.tts) setSetting('ttsMode', 'cloud');
	if (!language.local.correction) setSetting('correctionMode', 'cloud');
}

/**
 * Puts a session's setup into Settings, as choosing its languages and voices
 * by hand would, and says so when the languages change.
 */
async function adoptSessionSetup(setup: SessionSetup): Promise<void> {
	const before = get(appSettings);
	const language = requireLanguage(setup.targetLanguage);

	if (before.targetLanguage !== setup.targetLanguage) {
		setSetting('targetLanguage', setup.targetLanguage);
	}
	if (before.instructionLanguage !== setup.instructionLanguage) setSetting('instructionLanguage', setup.instructionLanguage);
	setSetting('ttsMode', setup.ttsMode);
	useCloudWhereNotLocal(language);
	if (setup.ttsVoice) setSetting('ttsVoice', setup.ttsVoice);
	if (setup.explanationVoice) setSetting('explanationVoice', setup.explanationVoice);
	setSetting('targetSpeechPace', setup.targetSpeechPace);

	const languagesChanged =
		before.targetLanguage !== setup.targetLanguage || before.instructionLanguage !== setup.instructionLanguage;
	if (languagesChanged) {
		const instruction = getInstructionLanguage(setup.instructionLanguage);
		toast(`This session is in ${language.name}, taught in ${instruction.name}: Settings now match it.`, 4200);
	}
}

/** Waits this long after a change in Settings before saving it to the open session. */
const SETUP_SAVE_DELAY_MS = 800;
let setupSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keeps the open session's setup current: a voice, pace or language of
 * instruction chosen while it is open becomes its setup. A change of the
 * studied language starts a new session instead (`setTargetLanguage`).
 */
function keepOpenSessionSetupCurrent(settings: AppSettings): void {
	const open = openSessionSetup;
	if (!open || settings.targetLanguage !== open.setup.targetLanguage) return;

	const current = setupFromSettings(settings);
	if (sameSetup(current, open.setup)) return;
	openSessionSetup = { sessionId: open.sessionId, setup: current };

	if (setupSaveTimer) clearTimeout(setupSaveTimer);
	setupSaveTimer = setTimeout(() => void saveSessionSetup(open.sessionId, current), SETUP_SAVE_DELAY_MS);
}


appSettings.subscribe(keepOpenSessionSetupCurrent);
