import { APPROVED_LANGUAGES, voicesFor } from '$lib/languages';
import type { TtsChoice } from '../../types';

export interface PiperVoiceDefinition {
	id: string;
	name: string;
	voicePath: string;
	downloadSize: string;
}

/**
 * Flattened Piper voices across all approved languages. This is the list the
 * TTS worker constructs adapters from; the language registry is the source of
 * truth for which voices exist and how they are approved.
 */
export const PIPER_VOICES: readonly PiperVoiceDefinition[] = APPROVED_LANGUAGES.flatMap((language) =>
	language.voices.map((voice) => ({
		id: voice.id,
		name: voice.name,
		voicePath: voice.voicePath,
		downloadSize: voice.downloadSize
	}))
);

export function localVoiceChoices(languageId: string): TtsChoice[] {
	return voicesFor(languageId).map((voice) => ({
		id: voice.id,
		label: voice.name,
		note: voice.downloadSize
	}));
}
