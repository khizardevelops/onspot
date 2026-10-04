/**
 * Supported-language registry.
 *
 * This is the single source of truth for what the app can teach. Adding a
 * language means adding one `LanguageDefinition` here after its local STT and
 * TTS candidates have passed a **manual quality test** (a human listening to /
 * reading the model output), then pointing `approval` at that evidence.
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
 * Optional studio-style cleanup applied to a local voice's PCM before it is
 * written to the read-back WAV. All values are deliberately declarative so a
 * voice can be tuned without touching the DSP code.
 *
 * The learner can nudge the bands and loudness further in Settings → Advanced;
 * that tuning is stored per voice (`VoiceTuning`) and layered on top of these
 * approved defaults.
 */
export interface AudioProcessingProfile {
	/** Peak target for loudness normalization, 0–1. Leaves codec headroom. */
	targetPeak: number;
	/** Low-shelf used to add or remove weight. */
	lowShelf: { frequency: number; gainDb: number };
	/** Peaking band in the low mids, where a voice sounds warm or boxy. */
	body: { frequency: number; gainDb: number; q: number };
	/** Peaking band around speech presence. */
	presence: { frequency: number; gainDb: number; q: number };
	/** High-shelf EQ used to restore consonants that the voice dulls. */
	highShelf: { frequency: number; gainDb: number };
	/** Compressor that doubles as the limiter; `null` skips compression. */
	dynamics: { threshold: number; knee: number; ratio: number; attack: number; release: number } | null;
	/** Makeup gain applied before the limiter, in dB. */
	makeupGainDb: number;
}

/** Per-voice learner adjustments, layered on top of the approved profile. */
export interface VoiceTuning {
	/** Extra output loudness in dB, applied after compression. */
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
	/** Transformers.js repo, for the browser engine. */
	transformers: { repo: string; dtype: string; bytes: number };
}

/**
 * Whisper-small. Every language uses these multilingual weights; only the
 * decoder language changes, so a model downloaded for one language serves all.
 */
const WHISPER_SMALL: SttModels = {
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
 * How a voice turns text into speech. Both run in the lazy TTS worker, on the
 * worker's own onnxruntime-web instance.
 *   piper       rhasspy Piper VITS; eSpeak G2P (`espeakVoice`) — Latin-script languages
 *   piper-plus  piper-plus VITS; OpenJTalk (jpreprocess) G2P compiled to WASM, with
 *               pitch-accent prosody features — Japanese
 */
export type VoiceEngine = 'piper' | 'piper-plus';

export interface LanguageVoice {
	id: string;
	name: string;
	/** Defaults to `piper`. */
	engine?: VoiceEngine;
	/**
	 * `piper`: path inside `rhasspy/piper-voices`.
	 * `piper-plus`: the ONNX file's full URL (its `config.json` sits beside it).
	 */
	voicePath: string;
	downloadSize: string;
	/**
	 * Approximate download size in bytes, used for the combined progress bar.
	 * Includes the voice's phonemizer when it is a separate download.
	 */
	downloadBytes: number;
	/** eSpeak voice code used by the Piper phonemizer, e.g. `fr`. Unused by piper-plus. */
	espeakVoice: string;
	/** piper-plus only: the `language_id_map` key the voice is driven with, e.g. `ja`. */
	modelLanguage?: string;
	/** `null` leaves the raw model output untouched. */
	processing: AudioProcessingProfile | null;
	approval: LanguageApproval;
}

export interface LanguagePrompt {
	title: string;
	text: string;
}

/**
 * How the language is written, which decides how transcripts are split into
 * clickable words and sentences.
 *   spaced    words are separated by spaces (French)
 *   unspaced  no spaces between words; split with `Intl.Segmenter` (Japanese)
 */
export type WritingSystem = 'spaced' | 'unspaced';

export interface LanguageDefinition {
	/** ISO 639-1 code, stored in settings and used as the DB key. */
	id: string;
	/** BCP 47 locale for `Intl.Segmenter` and similar APIs. */
	locale: string;
	writing: WritingSystem;
	/** English name, e.g. `French`. */
	name: string;
	/** Endonym shown under the English name, e.g. `Français`. */
	nativeName: string;
	/** Language the learner's translations are written in. */
	translationTarget: string;
	approval: LanguageApproval;
	stt: LanguageStt;
	voices: LanguageVoice[];
	defaultVoice: string;
	/** Speaking prompts shown to the learner for this language. */
	prompts: LanguagePrompt[];
	/** Short sentence in the target language used by the Settings voice preview. */
	preview: string;
}

/**
 * Piper Tom carries the listening test's two fixes: a high-shelf lift for the
 * muted consonants and a loudness pass. Threshold/ratio are limiter-like so the
 * makeup gain cannot clip; the service applies peak normalization afterwards.
 */
const TOM_PROCESSING: AudioProcessingProfile = {
	targetPeak: 0.89,
	lowShelf: { frequency: 200, gainDb: 0 },
	body: { frequency: 500, gainDb: 0, q: 1 },
	presence: { frequency: 1200, gainDb: 0, q: 0.9 },
	highShelf: { frequency: 3200, gainDb: 5 },
	dynamics: { threshold: -20, knee: 6, ratio: 8, attack: 0.003, release: 0.25 },
	makeupGainDb: 5
};

const FRENCH: LanguageDefinition = {
	id: 'fr',
	locale: 'fr',
	writing: 'spaced',
	name: 'French',
	nativeName: 'Français',
	translationTarget: 'English',
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
	voices: [
		{
			id: 'piper-tom-medium',
			name: 'Piper Tom (M, medium)',
			voicePath: 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
			downloadSize: '~64 MB · 44 kHz',
			downloadBytes: 64_000_000,
			espeakVoice: 'fr',
			processing: TOM_PROCESSING,
			approval: {
				status: 'approved',
				by: 'Human listening test — ranked 1st',
				at: '2026-09-13',
				evidence: 'docs/benchmarks/tts.md'
			}
		},
		{
			id: 'piper-upmc-medium',
			name: 'Piper UPMC (medium)',
			voicePath: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
			downloadSize: '~77 MB · 22 kHz · 2 speakers',
			downloadBytes: 77_000_000,
			espeakVoice: 'fr',
			processing: null,
			approval: {
				status: 'approved',
				by: 'Human listening test — ranked 2nd (jessica)',
				at: '2026-09-13',
				evidence: 'docs/benchmarks/tts.md'
			}
		},
		{
			id: 'piper-siwis-medium',
			name: 'Piper Siwis (F, medium)',
			voicePath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
			downloadSize: '~63 MB · 22 kHz',
			downloadBytes: 63_000_000,
			espeakVoice: 'fr',
			processing: null,
			approval: {
				status: 'approved',
				by: 'Human listening test — ranked 3rd',
				at: '2026-09-13',
				evidence: 'docs/benchmarks/tts.md'
			}
		},
		{
			id: 'piper-mls-medium',
			name: 'Piper MLS (medium)',
			voicePath: 'fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx',
			downloadSize: '~77 MB · 22 kHz · 125 speakers',
			downloadBytes: 77_000_000,
			espeakVoice: 'fr',
			processing: null,
			approval: {
				status: 'approved',
				by: 'Listening test — kept unranked for later auditioning',
				at: '2026-09-13',
				evidence: 'docs/benchmarks/tts.md'
			}
		}
	],
	defaultVoice: 'piper-tom-medium',
	preview:
		"Bonjour ! Voici un aperçu de la voix qui vous accompagnera pendant vos séances d'oral, avec la prononciation et le rythme corrigés après chaque prise.",
	prompts: [
		{ title: 'Morning routine', text: 'Describe your morning routine.' },
		{ title: 'Favorite city', text: 'Talk about your favorite city.' },
		{ title: 'Last weekend', text: 'What did you do last weekend?' },
		{ title: 'Influential person', text: 'Describe a person who influenced you.' },
		{ title: 'A book that changed me', text: 'Talk about a book that changed your perspective.' },
		{ title: 'A free year', text: 'What would you do with a free year?' },
		{ title: 'A memorable meal', text: "Describe a meal you'll never forget." },
		{ title: 'A recent change', text: 'Talk about a recent change in your life.' }
	]
};

/**
 * Japanese G2P for every piper-plus voice: the OpenJTalk/jpreprocess
 * phonemizer (NAIST-JDIC bundled) compiled to WASM by piper-plus. One shared
 * 60 MB download (≈20 MB compressed), verified by SHA-256 before it runs;
 * see `speech/tts/piper/japaneseG2p.ts`.
 */
export const JAPANESE_G2P_BYTES = 60_077_874;
/** What the dictionary costs over the network: the CDN compresses it. */
export const JAPANESE_G2P_TRANSFER_BYTES = 19_806_684;

/** Recorded for a candidate: nothing has been human-tested yet. */
const JAPANESE_PENDING: LanguageApproval = {
	status: 'candidate',
	by: 'Not yet tested — needs a human listening test / transcript review',
	at: '2026-09-25',
	evidence: 'docs/benchmarks/tts.md, docs/benchmarks/stt.md (Japanese sections to be added)'
};

const PIPER_PLUS_BASE = 'https://huggingface.co';

const JAPANESE: LanguageDefinition = {
	id: 'ja',
	locale: 'ja',
	writing: 'unspaced',
	name: 'Japanese',
	nativeName: '日本語',
	translationTarget: 'English',
	approval: JAPANESE_PENDING,
	stt: {
		models: WHISPER_SMALL,
		decoderLanguage: 'japanese',
		code: 'ja',
		approval: JAPANESE_PENDING
	},
	voices: [
		{
			id: 'piper-plus-css10-ja',
			name: 'CSS10 (F) · piper-plus',
			engine: 'piper-plus',
			voicePath: `${PIPER_PLUS_BASE}/ayousanz/piper-plus-css10-ja-6lang/resolve/main/css10-ja-6lang-fp16.onnx`,
			downloadSize: '~40 MB voice + 20 MB Japanese dictionary · 22 kHz',
			downloadBytes: 39_700_000 + JAPANESE_G2P_BYTES,
			espeakVoice: '',
			modelLanguage: 'ja',
			processing: null,
			approval: {
				...JAPANESE_PENDING,
				by: `${JAPANESE_PENDING.by}. Dataset: CSS10 Japanese (public-domain audiobook)`
			}
		},
		{
			id: 'piper-plus-mera',
			name: 'Mera (F) · piper-plus',
			engine: 'piper-plus',
			voicePath: `${PIPER_PLUS_BASE}/kizuna-intelligence/piper-plus-mera-multilingual/resolve/main/mera-multilingual.onnx`,
			downloadSize: '~39 MB voice + 20 MB Japanese dictionary · 22 kHz',
			downloadBytes: 39_400_000 + JAPANESE_G2P_BYTES,
			espeakVoice: '',
			modelLanguage: 'ja',
			processing: null,
			approval: { ...JAPANESE_PENDING, by: `${JAPANESE_PENDING.by}. Licence: Apache-2.0` }
		},
		{
			id: 'piper-plus-tsukuyomi',
			name: 'Tsukuyomi-chan (F) · piper-plus',
			engine: 'piper-plus',
			voicePath: `${PIPER_PLUS_BASE}/ayousanz/piper-plus-tsukuyomi-chan/resolve/main/tsukuyomi-chan-6lang-fp16.onnx`,
			downloadSize: '~40 MB voice + 20 MB Japanese dictionary · 22 kHz',
			downloadBytes: 39_700_000 + JAPANESE_G2P_BYTES,
			espeakVoice: '',
			modelLanguage: 'ja',
			processing: null,
			approval: {
				...JAPANESE_PENDING,
				by: `${JAPANESE_PENDING.by}. Licence: Tsukuyomi-chan corpus terms (credit required)`
			}
		}
	],
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

/** Every language that has ever been declared, approved or not. */
export const LANGUAGES: readonly LanguageDefinition[] = [FRENCH, JAPANESE];

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
	const language = getLanguage(id) ?? OFFERED_LANGUAGES[0];
	if (!language) throw new Error('No languages are configured.');
	return language;
}

export function getVoice(
	languageId: string | null | undefined,
	voiceId: string | null | undefined
): LanguageVoice | undefined {
	const language = getLanguage(languageId);
	if (!language) return undefined;
	return language.voices.find((voice) => voice.id === voiceId);
}

export function voicesFor(languageId: string | null | undefined): LanguageVoice[] {
	return getLanguage(languageId)?.voices ?? [];
}

/** The language's default voice (the listening-test winner), or its first voice. */
export function defaultVoiceOf(language: LanguageDefinition): LanguageVoice | undefined {
	return language.voices.find((voice) => voice.id === language.defaultVoice) ?? language.voices[0];
}
