import type { TtsChoice } from '../../types';

export interface PiperVoiceDefinition {
	id: string;
	name: string;
	voicePath: string;
	downloadSize: string;
}

/**
 * One source of truth for the local voices shown in settings and constructed
 * inside the TTS worker. Keeping this lightweight list separate prevents the
 * page bundle from importing ONNX Runtime just to render a select menu.
 */
export const PIPER_VOICES: readonly PiperVoiceDefinition[] = [
	{
		id: 'piper-tom-medium',
		name: 'Piper Tom (M, medium)',
		voicePath: 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
		downloadSize: '~64 MB · 44 kHz'
	},
	{
		id: 'piper-upmc-medium',
		name: 'Piper UPMC (medium)',
		voicePath: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
		downloadSize: '~77 MB · 22 kHz · 2 speakers'
	},
	{
		id: 'piper-siwis-medium',
		name: 'Piper Siwis (F, medium)',
		voicePath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
		downloadSize: '~63 MB · 22 kHz'
	},
	{
		id: 'piper-mls-medium',
		name: 'Piper MLS (medium)',
		voicePath: 'fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx',
		downloadSize: '~77 MB · 22 kHz · 125 speakers'
	}
] as const;

export function localVoiceChoices(): TtsChoice[] {
	return PIPER_VOICES.map((voice) => ({
		id: voice.id,
		label: voice.name,
		note: voice.downloadSize
	}));
}
