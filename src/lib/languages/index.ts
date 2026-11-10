// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Supported-language registry.
 *
 * This is the single source of truth for what the app can teach. Adding a
 * language means adding one `LanguageDefinition` here after its local STT and
 * TTS candidates have passed a **manual quality test** (a human listening to /
 * reading the model output), then pointing `approval` at that evidence. Its
 * on-device voices live in `./voices.ts`, by language code.
 *
 * Rules carried from the model lab (see .agents/handoff):
 * - No model is listed as approved until a human has tested its output and the
 *   evidence file exists under `docs/`.
 * - A language with `approval.status !== 'approved'` is not shown to users of
 *   production builds (see `OFFERED_LANGUAGES`; dev builds show candidates so
 *   they can be tested).
 * - Nothing here is hosted by the app. Every entry is a download descriptor;
 *   the bytes are fetched from the public model hosts by the user's device.
 */

import { JAPANESE_PENDING, VOICE_SAMPLE_SENTENCES, VOICES_BY_LANGUAGE } from './voices';

export interface LanguageApproval {
	status: 'approved' | 'candidate';
	/** What kind of test approved this entry. */
	by: string;
	/** Date of the test (ISO day). */
	at: string;
	/** Tracked evidence, relative to the repo root. */
	evidence: string;
}

/**
 * Optional studio-style tone fixes for a local voice, applied to its PCM
 * before its level is evened out with every other voice's
 * (`utils/audioEffects.ts`). All values are deliberately declarative so a
 * voice can be tuned without touching the DSP code.
 *
 * The learner can nudge the bands and the volume further in Settings →
 * Advanced; that tuning is stored per voice (`VoiceTuning`) and layered on
 * top of these approved defaults.
 */
export interface AudioProcessingProfile {
	/** Low-shelf used to add or remove weight. */
	lowShelf: { frequency: number; gainDb: number };
	/** Peaking band in the low mids, where a voice sounds warm or boxy. */
	body: { frequency: number; gainDb: number; q: number };
	/** Peaking band around speech presence. */
	presence: { frequency: number; gainDb: number; q: number };
	/** High-shelf EQ used to restore consonants that the voice dulls. */
	highShelf: { frequency: number; gainDb: number };
	/** Compressor that evens out the voice's own dynamics; `null` skips compression. */
	dynamics: { threshold: number; knee: number; ratio: number; attack: number; release: number } | null;
}

/** Per-voice learner adjustments, layered on top of the approved profile. */
export interface VoiceTuning {
	/** Louder or softer than the shared loudness every voice is brought to, in dB. */
	volumeDb: number;
	bassDb: number;
	bodyDb: number;
	presenceDb: number;
	trebleDb: number;
}

export const NEUTRAL_TUNING: VoiceTuning = {
	volumeDb: 0,
	bassDb: 0,
	bodyDb: 0,
	presenceDb: 0,
	trebleDb: 0
};

export function isNeutralTuning(tuning: VoiceTuning): boolean {
	return (
		tuning.volumeDb === 0 &&
		tuning.bassDb === 0 &&
		tuning.bodyDb === 0 &&
		tuning.presenceDb === 0 &&
		tuning.trebleDb === 0
	);
}

/** The Whisper weights as each STT engine needs them (see `src/lib/speech/stt/`). */
export interface SttModels {
	/** ggml file from whisper.cpp's Hugging Face repo, for the native desktop/Android engine. */
	whisperCpp: { file: string; url: string; sha256: string; bytes: number };
	/** Transformers.js repo, for the browser engine. */
	transformers: { repo: string; dtype: string; bytes: number };
}

/**
 * Whisper-small. Every language uses these multilingual weights; only the
 * decoder language changes, so a model downloaded for one language serves all.
 */
const WHISPER_SMALL: SttModels = {
	// q5_1: same accuracy as the q4 ONNX build in 190 MB (docs/benchmarks/stt.md).
	whisperCpp: {
		file: 'ggml-small-q5_1.bin',
		url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
		sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
		bytes: 190_085_487
	},
	transformers: { repo: 'onnx-community/whisper-small', dtype: 'q4', bytes: 299_000_000 }
};

export interface LanguageStt {
	models: SttModels;
	/** Language name Whisper expects, e.g. `french`. */
	decoderLanguage: string;
	/** ISO 639-1 code, e.g. `fr`. */
	code: string;
	approval: LanguageApproval;
}

/**
 * How a voice turns text into speech. All three run in the lazy on-device
 * voice worker (`speech/tts/local/`).
 *   piper       rhasspy Piper VITS on onnxruntime-web; eSpeak G2P (the voice config names
 *               the eSpeak voice)
 *   piper-plus  piper-plus VITS on onnxruntime-web; OpenJTalk (jpreprocess) G2P compiled to
 *               WASM, with pitch-accent prosody features — Japanese
 *   supertonic  Supertonic 3 on the prebuilt sherpa-onnx runtime; one shared model speaks
 *               31 languages with its own text front end
 */
export type VoiceEngine = 'piper' | 'piper-plus' | 'supertonic';

/** What every on-device voice has, whatever its engine. */
interface VoiceCommon {
	id: string;
	name: string;
	downloadSize: string;
	/**
	 * Approximate download size in bytes, used for the combined progress bar.
	 * Includes what the voice shares with others (a phonemizer, the Supertonic model).
	 */
	downloadBytes: number;
	/** Path inside `rhasspy/piper-voices` of a short recording, to audition the voice without downloading it. */
	samplePath?: string;
	/** `null` leaves the raw model output untouched. */
	processing: AudioProcessingProfile | null;
	approval: LanguageApproval;
}

export interface PiperVoice extends VoiceCommon {
	engine: 'piper';
	/** Path inside `rhasspy/piper-voices`. */
	voicePath: string;
}

export interface PiperPlusVoice extends VoiceCommon {
	engine: 'piper-plus';
	/** The ONNX file's full URL (its `config.json` sits beside it). */
	voicePath: string;
	/** The `language_id_map` key the voice is driven with, e.g. `ja`. */
	modelLanguage: string;
}

export interface SupertonicVoice extends VoiceCommon {
	engine: 'supertonic';
	/** The language Supertonic speaks it in (its `lang` option), e.g. `fr`. */
	language: string;
	/** The preset voice style, as its speaker id in `voice.bin` (0–9). */
	style: number;
}

/** An on-device voice; `engine` says which fields it has. */
export type LanguageVoice = PiperVoice | PiperPlusVoice | SupertonicVoice;

export interface LanguagePrompt {
	title: string;
	text: string;
}

/**
 * How much of a language language models have read, judged by its share of
 * the web: `high` from 1 % of Common Crawl's pages, `medium` from 0.1 %, `low`
 * below. The less text, the weaker a smaller model is at it, so onspot gives
 * less-resourced languages only its strongest models (`automaticModels`).
 */
export type LanguageResourceLevel = 'high' | 'medium' | 'low';

/** From this share of Common Crawl's pages (percent), a language is well resourced. */
const WELL_RESOURCED_WEB_PERCENT = 1;

/** Below this share, a language is low resourced. */
const LOW_RESOURCED_WEB_PERCENT = 0.1;

/**
 * The resource level of a language with this share of the web.
 *
 * @param webTextPercent The language's share of Common Crawl's pages, in percent.
 * @returns `high`, `medium` or `low`.
 */
export function resourceLevelOf(webTextPercent: number): LanguageResourceLevel {
	if (webTextPercent >= WELL_RESOURCED_WEB_PERCENT) return 'high';
	if (webTextPercent >= LOW_RESOURCED_WEB_PERCENT) return 'medium';
	return 'low';
}

/**
 * How the language is written, which decides how transcripts are split into
 * clickable words and sentences.
 *   spaced    words are separated by spaces (French, Persian)
 *   unspaced  no spaces between words; split with `Intl.Segmenter` (Japanese)
 */
export type WritingSystem = 'spaced' | 'unspaced';

/** The text direction target-language content is laid out in. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Which engines this language can use on the device. Cloud-only languages keep
 * the same cloud pipeline but do not expose a local STT/TTS download, usually
 * because no local model has passed the human quality gates yet.
 */
export interface LanguageLocalEngines {
	stt: boolean;
	tts: boolean;
	/** The local OpenAI-compatible correction server. */
	correction: boolean;
}

export interface LanguageDefinition {
	/** ISO 639-1 code, stored in settings and used as the DB key. */
	id: string;
	/** BCP 47 locale for `Intl.Segmenter` and similar APIs. */
	locale: string;
	writing: WritingSystem;
	/** Text direction for the target language's own text. */
	direction: TextDirection;
	/** English name, e.g. `French`. */
	name: string;
	/** Endonym shown under the English name, e.g. `Français`. */
	nativeName: string;
	/** Share of the web in this language, in percent of pages (Common Crawl CC-MAIN-2026-43). */
	webTextPercent: number;
	approval: LanguageApproval;
	stt: LanguageStt;
	/** The voice a new learner hears (its voices are listed in `./voices.ts`); empty when it has none. */
	defaultVoice: string;
	/** Speaking prompts shown to the learner for this language. */
	prompts: LanguagePrompt[];
	/** Short sentence in the target language used by the Settings voice preview. */
	preview: string;
	/** The local engines offered for this language (cloud-only languages disable all three). */
	local: LanguageLocalEngines;
}

/** Speaking prompts that suit any language; a language can add its own (see Japanese, Persian). */
const GENERAL_PROMPTS: LanguagePrompt[] = [
	{ title: 'Morning routine', text: 'Describe your morning routine.' },
	{ title: 'Favorite city', text: 'Talk about your favorite city.' },
	{ title: 'Last weekend', text: 'What did you do last weekend?' },
	{ title: 'Influential person', text: 'Describe a person who influenced you.' },
	{ title: 'A book that changed me', text: 'Talk about a book that changed your perspective.' },
	{ title: 'A free year', text: 'What would you do with a free year?' },
	{ title: 'A memorable meal', text: "Describe a meal you'll never forget." },
	{ title: 'A recent change', text: 'Talk about a recent change in your life.' }
];

/**
 * Recorded for the languages offered because the user asked for every
 * language the on-device voices speak. Like Persian's, it says what was
 * decided and what was not: nothing about these models has been reviewed yet.
 */
const REQUESTED_LANGUAGE_APPROVAL: LanguageApproval = {
	status: 'approved',
	by: "Offered at the user's request with every language the on-device voices speak (2026-11-08). Speech recognition and voices not yet reviewed for this language",
	at: '2026-11-08',
	evidence: 'docs/architecture/supported-languages.md'
};

const WHISPER_NOT_REVIEWED: LanguageApproval = {
	status: 'candidate',
	by: 'Whisper lists this language; its accuracy on learner speech is not measured',
	at: '2026-11-08',
	evidence: 'docs/benchmarks/stt.md'
};

const FRENCH: LanguageDefinition = {
	id: 'fr',
	locale: 'fr',
	writing: 'spaced',
	direction: 'ltr',
	local: { stt: true, tts: true, correction: true },
	name: 'French',
	nativeName: 'Français',
	webTextPercent: 4.76,
	approval: {
		status: 'approved',
		by: 'Human WER review + listening test (model lab)',
		at: '2026-09-13',
		evidence: 'docs/benchmarks/stt.md, docs/benchmarks/tts.md'
	},
	stt: {
		models: WHISPER_SMALL,
		decoderLanguage: 'french',
		code: 'fr',
		approval: {
			status: 'approved',
			by: 'Human transcript review (aggregate WER 5.5%)',
			at: '2026-09-13',
			evidence: 'docs/benchmarks/stt.md'
		}
	},
	defaultVoice: 'piper-tom-medium',
	preview:
		"Bonjour ! Voici un aperçu de la voix qui vous accompagnera pendant vos séances d'oral, avec la prononciation et le rythme corrigés après chaque prise.",
	prompts: GENERAL_PROMPTS
};

const JAPANESE: LanguageDefinition = {
	id: 'ja',
	locale: 'ja',
	writing: 'unspaced',
	direction: 'ltr',
	local: { stt: true, tts: true, correction: true },
	name: 'Japanese',
	nativeName: '日本語',
	webTextPercent: 4.89,
	approval: REQUESTED_LANGUAGE_APPROVAL,
	stt: {
		models: WHISPER_SMALL,
		decoderLanguage: 'japanese',
		code: 'ja',
		approval: JAPANESE_PENDING
	},
	defaultVoice: 'piper-plus-css10-ja',
	preview:
		'こんにちは。これから一緒に話す練習をする声です。毎回の録音のあとで、発音とリズムを直した文を読み上げます。',
	prompts: [
		{ title: 'Morning routine', text: 'Describe your morning routine.' },
		{ title: 'Favorite city', text: 'Talk about your favorite city.' },
		{ title: 'Last weekend', text: 'What did you do last weekend?' },
		{ title: 'Your hobby', text: 'Talk about a hobby you enjoy and why.' },
		{ title: 'A memorable meal', text: "Describe a meal you'll never forget." },
		{ title: 'Your hometown', text: 'Describe the town where you grew up.' },
		{ title: 'A trip to Japan', text: 'Plan a short trip in Japan: where would you go and why?' },
		{ title: 'A recent change', text: 'Talk about a recent change in your life.' }
	]
};

/**
 * Persian recognition and correction are cloud-only: the learner uses Groq
 * Whisper for speech-to-text and the configured cloud LLM for corrections. No
 * local recognition or correction model has passed the human quality gates
 * yet, so those local options stay off; the registry's `local` flags enforce
 * that everywhere. Read-back can run on the device since 2026-11-08: Piper's
 * five Persian voices load and speak in the browser voice check, and the
 * learner auditions them (they are candidates).
 */
const PERSIAN_APPROVAL: LanguageApproval = {
	status: 'approved',
	by: "Requested by the user; Groq Whisper + cloud LLM, read-back by a cloud voice or Piper's Persian voices",
	at: '2026-11-08',
	evidence: 'docs/architecture/languages.md'
};

const PERSIAN: LanguageDefinition = {
	id: 'fa',
	locale: 'fa',
	writing: 'spaced',
	direction: 'rtl',
	// Read-back can run on the device (Piper's Persian voices); recognition and correction stay cloud.
	local: { stt: false, tts: true, correction: false },
	name: 'Persian',
	nativeName: 'فارسی',
	webTextPercent: 0.62,
	approval: PERSIAN_APPROVAL,
	stt: {
		models: WHISPER_SMALL,
		decoderLanguage: 'persian',
		code: 'fa',
		approval: {
			...PERSIAN_APPROVAL,
			by: 'Groq whisper-large-v3-turbo (language fa); no local model offered'
		}
	},
	// Piper's Persian voices (`./voices.ts`); the learner auditions them (candidates).
	defaultVoice: 'piper-fa-amir-medium',
	preview:
		'سلام! این نمونهٔ صدای همراه شماست. بعد از هر تمرین، جملهٔ اصلاحشده را با لحن طبیعی برایتان میخوانم.',
	prompts: [
		{ title: 'Morning routine', text: 'Describe your morning routine.' },
		{ title: 'A Persian dish', text: 'Talk about a Persian dish you enjoy and how it is made.' },
		{ title: 'Last weekend', text: 'What did you do last weekend?' },
		{ title: 'A place in Iran', text: 'Describe a place in Iran you would like to visit.' },
		{ title: 'Influential person', text: 'Describe a person who influenced you.' },
		{ title: 'A book or film', text: 'Talk about a book or film that stayed with you.' },
		{ title: 'A free year', text: 'What would you do with a free year?' },
		{ title: 'A recent change', text: 'Talk about a recent change in your life.' }
	]
};

/** What onspot needs to know about a language, whatever role it plays. */
interface LanguageFacts {
	/** English name, as the prompts name it. */
	name: string;
	/** Endonym, shown under the English name. */
	nativeName: string;
	/** Share of the web in this language, in percent of pages (Common Crawl CC-MAIN-2026-43). */
	webTextPercent: number;
	/** The language name Whisper expects. */
	whisperLanguage: string;
	writing: WritingSystem;
	direction: TextDirection;
	/** The Unicode scripts its letters are written in, as `\p{Script=…}` names them. */
	scripts: readonly string[];
}

function facts(name: string, nativeName: string, webTextPercent: number, whisperLanguage: string, extra: Partial<LanguageFacts> = {}): LanguageFacts {
	return { name, nativeName, webTextPercent, whisperLanguage, writing: 'spaced', direction: 'ltr', scripts: ['Latin'], ...extra };
}

const ARABIC_SCRIPT = ['Arabic'];
const CYRILLIC_SCRIPT = ['Cyrillic'];

/**
 * Every language onspot knows, by ISO 639-1 code: the languages the on-device
 * voices speak (`./voices.ts`). A language here without voices would be a
 * language of instruction only, explained by a cloud voice. Web shares from
 * Common Crawl's CC-MAIN-2026-43 language table.
 */
const LANGUAGE_FACTS: Readonly<Record<string, LanguageFacts>> = {
	ar: facts('Arabic', 'العربية', 0.67, 'arabic', { direction: 'rtl', scripts: ARABIC_SCRIPT }),
	bg: facts('Bulgarian', 'Български', 0.24, 'bulgarian', { scripts: CYRILLIC_SCRIPT }),
	bn: facts('Bengali', 'বাংলা', 0.11, 'bengali', { scripts: ['Bengali'] }),
	cs: facts('Czech', 'Čeština', 1.15, 'czech'),
	da: facts('Danish', 'Dansk', 0.52, 'danish'),
	de: facts('German', 'Deutsch', 5.77, 'german'),
	el: facts('Greek', 'Ελληνικά', 0.51, 'greek', { scripts: ['Greek'] }),
	en: facts('English', 'English', 42.56, 'english'),
	es: facts('Spanish', 'Español', 4.74, 'spanish'),
	et: facts('Estonian', 'Eesti', 0.15, 'estonian'),
	fa: facts('Persian', 'فارسی', 0.62, 'persian', { direction: 'rtl', scripts: ARABIC_SCRIPT }),
	fi: facts('Finnish', 'Suomi', 0.38, 'finnish'),
	fr: facts('French', 'Français', 4.76, 'french'),
	hi: facts('Hindi', 'हिन्दी', 0.21, 'hindi', { scripts: ['Devanagari'] }),
	hr: facts('Croatian', 'Hrvatski', 0.22, 'croatian'),
	hu: facts('Hungarian', 'Magyar', 0.53, 'hungarian'),
	id: facts('Indonesian', 'Bahasa Indonesia', 1.06, 'indonesian'),
	it: facts('Italian', 'Italiano', 2.58, 'italian'),
	ja: facts('Japanese', '日本語', 4.89, 'japanese', { writing: 'unspaced', scripts: ['Han', 'Hiragana', 'Katakana'] }),
	ko: facts('Korean', '한국어', 0.88, 'korean', { scripts: ['Hangul', 'Han'] }),
	lt: facts('Lithuanian', 'Lietuvių', 0.17, 'lithuanian'),
	lv: facts('Latvian', 'Latviešu', 0.09, 'latvian'),
	nl: facts('Dutch', 'Nederlands', 1.75, 'dutch'),
	pl: facts('Polish', 'Polski', 1.89, 'polish'),
	pt: facts('Portuguese', 'Português', 2.47, 'portuguese'),
	ro: facts('Romanian', 'Română', 0.58, 'romanian'),
	ru: facts('Russian', 'Русский', 6.3, 'russian', { scripts: CYRILLIC_SCRIPT }),
	sk: facts('Slovak', 'Slovenčina', 0.4, 'slovak'),
	sl: facts('Slovenian', 'Slovenščina', 0.16, 'slovenian'),
	sv: facts('Swedish', 'Svenska', 0.71, 'swedish'),
	tr: facts('Turkish', 'Türkçe', 1.14, 'turkish'),
	uk: facts('Ukrainian', 'Українська', 0.79, 'ukrainian', { scripts: CYRILLIC_SCRIPT }),
	ur: facts('Urdu', 'اردو', 0.03, 'urdu', { direction: 'rtl', scripts: ARABIC_SCRIPT }),
	vi: facts('Vietnamese', 'Tiếng Việt', 0.98, 'vietnamese'),
	zh: facts('Chinese (Simplified)', '简体中文', 4.37, 'chinese', { writing: 'unspaced', scripts: ['Han'] })
};

/** The Unicode scripts a known language is written in (`\p{Script=…}` names), or undefined for an unknown code. */
export function writingScriptsOf(languageId: string): readonly string[] | undefined {
	return LANGUAGE_FACTS[languageId]?.scripts;
}

/** A known language's ISO 639-1 code from the English name the prompts use ("Persian" → `fa`). */
export function languageIdByName(name: string): string | undefined {
	return Object.keys(LANGUAGE_FACTS).find((id) => LANGUAGE_FACTS[id].name === name);
}

/** The voice a new learner of a language hears: Supertonic's first style where it speaks the language, else the language's first voice. */
function firstChoiceVoice(code: string): string {
	const voices = VOICES_BY_LANGUAGE[code] ?? [];
	const supertonic = voices.find((voice) => voice.engine === 'supertonic' && voice.style === 0);
	return (supertonic ?? voices[0])?.id ?? '';
}

/**
 * A language offered for study with the shared defaults: Whisper small on the
 * device, its voices from `./voices.ts`, the general prompts and its voice
 * sample sentence as the Settings preview.
 */
function requestedLanguage(code: string): LanguageDefinition {
	const known = LANGUAGE_FACTS[code];
	return {
		id: code,
		locale: code,
		writing: known.writing,
		direction: known.direction,
		local: { stt: true, tts: true, correction: true },
		name: known.name,
		nativeName: known.nativeName,
		webTextPercent: known.webTextPercent,
		approval: REQUESTED_LANGUAGE_APPROVAL,
		stt: { models: WHISPER_SMALL, decoderLanguage: known.whisperLanguage, code, approval: WHISPER_NOT_REVIEWED },
		defaultVoice: firstChoiceVoice(code),
		prompts: GENERAL_PROMPTS,
		preview: VOICE_SAMPLE_SENTENCES[code] ?? ''
	};
}

/** French, Japanese and Persian have their own definitions above (reviews, prompts, voices). */
const DEFINED_LANGUAGES: readonly LanguageDefinition[] = [FRENCH, JAPANESE, PERSIAN];

/**
 * Every language a learner can study: one per language the on-device voices
 * speak, plus Persian (cloud recognition), sorted by English name.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
	...DEFINED_LANGUAGES,
	...Object.keys(VOICES_BY_LANGUAGE)
		.filter((code) => LANGUAGE_FACTS[code] && !DEFINED_LANGUAGES.some((language) => language.id === code))
		.map(requestedLanguage)
].sort((first, second) => first.name.localeCompare(second.name));

/** True when any processing step must use the cloud for this language. */
export function isCloudOnly(language: LanguageDefinition): boolean {
	return !language.local.stt || !language.local.tts || !language.local.correction;
}

/**
 * A language the app teaches in: the learner reads and hears explanations,
 * translations and word meanings in it. The model writes it, so any language
 * it writes well can be offered; the target language is never one of them for
 * its own learners.
 */
export interface InstructionLanguage {
	/** ISO 639-1 code, stored in settings. */
	id: string;
	/** English name, as the prompts name it, e.g. `Spanish`. */
	name: string;
	/** Endonym, e.g. `Español`. */
	nativeName: string;
	/** Share of the web in this language, in percent of pages (Common Crawl CC-MAIN-2026-43). */
	webTextPercent: number;
}

/** Every known language can be taught in: the model writes it; explanations are spoken by its voices, or the cloud. */
export const INSTRUCTION_LANGUAGES: readonly InstructionLanguage[] = Object.entries(LANGUAGE_FACTS)
	.map(([id, known]) => ({ id, name: known.name, nativeName: known.nativeName, webTextPercent: known.webTextPercent }))
	.sort((first, second) => (first.id === 'en' ? -1 : second.id === 'en' ? 1 : first.name.localeCompare(second.name)));

export const DEFAULT_INSTRUCTION_LANGUAGE_ID = 'en';

/** An instruction language by id; English for an unknown one. */
export function getInstructionLanguage(id: string | null | undefined): InstructionLanguage {
	return INSTRUCTION_LANGUAGES.find((language) => language.id === id) ?? INSTRUCTION_LANGUAGES[0];
}

/** The languages a learner of `target` can be taught in: any but the one they study. */
export function instructionLanguagesFor(target: LanguageDefinition): readonly InstructionLanguage[] {
	return INSTRUCTION_LANGUAGES.filter((language) => language.id !== target.id);
}

/**
 * The language a learner is taught in until they choose: English, or, for
 * learners of English, the language with the most text on the web after it
 * (nobody is taught a language in that same language).
 *
 * @param targetId The studied language's id.
 */
export function defaultInstructionLanguageFor(targetId: string): string {
	if (targetId !== DEFAULT_INSTRUCTION_LANGUAGE_ID) return DEFAULT_INSTRUCTION_LANGUAGE_ID;
	const others = INSTRUCTION_LANGUAGES.filter((language) => language.id !== targetId);
	return others.reduce((most, language) => (language.webTextPercent > most.webTextPercent ? language : most)).id;
}

/**
 * The on-device voices that can read the instruction-language half of an
 * explanation: every voice that speaks the language, from the shared table
 * (`./voices.ts`). An explanation is read by two voices, this one and the
 * learner's target voice for the target-language words in it. A language with
 * no voices gets explanation audio from cloud speech only.
 *
 * @param instructionLanguageId An `INSTRUCTION_LANGUAGES` id.
 * @returns Its voices; empty when there are none.
 */
export function explanationVoicesFor(instructionLanguageId: string): readonly LanguageVoice[] {
	return VOICES_BY_LANGUAGE[instructionLanguageId] ?? [];
}

/** One of an instruction language's voices, by id. */
export function getExplanationVoice(
	instructionLanguageId: string,
	voiceId: string | null | undefined
): LanguageVoice | undefined {
	return explanationVoicesFor(instructionLanguageId).find((voice) => voice.id === voiceId);
}

/** Human-approved languages. */
export const APPROVED_LANGUAGES: readonly LanguageDefinition[] = LANGUAGES.filter(
	(language) => language.approval.status === 'approved'
);

/**
 * Languages the app offers. Production builds offer approved languages only.
 * Development builds also offer candidates, marked as such, so the human
 * listening test / transcript review that approval needs can be run in the
 * real app (docs/architecture/languages.md, step 5).
 */
export const OFFERED_LANGUAGES: readonly LanguageDefinition[] = import.meta.env.DEV
	? LANGUAGES
	: APPROVED_LANGUAGES;

export function isCandidate(language: LanguageDefinition): boolean {
	return language.approval.status !== 'approved';
}

export const DEFAULT_LANGUAGE_ID = FRENCH.id;

export function getLanguage(id: string | null | undefined): LanguageDefinition | undefined {
	if (!id) return undefined;
	return OFFERED_LANGUAGES.find((language) => language.id === id);
}

export function requireLanguage(id: string | null | undefined): LanguageDefinition {
	// The fallback is the default language, not whichever sorts first.
	const language = getLanguage(id) ?? getLanguage(DEFAULT_LANGUAGE_ID) ?? OFFERED_LANGUAGES[0];
	if (!language) throw new Error('No languages are configured.');
	return language;
}

/**
 * The on-device voices that read back a target language: the language's
 * voices in the shared table, when the app offers it and lets it speak on the
 * device (`local.tts`; Persian's voices only read explanations for now).
 *
 * @param languageId A `LANGUAGES` id.
 * @returns Its voices; empty for an unknown or cloud-only language.
 */
export function voicesFor(languageId: string | null | undefined): readonly LanguageVoice[] {
	const language = getLanguage(languageId);
	if (!language?.local.tts) return [];
	return VOICES_BY_LANGUAGE[language.id] ?? [];
}

/** One of a target language's voices, by id (see `voicesFor`). */
export function getVoice(
	languageId: string | null | undefined,
	voiceId: string | null | undefined
): LanguageVoice | undefined {
	return voicesFor(languageId).find((voice) => voice.id === voiceId);
}

/** The language's default voice (the listening-test winner), or its first voice. */
export function defaultVoiceOf(language: LanguageDefinition): LanguageVoice | undefined {
	const voices = voicesFor(language.id);
	return voices.find((voice) => voice.id === language.defaultVoice) ?? voices[0];
}
