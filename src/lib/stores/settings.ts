import { writable } from 'svelte/store';
import { getDatabaseAdapter } from '$lib/adapters/db';
import type { RunMode } from '$lib/adapters/db';
import type { LlmModelId, LlmProviderId } from '$lib/adapters/llm';
import { getProvider } from '$lib/adapters/llm';
import { APPROVED_LANGUAGES, DEFAULT_LANGUAGE_ID, NEUTRAL_TUNING, type VoiceTuning } from '$lib/languages';

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
const store = writable<AppSettings>({ ...DEFAULT_SETTINGS });

/** True once persisted settings have been loaded; prevents first-run flicker. */
export const settingsReady = writable(false);

let hydrated = false;

store.subscribe((value) => {
	if (!hydrated) return;
	void persist(value);
});

async function persist(value: AppSettings): Promise<void> {
	try {
		const db = await getDatabaseAdapter();
		for (const [field, fieldValue] of Object.entries(value)) {
			await db.setSetting(`${FIELD_PREFIX}${field}`, JSON.stringify(fieldValue));
		}
	} catch (error) {
		console.error('[settings] failed to persist', error);
	}
}

/** Loads persisted settings from the database. Safe to call once on startup. */
export async function initSettings(): Promise<void> {
	const db = await getDatabaseAdapter();
	const rows = await db.listSettings();
	const loaded: AppSettings = { ...DEFAULT_SETTINGS };
	for (const row of rows) {
		if (!row.key.startsWith(FIELD_PREFIX)) continue;
		const field = row.key.slice(FIELD_PREFIX.length) as keyof AppSettings;
		if (!(field in loaded)) continue;
		try {
			// Values are JSON-encoded; ignore anything malformed.
			(loaded as unknown as Record<string, unknown>)[field] = JSON.parse(row.value);
		} catch {
			// keep the default
		}
	}
	// Settings written before the language registry used ids stored the English
	// name ("French"). Normalise to the registry id, or clear it so the first-run
	// picker appears.
	const match = APPROVED_LANGUAGES.find(
		(language) => language.id === loaded.targetLanguage || language.name === loaded.targetLanguage
	);
	// A corrupt/obsolete setting must not leave the app without a language. When
	// more languages are approved, this remains a safe default rather than a
	// null state that prevents the data gate from resolving.
	loaded.targetLanguage = match?.id ?? DEFAULT_LANGUAGE_ID;
	loaded.voiceTunings = sanitizeTunings(loaded.voiceTunings);
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
