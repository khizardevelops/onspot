// SPDX-License-Identifier: AGPL-3.0-or-later

import { get } from 'svelte/store';
import { elevenLabsApiKey, openaiApiKey } from './secrets';
import type { AppSettings } from './settings';

/**
 * Provider-specific cloud read-back settings.
 *
 * ElevenLabs and the OpenAI-compatible path keep separate model, voice and key
 * settings, so switching between them never destroys the other configuration.
 */

export interface TtsApiOptions {
	apiProvider: 'elevenlabs' | 'openai';
	apiKey?: string;
	apiBaseUrl: string;
	apiModel: string;
	apiVoice: string;
}

export function ttsApiOptions(settings: AppSettings): TtsApiOptions {
	if (settings.ttsCloudProvider === 'elevenlabs') {
		return {
			apiProvider: 'elevenlabs',
			apiKey: get(elevenLabsApiKey) || undefined,
			apiBaseUrl: 'https://api.elevenlabs.io/v1',
			apiModel: settings.elevenLabsModel,
			apiVoice: settings.elevenLabsVoiceId
		};
	}

	return {
		apiProvider: 'openai',
		apiKey: get(openaiApiKey) || undefined,
		apiBaseUrl: settings.ttsApiBaseUrl,
		apiModel: settings.ttsApiModel,
		apiVoice: settings.ttsApiVoice
	};
}

/** ElevenLabs always needs a key; an OpenAI-compatible local server usually does not. */
export function ttsApiRequiresKey(settings: AppSettings): boolean {
	if (settings.ttsCloudProvider === 'elevenlabs') return true;

	try {
		return new URL(settings.ttsApiBaseUrl).hostname === 'api.openai.com';
	} catch {
		return true;
	}
}
