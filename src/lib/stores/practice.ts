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
import { llmConfigured, resolveLlmEndpoint } from './llm';
import { firstMissingRequirement, processingReady } from './processing';
import { playTrack, primeAudioPlayback, setAudioLoading, stopAudio, type AudioKind } from './audio';
import { languageData, refreshLanguageData } from './languageData';
import { pronounceableWords, wordSpeechOptions } from './pronunciation';
import { recordPracticeActivity } from './reminders';
import { VoiceRecorder, type Recording } from '#lib/utils/recorder.js';
import { transcribeSpeech } from '#lib/speech/stt/service.js';
import {
	evaluateAttempt,
	generateTranslations,
	generateSectionGlosses,
	glossSectionOf,
	glossWords,
	hasMeaningAt,
	hasPartOfSpeechAt,
	phraseContext,
	translatePhrase,
	generatePromptTopic,
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
import { ensureEnglishPromptsSeeded, ensurePromptsSeeded, pickRandomPrompt } from '#lib/practice/prompts.js';
import {
	flushPromptSubmissions,
	queuePromptSubmission,
	startPromptSubmissionSync
} from '#lib/practice/promptSubmissions.js';
import { englishPromptTextByTitle } from '#lib/practice/promptCatalogue.js';
import {
	inferSessionSetup,
	parseSessionSetup,
	sameSetup,
	setupFromSettings,
	usableSetup,
	type SessionSetup
} from '#lib/practice/sessionSetup.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	defaultInstructionLanguageFor,
	explanationVoicesFor,
	getExplanationVoice,
	getInstructionLanguage,
	requireLanguage,
	type LanguageDefinition
} from '#lib/languages/index.js';
import { MAX_RECORDING_SEC, capWords, countWords } from '#lib/config.js';
import { useCore } from '#lib/core-client/backend.js';
import { getCoreClient } from '#lib/core-client/client.js';
import { createPracticeHost } from '#lib/core-client/practiceHost.js';
import { practiceApi, type PracticeApi } from '#lib/core-client/practice.js';
import type { CoreClient } from '#lib/core-client/transport.js';
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

let db: IDatabaseAdapter | null = null;
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

function newId(prefix: string): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function update(patch: Partial<PracticeState>): void {
	store.update((state) => ({ ...state, ...patch }));
}

/* ------------------------------------------------------- Core practice --- */

/** True when the practice screen runs on the Rust state machine. */
const corePracticeEnabled = useCore('practice');

let coreClient: CoreClient | null = null;
let coreApi: PracticeApi | null = null;
let coreHost: ReturnType<typeof createPracticeHost> | null = null;
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
		llmEndpoint: (() => {
			const endpoint = resolveLlmEndpoint(settings);
			const host = (() => {
				try {
					return new URL(endpoint.baseUrl).host;
				} catch {
					return endpoint.baseUrl;
				}
			})();
			const provider =
				host === 'api.groq.com' ? 'groq' : host === 'api.deepseek.com' ? 'deepseek' : 'custom';
			return {
				baseUrl: endpoint.baseUrl,
				provider,
				model: endpoint.model,
				fallbackModels: [...(endpoint.fallbackModels ?? [])]
			};
		})(),
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
	if (!corePracticeEnabled) return;
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

/** Handles a host request and the events the core emits for the view. */
async function handleCoreEvent(event: UiEvent): Promise<void> {
	if (event.event === 'host_request') {
		if (!coreHost || !coreClient) return;
		try {
			const result = await coreHost.handle(event.method, JSON.parse(event.payload) as unknown);
			await coreClient.command('core.host_reply', { id: event.id, result });
		} catch (error) {
			await coreClient
				.command('core.host_reply', {
					id: event.id,
					error: {
						code:
							typeof error === 'object' && error !== null && 'code' in error
								? String((error as { code: unknown }).code)
								: 'core.host_failed',
						message: error instanceof Error ? error.message : String(error)
					}
				})
				.catch(() => undefined);
		}
		return;
	}

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
	if (!corePracticeEnabled) throw new Error('The core practice backend is off.');
	coreReady ??= (async () => {
		const client = await getCoreClient();
		coreClient = client;
		coreHost = createPracticeHost(client);
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

async function ensureLegacyDb(): Promise<IDatabaseAdapter> {
	if (!db) db = await getDatabaseAdapter();
	return db;
}

async function hydrateCorePractice(): Promise<void> {
	await ensureCore();
	const database = await ensureLegacyDb();
	// Prompt submissions are driver-side in P3; drain prompts generated earlier.
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
	// Opening the database above also serves the P5 translation/gloss paths.
	void database;
}

async function hydrateLatestSessionCore(): Promise<boolean> {
	const database = await ensureLegacyDb();
	const [newest] = await database.listSessions();
	if (!newest) return false;
	const settings = get(appSettings);
	const setup =
		parseSessionSetup(newest.setup) ??
		inferSessionSetup(await database.listAttempts(newest.id), settings);
	const sameLanguages =
		setup.targetLanguage === settings.targetLanguage &&
		setup.instructionLanguage === settings.instructionLanguage;
	if (!sameLanguages) return false;
	await openSessionCore(newest.id, { restoreSetup: false });
	return true;
}

async function requestPromptCore(): Promise<void> {
	await ensureCore();
	const request = ++promptRequest;
	const database = await ensureLegacyDb();
	const settings = get(appSettings);
	const targetLanguageId = settings.targetLanguage;
	const instructionLanguageId = settings.instructionLanguage ?? DEFAULT_INSTRUCTION_LANGUAGE_ID;
	const stored = await ensurePromptsSeeded(database, targetLanguageId, instructionLanguageId);
	if (request !== promptRequest) return;

	const english = stored.length > 0 ? [] : await ensureEnglishPromptsSeeded(database, targetLanguageId);
	if (request !== promptRequest) return;
	const source = stored.length > 0 ? stored : english;
	await configureCore();
	const response = await coreApi!.nextPrompt(
		source.map((prompt) => ({
			id: prompt.id,
			title: prompt.title,
			text: prompt.text,
			englishFallback: false
		})),
		stored.length === 0
	);
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
	const database = await ensureLegacyDb();
	promptRequest++;
	promptGeneration?.abort();
	const [session, attempts] = await Promise.all([
		database.getSession(sessionId),
		database.listAttempts(sessionId)
	]);

	openSessionSetup = null;
	const recorded = parseSessionSetup(session?.setup);
	const setup = restoreSetup
		? usableSetup(recorded ?? inferSessionSetup(attempts, get(appSettings)))
		: setupFromSettings(get(appSettings));
	if (restoreSetup) await adoptSessionSetup(setup);
	if (session && (!recorded || !sameSetup(recorded, setup))) {
		await database.putSession({ ...session, setup });
	}

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
	const hydrate = corePracticeEnabled ? hydrateCorePractice : hydratePractice;
	initialization ??= hydrate().catch((error) => {
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
	// Drains prompts generated in an earlier session; a no-op while sharing is off.
	startPromptSubmissionSync();
	const state = get(store);
	if (!state.sessionId && state.attempts.length === 0) {
		if (await hydrateLatestSession()) return;
	}
	// The mode guides generation, so it is in place before the first prompt is asked for.
	if (!state.sessionId) {
		update({ mode: get(appSettings).mode });
	}
	if (!state.prompt.id) {
		await requestPrompt();
	}
}

/**
 * Re-reads the newest session after startup or an in-app backup restore, when
 * it was practised in the languages Settings has now: starting the app never
 * changes the learner's languages (a session in other languages stays in
 * History, and opening it from there brings its setup back).
 */
export async function hydrateLatestSession(): Promise<boolean> {
	if (corePracticeEnabled) return hydrateLatestSessionCore();
	if (!db) db = await getDatabaseAdapter();
	const [newest] = await db.listSessions();
	if (!newest) return false;

	const settings = get(appSettings);
	const setup = parseSessionSetup(newest.setup) ?? inferSessionSetup(await db.listAttempts(newest.id), settings);
	const sameLanguages =
		setup.targetLanguage === settings.targetLanguage && setup.instructionLanguage === settings.instructionLanguage;
	if (!sameLanguages) return false;

	await openSession(newest.id, { restoreSetup: false });
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
	// A fresh session starts below: the open one keeps the setup it has.
	openSessionSetup = null;
	setSetting('targetLanguage', language.id);
	useCloudWhereNotLocal(language);
	// Nobody is taught a language in that same language.
	if (get(appSettings).instructionLanguage === language.id) {
		setSetting('instructionLanguage', defaultInstructionLanguageFor(language.id));
	}
	abandonTake();
	update({
		sessionId: null,
		attempts: [],
		activeAttemptId: null,
		phase: 'idle',
		error: null,
		elapsed: 0,
		level: 0,
		prompt: { id: '', title: '', text: '' },
		promptEnglishFallback: false
	});
	if (corePracticeEnabled) {
		void (async () => {
			await ensureCore();
			await configureCore();
			applyCoreSnapshot((await coreApi!.newSession()).snapshot);
		await requestPromptCore();
		})();
	} else {
		nextPrompt();
	}
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
	if (corePracticeEnabled) void configureCore();
}

/** Starts a fresh session (draft): clears attempts and unlocks the mode. */
export function newSession(): void {
	if (corePracticeEnabled) {
		abandonTake();
		openSessionSetup = null;
		void (async () => {
			await ensureCore();
			applyCoreSnapshot((await coreApi!.newSession()).snapshot);
		await requestPromptCore();
		})();
		return;
	}
	abandonTake();
	// The next take starts a session with the setup Settings have then.
	openSessionSetup = null;
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

/**
 * Shows a prompt. `englishFallback` marks an English catalogue entry shown
 * because nothing could be written in the learner's language of instruction.
 */
function showPrompt(prompt: PracticeState['prompt'], englishFallback: boolean): void {
	update({ prompt, promptEnglishFallback: englishFallback });
}

/** Whether the view is between takes, so a prompt arriving now cannot change the one being answered. */
function promptCanChange(): boolean {
	const { phase } = get(store);
	return phase === 'idle' || phase === 'error';
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
	if (corePracticeEnabled) {
		await requestPromptCore();
		return;
	}
	const request = ++promptRequest;
	if (!db) db = await getDatabaseAdapter();
	if (request !== promptRequest) return;

	const settings = get(appSettings);
	const targetLanguageId = settings.targetLanguage;
	const instructionLanguageId = settings.instructionLanguage ?? DEFAULT_INSTRUCTION_LANGUAGE_ID;
	const instructionLanguage = getInstructionLanguage(instructionLanguageId);

	const stored = await ensurePromptsSeeded(db, targetLanguageId, instructionLanguageId);
	if (request !== promptRequest) return;

	const currentId = get(store).prompt.id;

	if (get(llmConfigured)) {
		const generation = new AbortController();
		promptGeneration?.abort();
		promptGeneration = generation;
		try {
			const generated = await generatePromptTopic({
				endpoint: resolveLlmEndpoint(settings),
				instructionLanguage: instructionLanguage.name,
				instructionLanguageId: instructionLanguage.id,
				targetLanguage: requireLanguage(targetLanguageId).name,
				level: settings.level,
				mode: get(store).mode,
				avoidTopics: stored.map((prompt) => prompt.title),
				signal: generation.signal
			});
			if (request !== promptRequest) return;

			const prompt = await storeGeneratedPrompt(generated, targetLanguageId, instructionLanguage.id);
			if (request !== promptRequest) return;

			if (promptCanChange()) {
				showPrompt({ id: prompt.id, title: prompt.title, text: prompt.text }, false);
			}
			return;
		} catch (error) {
			// Offline, out of quota, an aborted superseded request, or an unusable answer:
			// the stored prompts are next. When this request is still the current one,
			// say why instead of leaving the learner to wonder why the prompt is English.
			if (request === promptRequest) {
				const reason = error instanceof Error ? error.message : 'The model did not answer.';
				toast(`Could not write a prompt in ${instructionLanguage.name}: ${reason}`, 5200);
			}
		} finally {
			if (promptGeneration === generation) promptGeneration = null;
		}
		if (request !== promptRequest) return;
	}

	if (stored.length > 0) {
		if (!promptCanChange()) return;
		const prompt = pickRandomPrompt(stored, currentId);
		showPrompt({ id: prompt.id, title: prompt.title, text: prompt.text }, false);
		return;
	}

	const english = await ensureEnglishPromptsSeeded(db, targetLanguageId);
	if (request !== promptRequest) return;

	if (english.length > 0 && promptCanChange()) {
		const prompt = pickRandomPrompt(english, currentId);
		showPrompt({ id: prompt.id, title: prompt.title, text: prompt.text }, true);
	}
}

/** Stores a generated prompt so it can be shown again without another model call. */
async function storeGeneratedPrompt(
	generated: { title: string; text: string },
	targetLanguageId: string,
	instructionLanguageId: string
): Promise<Prompt> {
	const prompt: Prompt = {
		id: newId('prompt'),
		title: generated.title,
		text: generated.text,
		category: 'generated',
		language: targetLanguageId,
		instructionLanguage: instructionLanguageId,
		createdAt: new Date().toISOString()
	};
	await db!.putPrompt(prompt);
	// Opt-out: queued locally first, then sent now or when the device is online.
	await queuePromptSubmission(prompt, get(appSettings));
	void flushPromptSubmissions();
	return prompt;
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
	if (corePracticeEnabled) void configureCore();
	void requestPrompt();
}

/** API read-back options shared by every synthesis call (ElevenLabs or OpenAI-compatible). */
function speechApiOptions(settings: AppSettings) {
	return ttsApiOptions(settings);
}

export async function startRecording(): Promise<void> {
	if (corePracticeEnabled) {
		await startRecordingCore();
		return;
	}
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
	if (corePracticeEnabled) {
		void cancelRecordingCore();
		return;
	}
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
	if (corePracticeEnabled) {
		await stopAndAnalyzeCore();
		return;
	}
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
			updatedAt: now,
			setup: setupFromSettings(get(appSettings))
		});
		openSessionSetup = { sessionId, setup: setupFromSettings(get(appSettings)) };
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
	// The take is safely stored; a reminder from before it should not linger.
	recordPracticeActivity(new Date(now));

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
	if (corePracticeEnabled) {
		void setActiveAttemptCore(id);
		return;
	}
	update({ activeAttemptId: id });
	// The take being read is prepared before the rest.
	if (id) prepareTakeAudio(id, { first: true });
}

export function clearError(): void {
	if (corePracticeEnabled) {
		void clearErrorCore();
		return;
	}
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

	if (corePracticeEnabled) {
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
	if (corePracticeEnabled) {
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
		})();
	}
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

	if (corePracticeEnabled) {
		const key = glossJobKey(attemptId, text);
		const running = glossJobs.get(key);
		if (running) return running;
		const job = (async () => {
			await ensureCore();
			const client = await getCoreClient();
			const response = await client.command<{
				key: string;
				glosses: TextGlosses;
			}>('glosses.ensure', { attemptId, text, wordIndex, withPos: get(appSettings).showWordPos });
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

	const settings = get(appSettings);
	const existing = wordGlossesFor(attempt, text);
	const needsPos = settings.showWordPos && !hasPartOfSpeechAt(existing, wordIndex);
	const section = glossSectionOf(text, wordIndex);
	if (!section || (hasMeaningAt(existing, wordIndex) && !needsPos)) return Promise.resolve();

	const jobKey = `${glossJobKey(attemptId, text)}:${section.start}`;
	const running = glossJobs.get(jobKey);
	if (running) return running;

	const job = (async () => {
		const fetched = await generateSectionGlosses(text, section, resolveLlmEndpoint(settings), teachingLanguages(settings), {
			withPos: settings.showWordPos,
			signal: undefined
		});

		// Merged into what is saved now: other sections and selections may have arrived meanwhile.
		const key = glossKey(text);
		const current = get(store).attempts.find((item) => item.id === attemptId);
		const saved = current?.wordGlosses[key];
		const wordCount = glossWords(text).length;
		const words = Array.from({ length: wordCount }, (_, index) =>
			index >= section.start && index <= section.end ? fetched.words[index - section.start] : (saved?.words[index] ?? '')
		);
		// Merge POS in the same way as words, keeping any already-saved values.
		const pos = fetched.pos !== undefined
			? Array.from({ length: wordCount }, (_, index) =>
					index >= section.start && index <= section.end ? (fetched.pos![index - section.start] ?? '') : (saved?.pos?.[index] ?? '')
			  )
			: saved?.pos;
		// A section asked for POS is remembered even when the model left labels
		// blank, so a word without one does not trigger another paid request.
		const posSections = fetched.pos !== undefined
			? [...(saved?.posSections ?? []).filter((range) => range.start !== section.start || range.end !== section.end), section]
			: saved?.posSections;
		// Re-requesting a section replaces its expressions but keeps selections.
		const phrases = [
			...(saved?.phrases ?? []).filter(
				(phrase) => phrase.origin === 'selection' || phrase.end < section.start || phrase.start > section.end
			),
			...fetched.phrases
		];
		const merged = {
			words,
			phrases,
			...(saved?.sections
				? { sections: [...saved.sections.filter((range) => range.start !== section.start || range.end !== section.end), section] }
				: {}),
			...(pos ? { pos } : {}),
			...(posSections ? { posSections } : {})
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
	if (corePracticeEnabled) {
		await ensureCore();
		applyCoreSnapshot((await coreApi!.setAttemptVoice(attemptId, voice)).snapshot);
	}
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
	if (corePracticeEnabled) {
		await renameSessionCore(id, title);
		return;
	}
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
	if (corePracticeEnabled) {
		await deleteSessionCore(id);
		return;
	}
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
		openSessionSetup = null;
		update({ sessionId: null, attempts: [], activeAttemptId: null, phase: 'idle', elapsed: 0, level: 0 });
	}
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
	if (corePracticeEnabled) {
		await openSessionCore(sessionId, { restoreSetup });
		return;
	}
	// A prompt still being written for the previous view must not land on this session.
	promptRequest++;
	promptGeneration?.abort();
	if (!db) db = await getDatabaseAdapter();
	const [session, attempts] = await Promise.all([
		db.getSession(sessionId),
		db.listAttempts(sessionId)
	]);

	// Settings change below: the session being left must not take them on.
	openSessionSetup = null;
	const recorded = parseSessionSetup(session?.setup);
	const setup = restoreSetup
		? usableSetup(recorded ?? inferSessionSetup(attempts, get(appSettings)))
		: setupFromSettings(get(appSettings));
	if (restoreSetup) await adoptSessionSetup(setup);
	if (session && (!recorded || !sameSetup(recorded, setup))) {
		await db.putSession({ ...session, setup });
	}

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
		prompt,
		promptEnglishFallback: false
	});
	openSessionSetup = { sessionId, setup };
	// After the view holds the takes: preparing reads them from it.
	prepareSessionAudio(views);
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

async function saveSessionSetup(sessionId: string, setup: SessionSetup): Promise<void> {
	if (!db) db = await getDatabaseAdapter();
	const session = await db.getSession(sessionId);
	if (session) await db.putSession({ ...session, setup, updatedAt: new Date().toISOString() });
}

appSettings.subscribe(keepOpenSessionSetupCurrent);

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
	// Sessions from before prompts were stored keep only their title.
	const text = englishPromptTextByTitle(session.title);
	return { id: '', title: session.title, text: text ?? session.title };
}
