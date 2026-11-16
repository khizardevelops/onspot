// SPDX-License-Identifier: AGPL-3.0-or-later

import { writable } from 'svelte/store';
import type { RunMode } from '#lib/adapters/db/index.js';
import { getCoreClient } from '#lib/core-client/client.js';
import type { AppSettings as CoreAppSettings } from '#lib/core-client/types.gen.js';
import type { LlmModelId, LlmProviderId } from '#lib/adapters/llm/index.js';
import { AUTOMATIC_MODEL } from '#lib/adapters/llm/index.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	DEFAULT_LANGUAGE_ID,
	NEUTRAL_TUNING,
	getExplanationVoice,
	getLanguage,
	getVoice,
	type VoiceTuning
} from '#lib/languages/index.js';
import { DEFAULT_ELEVENLABS_VOICE_ID } from '#lib/speech/tts/cloud/elevenLabsVoices.js';

/**
 * Non-secret preferences, persisted in the database so they sync with the
 * learner's data. Secrets live in `stores/secrets.ts` instead.
 */
export interface AppSettings {
	/** CEFR level used in the LLM prompt. */
	level: string;
	/** Practice tone: formal exam vs casual. */
	mode: RunMode;
	/** Local Whisper or BYOK cloud transcription. */
	sttMode: 'local' | 'cloud';
	/** Local Piper or an OpenAI-compatible speech API. */
	ttsMode: 'local' | 'cloud';
	/** Local TTS voice id from the registry. */
	ttsVoice: string;
	/**
	 * The read-back voice last chosen for each studied language, by language
	 * code, so switching back to a language brings its voice back
	 * (`withRememberedVoices`).
	 */
	targetVoiceByLanguage: Record<string, string>;
	/**
	 * How fast the target-language voice speaks on the device, as a share of
	 * its natural pace (`SPEECH_PACES`): read-back, tapped words and the
	 * target-language words of explanations. Slower helps a learner follow.
	 */
	targetSpeechPace: number;
	/** Correction endpoint: a cloud provider or a local OpenAI-compatible server. */
	correctionMode: 'cloud' | 'local';
	/** Local correction server, e.g. LM Studio, llama.cpp or Ollama. */
	localLlmUrl: string;
	localLlmModel: string;
	/** Cloud read-back provider. Both stay fully supported. */
	ttsCloudProvider: 'elevenlabs' | 'openai';
	/** ElevenLabs model and voice, kept independently of the OpenAI settings. */
	elevenLabsModel: string;
	elevenLabsVoiceId: string;
	/** OpenAI-compatible endpoint, model and voice (also used by local servers). */
	ttsApiBaseUrl: string;
	ttsApiModel: string;
	ttsApiVoice: string;
	llmProvider: LlmProviderId;
	/**
	 * The model for Groq and DeepSeek: `AUTOMATIC_MODEL` lets onspot choose per
	 * request (by the languages, the request's size and each model's limits);
	 * a model id pins that model.
	 */
	llmModel: LlmModelId;
	/** Base URL for the custom OpenAI-compatible provider. */
	customBaseUrl: string;
	/** Model name for the custom provider (free text). */
	customModel: string;
	/**
	 * The on-device voice for the English of explanations (see
	 * `explanationVoicesFor`); its target-language words keep `ttsVoice`.
	 * Empty until the learner picks one.
	 */
	explanationVoice: string;
	/** The explanation voice last chosen for each language of instruction, by language code. */
	explanationVoiceByLanguage: Record<string, string>;
	targetLanguage: string;
	/**
	 * The language the learner is taught in (`INSTRUCTION_LANGUAGES`):
	 * explanations, translations and word meanings are written in it.
	 */
	instructionLanguage: string;
	/** Which BYOC destination the learner configured, if any. */
	syncProvider: 'off' | 'google-drive' | 'webdav';
	/** WebDAV collection URL, without the backup path. */
	webdavUrl: string;
	/** WebDAV path of the snapshot inside the collection. */
	webdavPath: string;
	/**
	 * Advanced per-voice audio adjustments (volume/EQ) layered on top of each
	 * voice's approved processing profile. Keyed by voice id; absent = neutral.
	 */
	voiceTunings: Record<string, VoiceTuning>;
	/** A gentle nudge to practise after a gap; off until the learner asks for it. */
	practiceReminders: boolean;
	/** How often reminders may appear: about daily, or every few days. */
	reminderFrequency: 'frequent' | 'infrequent';
	/**
	 * When true, word-hover tooltips show the word's part of speech (noun, verb,
	 * adjective, etc.) on a second line below the translation.
	 */
	showWordPos: boolean;
	/**
	 * Share generated speaking prompts (title, task, languages, level, mode)
	 * with the shared prompt database. On by default; turning it off stops all
	 * queueing and sending, and prompts generated while it is off stay local.
	 */
	promptContributions: boolean;
}

/**
 * Compile-time guard: every core document field must also exist in the store's
 * narrower view (whose choices are unions). Regenerate `types.gen.ts` after a
 * Rust field change and this fails until the store is updated.
 */
type SettingsDocumentCoverage = AppSettings extends CoreAppSettings ? true : never;
const settingsDocumentCoverage: SettingsDocumentCoverage = true;
void settingsDocumentCoverage;

/**
 * The speaking paces a learner can choose for the target-language voice, as
 * shares of the voice's natural pace. The voices slow down when they make the
 * audio (Supertonic's duration, Piper's length scale), which sounds natural,
 * unlike slowing a clip down when it plays.
 */
export const SPEECH_PACES = [0.8, 0.9, 1, 1.1] as const;

/** A little slower than natural: the user found the voices' natural pace too fast to follow (2026-11-08). */
export const DEFAULT_TARGET_SPEECH_PACE = 0.9;

export const DEFAULT_SETTINGS: AppSettings = {
	level: 'B1',
	mode: 'exam',
	sttMode: 'local',
	ttsMode: 'local',
	ttsVoice: 'piper-tom-medium',
	targetVoiceByLanguage: {},
	targetSpeechPace: DEFAULT_TARGET_SPEECH_PACE,
	correctionMode: 'cloud',
	localLlmUrl: 'http://localhost:1234/v1',
	localLlmModel: '',
	ttsCloudProvider: 'elevenlabs',
	elevenLabsModel: 'eleven_multilingual_v2',
	elevenLabsVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
	ttsApiBaseUrl: 'https://api.openai.com/v1',
	ttsApiModel: 'gpt-4o-mini-tts',
	ttsApiVoice: 'alloy',
	llmProvider: 'groq',
	llmModel: AUTOMATIC_MODEL,
	customBaseUrl: '',
	customModel: '',
	explanationVoice: '',
	explanationVoiceByLanguage: {},
	// French is currently the only approved language. A usable default avoids an
	// indeterminate first boot that otherwise stays at “Checking language data…”.
	targetLanguage: DEFAULT_LANGUAGE_ID,
	instructionLanguage: DEFAULT_INSTRUCTION_LANGUAGE_ID,
	syncProvider: 'off',
	webdavUrl: '',
	webdavPath: '/onspot/onspot.sqlite',
	voiceTunings: {},
	practiceReminders: false,
	reminderFrequency: 'frequent',
	showWordPos: false,
	promptContributions: true
};

/** CEFR levels offered in Settings. */
export const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

const store = writable<AppSettings>({ ...DEFAULT_SETTINGS });

/** True once persisted settings have been loaded; prevents first-run flicker. */
export const settingsReady = writable(false);

let hydrated = false;
/** Set while hydration writes the loaded snapshot, so it is never persisted back. */
let applying = false;
/** Fields changed before hydration finished; they win over the stored values. */
const pending = new Map<keyof AppSettings, AppSettings[keyof AppSettings]>();
let known: AppSettings = { ...DEFAULT_SETTINGS };

store.subscribe((value) => {
	// Hydration reads the database, which can take a moment on a cold start. A
	// choice the learner makes before it finishes must not be reverted when the
	// stored snapshot lands, so remember it and merge it in `initSettings`.
	if (!hydrated && !applying) {
		for (const field of Object.keys(value) as (keyof AppSettings)[]) {
			if (value[field] !== known[field]) pending.set(field, value[field]);
		}
	}
	known = value;
	if (!hydrated || applying) return;
	void persist(value);
});

/** Last JSON written per field; only fields that changed are written again. */
const written = new Map<string, string>();
let queued: AppSettings | null = null;
let writing = false;

/**
 * Adopts a core-normalised document: every field the core returned is now the
 * value on disk, so the driver never writes defaults or stale values back.
 */
function adoptCoreSettings(
	settings: AppSettings,
	inFlight?: AppSettings,
	latest?: AppSettings | null
): void {
	written.clear();
	for (const [field, value] of Object.entries(settings)) {
		written.set(field, JSON.stringify(value));
	}
	let adopted = settings;
	if (inFlight && latest) {
		// A field edited while the patch was in flight is newer than the reply;
		// keep it in the store and leave `written` at the reply's value so the
		// queued snapshot patches it next.
		adopted = { ...settings };
		for (const field of Object.keys(latest) as (keyof AppSettings)[]) {
			if (latest[field] !== inFlight[field]) {
				(adopted as unknown as Record<string, unknown>)[field] = latest[field];
			}
		}
	}
	applying = true;
	store.set(adopted);
	applying = false;
}

/**
 * Writes are serialized and coalesced: typing in a field produces many store
 * updates, and overlapping full-snapshot writes could land out of order and
 * leave an older value in the database.
 */
async function persist(value: AppSettings): Promise<void> {
	queued = value;
	if (writing) return;
	writing = true;
	try {
		while (queued) {
			const next = queued;
			queued = null;
			try {
				const patch: Record<string, string> = {};
				for (const [field, fieldValue] of Object.entries(next)) {
					const json = JSON.stringify(fieldValue);
					if (written.get(field) === json) continue;
					patch[field] = json;
				}
				if (Object.keys(patch).length === 0) continue;

				const client = await getCoreClient();
				const result = await client.command<{ settings: AppSettings }>('settings.patch', {
					patch
				});
				adoptCoreSettings(result.settings, next, queued);
			} catch (error) {
				console.error('[settings] failed to persist', error);
			}
		}
	} finally {
		writing = false;
	}
}

/** Loads the core-normalised settings document. Safe to call once on startup. */
export async function initSettings(): Promise<void> {
	// Also runs after a database restore or a cloud download. Suspend
	// persistence until the loaded values are in the store, so a choice made
	// while loading is a real difference and is written back afterwards.
	hydrated = false;

	const client = await getCoreClient();
	const result = await client.command<{ settings: AppSettings }>('settings.load');
	const loaded = result.settings as unknown as AppSettings;
	// Adopt the stored document first, so its fields stay in `written` and
	// are not patched back.
	const chosenWhileLoading = new Map(pending);
	pending.clear();
	adoptCoreSettings(loaded);
	hydrated = true;
	settingsReady.set(true);
	if (chosenWhileLoading.size > 0) {
		store.update((value) => {
			const merged = { ...value };
			for (const [field, fieldValue] of chosenWhileLoading) {
				(merged as unknown as Record<string, unknown>)[field] = fieldValue;
			}
			return merged;
		});
	}
}

export const appSettings = {
	subscribe: store.subscribe,
	set: store.set,
	update: store.update
};

export function setSetting<K extends keyof AppSettings>(field: K, value: AppSettings[K]): void {
	store.update((current) => withRememberedVoices(current, { ...current, [field]: value }));
}

/**
 * Keeps each language's voices: a voice chosen for a language is remembered
 * under it (separately for read-back and for explanations), and a change of
 * language brings back the voice last chosen for the new one. Without a
 * remembered voice, read-back takes the language's default voice, and an
 * explanation voice stays empty for the learner to choose by ear.
 *
 * @param before The settings before the change.
 * @param next The settings with the change applied.
 * @returns `next`, with voices and memories that agree with its languages.
 */
function withRememberedVoices(before: AppSettings, next: AppSettings): AppSettings {
	const settings = { ...next };

	if (settings.targetLanguage !== before.targetLanguage) {
		const remembered = settings.targetVoiceByLanguage[settings.targetLanguage];
		if (getVoice(settings.targetLanguage, remembered)) settings.ttsVoice = remembered;
		else if (!getVoice(settings.targetLanguage, settings.ttsVoice)) {
			settings.ttsVoice = getLanguage(settings.targetLanguage)?.defaultVoice ?? settings.ttsVoice;
		}
	}
	if (settings.instructionLanguage !== before.instructionLanguage) {
		const remembered = settings.explanationVoiceByLanguage[settings.instructionLanguage];
		if (getExplanationVoice(settings.instructionLanguage, remembered)) settings.explanationVoice = remembered;
		else if (!getExplanationVoice(settings.instructionLanguage, settings.explanationVoice)) settings.explanationVoice = '';
	}

	if (getVoice(settings.targetLanguage, settings.ttsVoice) && settings.targetVoiceByLanguage[settings.targetLanguage] !== settings.ttsVoice) {
		settings.targetVoiceByLanguage = { ...settings.targetVoiceByLanguage, [settings.targetLanguage]: settings.ttsVoice };
	}
	const explanationVoice = getExplanationVoice(settings.instructionLanguage, settings.explanationVoice);
	if (explanationVoice && settings.explanationVoiceByLanguage[settings.instructionLanguage] !== settings.explanationVoice) {
		settings.explanationVoiceByLanguage = { ...settings.explanationVoiceByLanguage, [settings.instructionLanguage]: settings.explanationVoice };
	}
	return settings;
}

export function voiceTuning(settings: AppSettings, voiceId: string): VoiceTuning {
	return settings.voiceTunings[voiceId] ?? NEUTRAL_TUNING;
}

export function setVoiceTuning(voiceId: string, patch: Partial<VoiceTuning>): void {
	store.update((current) => ({
		...current,
		voiceTunings: {
			...current.voiceTunings,
			[voiceId]: { ...NEUTRAL_TUNING, ...current.voiceTunings[voiceId], ...patch }
		}
	}));
}

/** Drops the voice's adjustments, restoring the approved sound. */
export function resetVoiceTuning(voiceId: string): void {
	store.update((current) => {
		const next = { ...current.voiceTunings };
		delete next[voiceId];
		return { ...current, voiceTunings: next };
	});
}
