// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the speech engines a learner configured can handle the languages
 * they selected: the language they study (recognised, then read back) and the
 * language they are taught in (spoken in explanations). Each problem is put in
 * words a learner can act on, naming the engine and the language.
 *
 * The cloud lists are the providers' own documentation, checked 2026-11-08;
 * a custom OpenAI-compatible server's languages cannot be known, so nothing is
 * claimed about it.
 */
import { explanationVoicesFor, getInstructionLanguage, getLanguage, voicesFor } from './index';

/** The step a problem affects. */
export type LanguageSupportStep = 'speech-to-text' | 'text-to-speech';

export interface LanguageSupportIssue {
	step: LanguageSupportStep;
	message: string;
}

/** The parts of the learner's settings that decide which engines run. */
export interface SpeechConfiguration {
	targetLanguage: string;
	instructionLanguage: string;
	sttMode: 'local' | 'cloud';
	ttsMode: 'local' | 'cloud';
	ttsCloudProvider: 'elevenlabs' | 'openai';
	elevenLabsModel: string;
	ttsApiBaseUrl: string;
}

/**
 * Whisper's languages (its tokenizer's list), shared by Whisper small on the
 * device and Groq's whisper-large-v3-turbo in the cloud.
 */
const WHISPER_LANGUAGES = new Set([
	'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
	'en', 'es', 'et', 'eu', 'fa', 'fi', 'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hr', 'ht', 'hu', 'hy',
	'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la', 'lb', 'ln', 'lo', 'lt', 'lv', 'mg', 'mi',
	'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'nn', 'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru',
	'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl',
	'tr', 'tt', 'uk', 'ur', 'uz', 'vi', 'yi', 'yo', 'yue', 'zh'
]);

/** ElevenLabs Multilingual v2 (29 languages, "What languages do you support?"). */
const ELEVENLABS_MULTILINGUAL_V2 = [
	'en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro',
	'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru'
];

/** ElevenLabs Flash/Turbo v2.5: Multilingual v2's languages plus Hungarian, Norwegian and Vietnamese. */
const ELEVENLABS_V2_5 = [...ELEVENLABS_MULTILINGUAL_V2, 'hu', 'no', 'vi'];

/** The ElevenLabs models onspot offers, by API id. */
const ELEVENLABS_MODELS: Readonly<Record<string, { name: string; languages: ReadonlySet<string> }>> = {
	eleven_multilingual_v2: { name: 'Multilingual v2', languages: new Set(ELEVENLABS_MULTILINGUAL_V2) },
	eleven_turbo_v2_5: { name: 'Turbo v2.5', languages: new Set(ELEVENLABS_V2_5) },
	eleven_flash_v2_5: { name: 'Flash v2.5', languages: new Set(ELEVENLABS_V2_5) }
};

/** OpenAI's speech models speak Whisper's well-supported languages (OpenAI's text-to-speech guide). */
const OPENAI_SPEECH_LANGUAGES = new Set([
	'af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl',
	'de', 'el', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi',
	'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw', 'sv', 'tl', 'ta', 'th', 'tr', 'uk',
	'ur', 'vi', 'cy'
]);

const OPENAI_HOST = 'api.openai.com';

/** Whether the OpenAI-compatible endpoint is OpenAI itself (only then are its languages known). */
function isOpenAiItself(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname === OPENAI_HOST;
	} catch {
		return false;
	}
}

/**
 * Which configured cloud voice cannot speak a language, as a sentence, or null
 * when it can (or its languages are unknown).
 *
 * @param config The learner's speech settings.
 * @param code The language, ISO 639-1.
 * @param languageName Its English name.
 * @param purpose What the voice would read, e.g. "read-back".
 */
function cloudVoiceProblem(config: SpeechConfiguration, code: string, languageName: string, purpose: string): string | null {
	if (config.ttsCloudProvider === 'elevenlabs') {
		const model = ELEVENLABS_MODELS[config.elevenLabsModel];
		if (!model || model.languages.has(code)) return null;

		const otherModel = Object.values(ELEVENLABS_MODELS).find((candidate) => candidate.languages.has(code));
		const alternative = otherModel
			? `ElevenLabs ${otherModel.name} does: choose it as the model.`
			: OPENAI_SPEECH_LANGUAGES.has(code)
				? 'Use the OpenAI speech API, or on-device voices where they speak it.'
				: 'Choose on-device voices where they speak it.';
		return `ElevenLabs ${model.name} does not speak ${languageName}, so ${purpose} would sound wrong. ${alternative}`;
	}

	if (!isOpenAiItself(config.ttsApiBaseUrl) || OPENAI_SPEECH_LANGUAGES.has(code)) return null;
	return `OpenAI's speech API does not speak ${languageName}, so ${purpose} would sound wrong. Choose on-device voices where they speak it.`;
}

/**
 * Everything the configured engines cannot do with the selected languages.
 *
 * @param config The learner's speech settings.
 * @returns One issue per problem; empty when every engine handles both languages.
 */
export function languageSupportIssues(config: SpeechConfiguration): LanguageSupportIssue[] {
	const issues: LanguageSupportIssue[] = [];
	const target = getLanguage(config.targetLanguage);
	if (!target) return issues;
	const instruction = getInstructionLanguage(config.instructionLanguage);

	// Recognising the learner's speech in the target language.
	if (!WHISPER_LANGUAGES.has(target.id)) {
		const engine = config.sttMode === 'local' ? 'Whisper on this device' : "Groq's Whisper";
		issues.push({ step: 'speech-to-text', message: `${engine} does not recognise ${target.name}.` });
	}

	// Reading the target language back.
	if (config.ttsMode === 'local') {
		if (voicesFor(target.id).length === 0) {
			issues.push({
				step: 'text-to-speech',
				message: `No on-device voice speaks ${target.name}. Choose Cloud for text-to-speech.`
			});
		}
	} else {
		const problem = cloudVoiceProblem(config, target.id, target.name, 'read-back');
		if (problem) issues.push({ step: 'text-to-speech', message: problem });
	}

	// Speaking explanations in the language of instruction.
	if (config.ttsMode === 'local') {
		if (explanationVoicesFor(instruction.id).length === 0) {
			issues.push({
				step: 'text-to-speech',
				message: `No on-device voice speaks ${instruction.name}, so explanations are not read aloud on this device. Cloud text-to-speech can read them.`
			});
		}
	} else {
		const problem = cloudVoiceProblem(config, instruction.id, instruction.name, `explanations in ${instruction.name}`);
		if (problem) issues.push({ step: 'text-to-speech', message: problem });
	}

	return issues;
}
