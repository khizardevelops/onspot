// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a session is practised with: the language studied, the language it is
 * taught in, and how it is spoken (speech mode, the two on-device voices, the
 * pace). A session records it when it starts and keeps it current while it is
 * open; opening the session again puts it back into Settings, so its takes
 * are read, translated and explained as they were (`stores/practice.ts`).
 *
 * Sessions from before setups were recorded (schema migration 10) have none:
 * theirs is worked out once from their takes (`inferSessionSetup`), and that
 * inference lives in the Rust core (`onspot-app::session_setup`).
 */
import type { Attempt, SessionSetup } from '#lib/adapters/db/types.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	INSTRUCTION_LANGUAGES,
	explanationVoicesFor,
	getExplanationVoice,
	getLanguage,
	getVoice
} from '#lib/languages/index.js';
import { SPEECH_PACES, DEFAULT_TARGET_SPEECH_PACE, type AppSettings } from '#lib/stores/settings.js';
import { getCoreClient } from '#lib/core-client/client.js';

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

/**
 * Validates a stored setup at the boundary (the database, a backup).
 *
 * @param value A parsed JSON value, or its JSON text.
 * @returns The setup, or null when it is missing or names a language this
 *   version does not offer (the session's setup is then inferred again).
 */
export function parseSessionSetup(value: unknown): SessionSetup | null {
	let parsed = value;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== 'object') return null;

	const fields = parsed as Record<string, unknown>;
	const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '');
	const target = getLanguage(text('targetLanguage'));
	const instruction = INSTRUCTION_LANGUAGES.find((language) => language.id === text('instructionLanguage'));
	if (!target || !instruction || target.id === instruction.id) return null;

	const pace = Number(fields.targetSpeechPace);
	return {
		targetLanguage: target.id,
		instructionLanguage: instruction.id,
		ttsMode: fields.ttsMode === 'cloud' ? 'cloud' : 'local',
		ttsVoice: text('ttsVoice'),
		explanationVoice: text('explanationVoice'),
		targetSpeechPace: (SPEECH_PACES as readonly number[]).includes(pace) ? pace : DEFAULT_TARGET_SPEECH_PACE
	};
}

/**
 * A setup the app can use: voices that exist for its languages (a voice
 * removed since, or a cloud-only language, falls back to the language's
 * default) and Cloud read-back where no on-device voice speaks the language.
 */
export function usableSetup(setup: SessionSetup): SessionSetup {
	const target = getLanguage(setup.targetLanguage);
	const ttsVoice = getVoice(setup.targetLanguage, setup.ttsVoice)?.id ?? target?.defaultVoice ?? '';
	const explanationVoice =
		getExplanationVoice(setup.instructionLanguage, setup.explanationVoice)?.id ??
		explanationVoicesFor(setup.instructionLanguage)[0]?.id ??
		'';
	const ttsMode = target?.local.tts === false ? 'cloud' : setup.ttsMode;
	return { ...setup, ttsMode, ttsVoice, explanationVoice };
}

/**
 * Works out the setup of a session that never recorded one, from its takes.
 * The language and voice rules live in the Rust core; this adapter only passes
 * the session's takes and the current settings across the boundary.
 *
 * @param attempts The session's takes, oldest first.
 * @param settings The current settings.
 */
export async function inferSessionSetup(
	attempts: readonly Attempt[],
	settings: SetupSettings
): Promise<SessionSetup> {
	const client = await getCoreClient();
	return client.command<SessionSetup>('sessions.infer_setup', {
		attempts: attempts.map((attempt) => ({
			transcript: attempt.transcript,
			ttsVoice: attempt.ttsVoice,
			translationLanguage: attempt.translations?.instructionLanguage ?? null,
			wordGlossKeys: Object.keys(attempt.wordGlosses ?? {})
		})),
		settings
	});
}
