import { writable } from 'svelte/store';
import { getDatabaseAdapter } from '$lib/adapters/db';
import type { RunMode } from '$lib/adapters/db';
import type { LlmModelId, LlmProviderId } from '$lib/adapters/llm';
import { getProvider } from '$lib/adapters/llm';

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
	targetLanguage: 'French'
};

const FIELD_PREFIX = 'onspot.setting.';
const store = writable<AppSettings>({ ...DEFAULT_SETTINGS });

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
	// A settings row from before the model enum existed may name a model this
	// build no longer ships. The Settings dropdown keeps the unknown id as an
	// extra option rather than silently discarding the user's choice.
	hydrated = true;
	store.set(loaded);
}

export const appSettings = {
	subscribe: store.subscribe,
	set: store.set,
	update: store.update
};

export function setSetting<K extends keyof AppSettings>(field: K, value: AppSettings[K]): void {
	store.update((current) => ({ ...current, [field]: value }));
}
