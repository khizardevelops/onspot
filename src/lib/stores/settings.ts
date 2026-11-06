// SPDX-License-Identifier: AGPL-3.0-or-later

import { writable } from 'svelte/store';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import type { RunMode } from '#lib/adapters/db/index.js';
import type { LlmModelId, LlmProviderId } from '#lib/adapters/llm/index.js';
import { AUTOMATIC_MODEL, getProvider, isChatModel } from '#lib/adapters/llm/index.js';
import {
	OFFERED_LANGUAGES,
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	DEFAULT_LANGUAGE_ID,
	INSTRUCTION_LANGUAGES,
	NEUTRAL_TUNING,
	getLanguage,
	getVoice,
	type VoiceTuning
} from '#lib/languages/index.js';
import {
	DEFAULT_ELEVENLABS_VOICE_ID,
	RETIRED_DEFAULT_ELEVENLABS_VOICE_ID
} from '#lib/speech/tts/cloud/elevenLabsVoices.js';

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
}

export const DEFAULT_SETTINGS: AppSettings = {
	level: 'B1',
	mode: 'exam',
	sttMode: 'local',
	ttsMode: 'local',
	ttsVoice: 'piper-tom-medium',
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
	// French is currently the only approved language. A usable default avoids an
	// indeterminate first boot that otherwise stays at “Checking language data…”.
	targetLanguage: DEFAULT_LANGUAGE_ID,
	instructionLanguage: DEFAULT_INSTRUCTION_LANGUAGE_ID,
	syncProvider: 'off',
	webdavUrl: '',
	webdavPath: '/onspot/onspot.sqlite',
	voiceTunings: {},
	practiceReminders: false,
	reminderFrequency: 'frequent'
};

const FIELD_PREFIX = 'onspot.setting.';

/**
 * Present once a database's saved model has been moved to Automatic. Without
 * it, the provider's preset model counts as never chosen; with it, a learner
 * who later picks that same model keeps it.
 */
const AUTOMATIC_MODEL_MIGRATION_KEY = 'onspot.migration.automatic-model';

/** CEFR levels offered in Settings. */
export const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

/** Allowed values of the settings rendered as fixed-choice selects. */
const CHOICES = {
	level: LEVELS,
	mode: ['exam', 'casual'],
	sttMode: ['local', 'cloud'],
	ttsMode: ['local', 'cloud'],
	ttsCloudProvider: ['elevenlabs', 'openai'],
	correctionMode: ['cloud', 'local'],
	llmProvider: ['groq', 'deepseek', 'custom'],
	syncProvider: ['off', 'google-drive', 'webdav'],
	reminderFrequency: ['frequent', 'infrequent']
} as const satisfies Partial<Record<keyof AppSettings, readonly string[]>>;
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
				const db = await getDatabaseAdapter();
				for (const [field, fieldValue] of Object.entries(next)) {
					const json = JSON.stringify(fieldValue);
					if (written.get(field) === json) continue;
					await db.setSetting(`${FIELD_PREFIX}${field}`, json);
					written.set(field, json);
				}
			} catch (error) {
				console.error('[settings] failed to persist', error);
			}
		}
	} finally {
		writing = false;
	}
}

/**
 * Saves the fields chosen while the stored settings were loading. The load
 * applies everything without saving (it must not write defaults back), so
 * these would otherwise stay unsaved until some other setting changed, and
 * be lost on the next start.
 */
async function persistChosenWhileLoading(value: AppSettings, fields: (keyof AppSettings)[]): Promise<void> {
	try {
		const db = await getDatabaseAdapter();
		for (const field of fields) {
			const json = JSON.stringify(value[field]);
			if (written.get(field) === json) continue;
			await db.setSetting(`${FIELD_PREFIX}${field}`, json);
			written.set(field, json);
		}
	} catch (error) {
		console.error('[settings] failed to persist a choice made while loading', error);
	}
}

/** Loads persisted settings from the database. Safe to call once on startup. */
export async function initSettings(): Promise<void> {
	// Also runs after a database restore or a cloud download. Suspend
	// persistence until the loaded values are in the store, so filling in
	// defaults for fields the restored file lacks cannot write a change back
	// into the database (and bump the sync revision) during rehydration.
	hydrated = false;

	const db = await getDatabaseAdapter();
	const rows = await db.listSettings();
	const loaded: AppSettings = { ...DEFAULT_SETTINGS };
	// Also runs after a database restore: what is on disk is now the restored file.
	written.clear();
	for (const row of rows) {
		if (!row.key.startsWith(FIELD_PREFIX)) continue;
		const field = row.key.slice(FIELD_PREFIX.length) as keyof AppSettings;
		if (!(field in loaded)) continue;
		written.set(field, row.value);
		try {
			// Values are JSON-encoded; ignore anything malformed.
			(loaded as unknown as Record<string, unknown>)[field] = JSON.parse(row.value);
		} catch {
			// keep the default
		}
	}
	// Settings written before the language registry used ids stored the English
	// name ("French"). Normalise to the registry id, or fall back to the default
	// language.
	const match = OFFERED_LANGUAGES.find(
		(language) => language.id === loaded.targetLanguage || language.name === loaded.targetLanguage
	);
	// A corrupt/obsolete setting must not leave the app without a language. When
	// more languages are approved, this remains a safe default rather than a
	// null state that prevents the data gate from resolving.
	loaded.targetLanguage = match?.id ?? DEFAULT_LANGUAGE_ID;
	loaded.voiceTunings = sanitizeTunings(loaded.voiceTunings);
	// An unknown instruction language, or the studied language itself, falls back to English.
	const teachable = INSTRUCTION_LANGUAGES.some(
		(language) => language.id === loaded.instructionLanguage && language.id !== loaded.targetLanguage
	);
	if (!teachable) loaded.instructionLanguage = DEFAULT_INSTRUCTION_LANGUAGE_ID;
	// A voice saved for another language (or removed from the registry) would
	// leave the Voice select blank and read-backs on an unknown voice.
	if (!getVoice(loaded.targetLanguage, loaded.ttsVoice)) {
		loaded.ttsVoice = getLanguage(loaded.targetLanguage)?.defaultVoice ?? DEFAULT_SETTINGS.ttsVoice;
	}
	// Before Automatic, every learner had a model saved: the provider's preset
	// unless they changed it, and the preset was never a choice. A non-chat
	// model (a classifier such as gpt-oss-safeguard) can never evaluate a take.
	const migratedToAutomatic = rows.some((row) => row.key === AUTOMATIC_MODEL_MIGRATION_KEY);
	const savedPreset = !migratedToAutomatic && loaded.llmModel === getProvider(loaded.llmProvider).defaultModel;
	const movedToAutomatic = savedPreset || !isChatModel(loaded.llmModel);
	if (movedToAutomatic) loaded.llmModel = AUTOMATIC_MODEL;
	// The old default ElevenLabs voice is now a paid Voice Library voice, so every
	// take would fail with HTTP 402 on the free plan; it was never a learner's pick.
	if (loaded.elevenLabsVoiceId === RETIRED_DEFAULT_ELEVENLABS_VOICE_ID) {
		loaded.elevenLabsVoiceId = DEFAULT_ELEVENLABS_VOICE_ID;
	}
	// Choice fields: an unknown value falls back to the default rather than
	// rendering an empty select.
	for (const [field, allowed] of Object.entries(CHOICES) as [keyof typeof CHOICES, readonly string[]][]) {
		if (!allowed.includes(loaded[field] as string)) {
			(loaded as unknown as Record<string, unknown>)[field] = DEFAULT_SETTINGS[field];
		}
	}
	// A choice made while the database was being read wins over the stored value.
	const chosenWhileLoading = [...pending.keys()];
	for (const [field, value] of pending) {
		(loaded as unknown as Record<string, unknown>)[field] = value;
	}
	pending.clear();
	// A settings row from before the model enum existed may name a model this
	// build no longer ships. The Settings dropdown keeps the unknown id as an
	// extra option rather than silently discarding the user's choice.
	//
	// Mark hydrated only after the first set. The persistence subscriber must
	// not write defaults for fields a restored database lacks: that write would
	// bump the content revision immediately after a cloud download, making the
	// next sync upload the just-downloaded data again.
	applying = true;
	store.set(loaded);
	applying = false;
	hydrated = true;
	settingsReady.set(true);

	// The move to Automatic is written now: the subscriber only writes later changes.
	const fieldsToWrite: (keyof AppSettings)[] = movedToAutomatic ? [...chosenWhileLoading, 'llmModel'] : chosenWhileLoading;
	if (fieldsToWrite.length > 0) await persistChosenWhileLoading(loaded, fieldsToWrite);
	if (!migratedToAutomatic) {
		// Unrecorded, the move only repeats on the next start; it must not fail the start.
		await db.setSetting(AUTOMATIC_MODEL_MIGRATION_KEY, 'done').catch((error: unknown) => {
			console.error('[settings] could not record the move to Automatic', error);
		});
	}
}

export const appSettings = {
	subscribe: store.subscribe,
	set: store.set,
	update: store.update
};

export function setSetting<K extends keyof AppSettings>(field: K, value: AppSettings[K]): void {
	store.update((current) => ({ ...current, [field]: value }));
}

/** Per-voice tuning values are clamped to the UI's ±12 dB range. */
function sanitizeTunings(value: unknown): Record<string, VoiceTuning> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, VoiceTuning> = {};
	for (const [voiceId, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!raw || typeof raw !== 'object') continue;
		const entry = raw as Record<string, unknown>;
		const clamp = (value: unknown): number =>
			typeof value === 'number' && Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
		out[voiceId] = {
			volumeDb: clamp(entry.volumeDb),
			bassDb: clamp(entry.bassDb),
			bodyDb: clamp(entry.bodyDb),
			presenceDb: clamp(entry.presenceDb),
			trebleDb: clamp(entry.trebleDb)
		};
	}
	return out;
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
