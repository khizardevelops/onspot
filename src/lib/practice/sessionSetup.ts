// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a session is practised with: the language studied, the language it is
 * taught in, and how it is spoken (speech mode, the two on-device voices, the
 * pace). A session records it when it starts and keeps it current while it is
 * open; opening the session again puts it back into Settings, so its takes
 * are read, translated and explained as they were (`stores/practice.ts`).
 *
 * Validating a stored setup, repairing a voice no longer offered, inferring
 * the setup of a session from before setups were recorded (schema migration
 * 10) and saving it all live in the Rust core (`onspot-app::session_setup`).
 * These two helpers stay here because the store compares the settings with
 * the open session's setup on every change, synchronously.
 */
import type { SessionSetup } from '#lib/adapters/db/types.js';
import type { AppSettings } from '#lib/stores/settings.js';

export type { SessionSetup };

/** The settings a setup is made of. */
type SetupSettings = Pick<
	AppSettings,
	'targetLanguage' | 'instructionLanguage' | 'ttsMode' | 'ttsVoice' | 'explanationVoice' | 'targetSpeechPace'
>;

/** The setup the settings describe now: what a new session records. */
export function setupFromSettings(settings: SetupSettings): SessionSetup {
	return {
		targetLanguage: settings.targetLanguage,
		instructionLanguage: settings.instructionLanguage,
		ttsMode: settings.ttsMode,
		ttsVoice: settings.ttsVoice,
		explanationVoice: settings.explanationVoice,
		targetSpeechPace: settings.targetSpeechPace
	};
}

/** Whether two setups are the same, field by field. */
export function sameSetup(first: SessionSetup, second: SessionSetup): boolean {
	return (Object.keys(first) as (keyof SessionSetup)[]).every((key) => first[key] === second[key]);
}
