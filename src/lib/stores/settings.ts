import { writable } from 'svelte/store';
import { getDatabaseAdapter } from '#lib/adapters/db/index.js';
import type { RunMode } from '#lib/adapters/db/index.js';
import type { LlmModelId, LlmProviderId } from '#lib/adapters/llm/index.js';
import { getProvider } from '#lib/adapters/llm/index.js';
import {
	OFFERED_LANGUAGES,
	DEFAULT_LANGUAGE_ID,
	NEUTRAL_TUNING,
	getLanguage,
	getVoice,
	type VoiceTuning
} from '#lib/languages/index.js';

/** How much translation to show under an attempt. */
export type TranslationMode = 'off' | 'idiomatic' | 'all';

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
	/** Local Piper or BYOK cloud speech. */
	ttsMode: 'local' | 'cloud';
	/** Local TTS voice id from the registry. */
	ttsVoice: string;
	llmProvider: LlmProviderId;
	/** Selected model for the non-custom providers (enum-backed dropdown). */
	llmModel: LlmModelId;
	/** Base URL for the custom OpenAI-compatible provider. */
	customBaseUrl: string;
	/** Model name for the custom provider (free text). */
	customModel: string;
	/** How much translation to show under an attempt. */
	translationMode: TranslationMode;
	targetLanguage: string;
	/**
	 * Advanced per-voice audio adjustments (volume/EQ) layered on top of each
	 * voice's approved processing profile. Keyed by voice id; absent = neutral.
	 */
	voiceTunings: Record<string, VoiceTuning>;
}

export const DEFAULT_SETTINGS: AppSettings = {
	level: 'B1',
	mode: 'exam',
	sttMode: 'local',
	ttsMode: 'local',
	ttsVoice: 'piper-tom-medium',
	llmProvider: 'groq',
	llmModel: getProvider('groq').defaultModel,
	customBaseUrl: '',
	customModel: '',
	translationMode: 'off',
	// French is currently the only approved language. A usable default avoids an
	// indeterminate first boot that otherwise stays at “Checking language data…”.
	targetLanguage: DEFAULT_LANGUAGE_ID,
	voiceTunings: {}
};

const FIELD_PREFIX = 'onspot.setting.';

/** CEFR levels offered in Settings. */
export const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

/** Allowed values of the settings rendered as fixed-choice selects. */
const CHOICES = {
	level: LEVELS,
	mode: ['exam', 'casual'],
	sttMode: ['local', 'cloud'],
	ttsMode: ['local', 'cloud'],
	translationMode: ['off', 'idiomatic', 'all'],
	llmProvider: ['groq', 'deepseek', 'custom']
} as const satisfies Partial<Record<keyof AppSettings, readonly string[]>>;
const store = writable<AppSettings>({ ...DEFAULT_SETTINGS });

/** True once persisted settings have been loaded; prevents first-run flicker. */
export const settingsReady = writable(false);

let hydrated = false;

store.subscribe((value) => {
	if (!hydrated) return;
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

/** Loads persisted settings from the database. Safe to call once on startup. */
export async function initSettings(): Promise<void> {
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
	// A voice saved for another language (or removed from the registry) would
	// leave the Voice select blank and read-backs on an unknown voice.
	if (!getVoice(loaded.targetLanguage, loaded.ttsVoice)) {
		loaded.ttsVoice = getLanguage(loaded.targetLanguage)?.defaultVoice ?? DEFAULT_SETTINGS.ttsVoice;
	}
	// Choice fields: an unknown value falls back to the default rather than
	// rendering an empty select.
	for (const [field, allowed] of Object.entries(CHOICES) as [keyof typeof CHOICES, readonly string[]][]) {
		if (!allowed.includes(loaded[field] as string)) {
			(loaded as unknown as Record<string, unknown>)[field] = DEFAULT_SETTINGS[field];
		}
	}
	// A settings row from before the model enum existed may name a model this
	// build no longer ships. The Settings dropdown keeps the unknown id as an
	// extra option rather than silently discarding the user's choice.
	hydrated = true;
	store.set(loaded);
	settingsReady.set(true);
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
