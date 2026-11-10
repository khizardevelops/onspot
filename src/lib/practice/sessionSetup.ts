// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a session is practised with: the language studied, the language it is
 * taught in, and how it is spoken (speech mode, the two on-device voices, the
 * pace). A session records it when it starts and keeps it current while it is
 * open; opening the session again puts it back into Settings, so its takes
 * are read, translated and explained as they were (`stores/practice.ts`).
 *
 * Sessions from before setups were recorded (schema migration 10) have none:
 * theirs is worked out once from their takes (`inferSessionSetup`).
 */
import type { Attempt, SessionSetup } from '#lib/adapters/db/types.js';
import {
	DEFAULT_INSTRUCTION_LANGUAGE_ID,
	INSTRUCTION_LANGUAGES,
	OFFERED_LANGUAGES,
	defaultInstructionLanguageFor,
	explanationVoicesFor,
	getExplanationVoice,
	getLanguage,
	getVoice
} from '#lib/languages/index.js';
import { languageOfVoice } from '#lib/languages/voices.js';
import { couldBeWrittenIn } from '#lib/languages/textLanguage.js';
import { SPEECH_PACES, DEFAULT_TARGET_SPEECH_PACE, type AppSettings } from '#lib/stores/settings.js';

export type { SessionSetup };

/** The settings a setup is made of. */
type SetupSettings = Pick<
	AppSettings,
	'targetLanguage' | 'instructionLanguage' | 'ttsMode' | 'ttsVoice' | 'explanationVoice' | 'targetSpeechPace'
>;

/**
 * The languages offered before sessions recorded their setup, in the order an
 * old take's letters decide between them (Latin script: French).
 */
const LANGUAGES_BEFORE_SETUPS = ['fr', 'fa', 'ja'] as const;

/** Where word meanings are kept on an attempt: `numbered:<hash>` (English) or `numbered:<language>:<hash>`. */
const GLOSS_KEY_LANGUAGE = /^numbered:([a-z]{2,3}):/;

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
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
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
 * What the takes cannot show is taken from the current settings.
 *
 * - Studied language: the language of the on-device voice a take was read
 *   with, else the language its transcripts' letters can be in (the current
 *   one if it can, else French, Persian or Japanese, the languages offered
 *   before setups were recorded).
 * - Instruction language: the language its newest translations or word
 *   meanings were fetched in.
 *
 * @param attempts The session's takes, oldest first.
 * @param settings The current settings.
 */
export function inferSessionSetup(attempts: readonly Attempt[], settings: SetupSettings): SessionSetup {
	const newestFirst = [...attempts].reverse();
	const targetLanguage = inferTargetLanguage(newestFirst, settings.targetLanguage);
	const instructionLanguage = inferInstructionLanguage(newestFirst, targetLanguage, settings.instructionLanguage);

	const takeVoice = newestFirst.map((attempt) => attempt.ttsVoice).find((voice) => getVoice(targetLanguage, voice));
	return usableSetup({
		targetLanguage,
		instructionLanguage,
		ttsMode: settings.ttsMode,
		ttsVoice: takeVoice ?? (targetLanguage === settings.targetLanguage ? settings.ttsVoice : ''),
		explanationVoice: instructionLanguage === settings.instructionLanguage ? settings.explanationVoice : '',
		targetSpeechPace: settings.targetSpeechPace
	});
}

function inferTargetLanguage(newestFirst: readonly Attempt[], current: string): string {
	const voiceLanguage = newestFirst
		.map((attempt) => (attempt.ttsVoice ? languageOfVoice(attempt.ttsVoice) : undefined))
		.find((language) => getLanguage(language));
	if (voiceLanguage) return voiceLanguage;

	const transcripts = newestFirst.map((attempt) => attempt.transcript).join(' ');
	const candidates = OFFERED_LANGUAGES.map((language) => language.id).filter((id) => couldBeWrittenIn(transcripts, id));
	if (candidates.includes(current) || candidates.length === 0) return current;
	return LANGUAGES_BEFORE_SETUPS.find((id) => candidates.includes(id)) ?? candidates[0];
}

function inferInstructionLanguage(newestFirst: readonly Attempt[], targetLanguage: string, current: string): string {
	for (const attempt of newestFirst) {
		// A translation set without a language was written in English.
		if (attempt.translations) return attempt.translations.instructionLanguage ?? DEFAULT_INSTRUCTION_LANGUAGE_ID;

		const glossKey = Object.keys(attempt.wordGlosses ?? {})[0];
		if (glossKey) return glossKey.match(GLOSS_KEY_LANGUAGE)?.[1] ?? DEFAULT_INSTRUCTION_LANGUAGE_ID;
	}
	return current === targetLanguage ? defaultInstructionLanguageFor(targetLanguage) : current;
}
