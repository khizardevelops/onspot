import { OFFERED_LANGUAGES, voicesFor, type VoiceEngine } from '#lib/languages/index.js';
import type { TtsChoice } from '#lib/types.js';

export interface LocalVoiceDefinition {
	id: string;
	name: string;
	engine: VoiceEngine;
	voicePath: string;
	downloadSize: string;
	/** piper-plus only: `language_id_map` key the voice is driven with. */
	modelLanguage?: string;
}

/**
 * Flattened local voices across all offered languages. This is the list the
 * TTS worker constructs adapters from; the language registry is the source of
 * truth for which voices exist and how they are approved.
 */
export const LOCAL_VOICES: readonly LocalVoiceDefinition[] = OFFERED_LANGUAGES.flatMap((language) =>
	language.voices.map((voice) => ({
		id: voice.id,
		name: voice.name,
		engine: voice.engine ?? 'piper',
		voicePath: voice.voicePath,
		downloadSize: voice.downloadSize,
		modelLanguage: voice.modelLanguage
	}))
);

export function localVoiceChoices(languageId: string): TtsChoice[] {
	return voicesFor(languageId).map((voice) => ({
		id: voice.id,
		label: voice.name,
		note: voice.downloadSize
	}));
}
