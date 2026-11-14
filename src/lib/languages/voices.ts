// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every on-device voice, by the language it speaks (ISO 639-1 code).
 *
 * A voice speaks one language, whichever role it plays: reading back the
 * target language, or the instruction-language half of an explanation. So one
 * table serves both roles (`voicesFor` and `explanationVoicesFor` in
 * `./index.ts` read the same entries), and any language can be either.
 *
 * Languages are covered in this order (decided 2026-11-08; evidence in
 * docs/benchmarks/tts.md):
 *   1. Supertonic 3: one shared model for 31 languages, ten voice styles;
 *   2. Piper: the voices learners already use, and the languages Supertonic
 *      does not speak (Persian, Chinese, Urdu, Bengali);
 *   3. none: the language uses cloud speech.
 *
 * Nothing here is hosted by the app: every entry is a download descriptor.
 */
import type {
	AudioProcessingProfile,
	LanguageApproval,
	LanguageVoice,
	PiperPlusVoice,
	PiperVoice,
	SupertonicVoice,
	VoiceEngine
} from './index';

// ------------------------------------------------------------ Supertonic ---

/**
 * Supertonic 3 as sherpa-onnx packages it (int8), pinned to one revision of
 * its Hugging Face mirror so every learner downloads the same bytes. The
 * Supertone weights are licensed OpenRAIL-M (use restrictions, attribution).
 */
const SUPERTONIC_REPOSITORY =
	'https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4';

/** Which part of the sherpa-onnx Supertonic config a file is. */
export type SupertonicFileRole =
	| 'durationPredictor'
	| 'textEncoder'
	| 'vectorEstimator'
	| 'vocoder'
	| 'ttsJson'
	| 'unicodeIndexer'
	| 'voiceStyle';

export interface SupertonicModelFile {
	role: SupertonicFileRole;
	/** File name inside the model folder. */
	name: string;
	url: string;
	bytes: number;
	/**
	 * Checked after every fetch: a damaged copy (an interrupted download kept in
	 * the cache) makes the runtime throw a bare C++ exception instead of speaking.
	 */
	sha256: string;
}

function supertonicFile(role: SupertonicFileRole, name: string, bytes: number, sha256: string): SupertonicModelFile {
	return { role, name, url: `${SUPERTONIC_REPOSITORY}/${name}`, bytes, sha256 };
}

/** The model's files. Every Supertonic voice shares them: one download serves all 31 languages. */
export const SUPERTONIC_MODEL_FILES: readonly SupertonicModelFile[] = [
	supertonicFile('durationPredictor', 'duration_predictor.int8.onnx', 3_700_147, 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'),
	supertonicFile('textEncoder', 'text_encoder.int8.onnx', 36_416_150, 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'),
	supertonicFile('vectorEstimator', 'vector_estimator.int8.onnx', 78_400_833, '20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd'),
	supertonicFile('vocoder', 'vocoder.int8.onnx', 25_991_073, 'e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152'),
	supertonicFile('ttsJson', 'tts.json', 8_253, '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09'),
	supertonicFile('unicodeIndexer', 'unicode_indexer.bin', 262_144, '8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30'),
	supertonicFile('voiceStyle', 'voice.bin', 517_168, '67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8')
];

/** Bytes of the whole model, for the download estimate. */
export const SUPERTONIC_MODEL_BYTES = SUPERTONIC_MODEL_FILES.reduce((total, file) => total + file.bytes, 0);

/**
 * Denoising steps per generation: Supertone's reference setting
 * (`--total-step 8` in supertonic's example_onnx.py; sherpa-onnx's examples
 * use 8 too). Fewer is faster but less finished: 3 steps left audible
 * high-frequency noise (heard as a watery, filtered voice) and 5, sherpa's
 * API default, still made some words sound off (2026-11-08,
 * docs/benchmarks/tts.md). Do not lower it without measuring and listening.
 */
export const SUPERTONIC_STEPS = 8;

/** Speaking rate: Supertone's reference (`--speed 1.05`); higher is faster. */
export const SUPERTONIC_SPEED = 1.05;

/** The languages Supertonic 3 speaks, by the code its `lang` option takes (its model card's table). */
const SUPERTONIC_LANGUAGES = [
	'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
	'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nl', 'pl',
	'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'
] as const;

/**
 * Supertonic's ten preset voice styles. sherpa-onnx packs them into
 * `voice.bin` in sorted file order (F1–F5, then M1–M5; `generate_voices_bin.py`),
 * so a style's position is its speaker id.
 */
const SUPERTONIC_STYLES = [
	{ code: 'F1', description: 'female' },
	{ code: 'F2', description: 'female' },
	{ code: 'F3', description: 'female' },
	{ code: 'F4', description: 'female' },
	{ code: 'F5', description: 'female' },
	{ code: 'M1', description: 'male' },
	{ code: 'M2', description: 'male' },
	{ code: 'M3', description: 'male' },
	{ code: 'M4', description: 'male' },
	{ code: 'M5', description: 'male' }
] as const;

const SUPERTONIC_PENDING: LanguageApproval = {
	status: 'candidate',
	by:
		'Spike listening (French, English, Korean, Japanese) by the user, 2026-11-08; the learner auditions ' +
		'the rest. Weights: Supertone OpenRAIL-M (use restrictions, attribution)',
	at: '2026-11-08',
	evidence: 'docs/benchmarks/tts.md (Supertonic 3)'
};

const SUPERTONIC_DOWNLOAD_SIZE = '~145 MB, shared by all Supertonic voices · 44 kHz';

/** The ten Supertonic voices of one language. */
function supertonicVoices(language: string): SupertonicVoice[] {
	return SUPERTONIC_STYLES.map((style, styleIndex) => ({
		id: `supertonic-${language}-${style.code.toLowerCase()}`,
		name: `Supertonic ${style.code} (${style.description})`,
		engine: 'supertonic',
		language,
		style: styleIndex,
		downloadSize: SUPERTONIC_DOWNLOAD_SIZE,
		downloadBytes: SUPERTONIC_MODEL_BYTES,
		processing: null,
		approval: SUPERTONIC_PENDING
	}));
}

// ----------------------------------------------------------------- Piper ---

/**
 * Piper Tom carries the listening test's two fixes: a high-shelf lift for the
 * muted consonants and compression for its uneven dynamics. (Its quietness,
 * the test's other complaint, is now what every voice's leveling fixes.)
 */
const TOM_PROCESSING: AudioProcessingProfile = {
	lowShelf: { frequency: 200, gainDb: 0 },
	body: { frequency: 500, gainDb: 0, q: 1 },
	presence: { frequency: 1200, gainDb: 0, q: 0.9 },
	highShelf: { frequency: 3200, gainDb: 5 },
	dynamics: { threshold: -20, knee: 6, ratio: 8, attack: 0.003, release: 0.25 }
};

/**
 * French Piper voices, ranked by a human listening test (2026-09-13) for
 * pronunciation quality, not by round-trip WER or rtf (which measure
 * intelligibility and speed, not how a voice sounds): 1. Tom, 2. UPMC
 * (jessica, #0), 3. Siwis, 4. UPMC (pierre, #1). MLS (125 speakers) is kept
 * unranked for later auditioning. Every voice that lost the test was removed;
 * docs/benchmarks/tts.md says why each was in the running.
 */
const FRENCH_VOICES: PiperVoice[] = [
	{
		id: 'piper-tom-medium',
		name: 'Piper Tom (M, medium)',
		engine: 'piper',
		voicePath: 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx',
		samplePath: 'fr/fr_FR/tom/medium/samples/speaker_0.mp3',
		downloadSize: '~64 MB · 44 kHz',
		downloadBytes: 64_000_000,
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
		engine: 'piper',
		voicePath: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
		samplePath: 'fr/fr_FR/upmc/medium/samples/speaker_0.mp3',
		downloadSize: '~77 MB · 22 kHz · 2 speakers',
		downloadBytes: 77_000_000,
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
		engine: 'piper',
		voicePath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
		samplePath: 'fr/fr_FR/siwis/medium/samples/speaker_0.mp3',
		downloadSize: '~63 MB · 22 kHz',
		downloadBytes: 63_000_000,
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
		engine: 'piper',
		voicePath: 'fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx',
		samplePath: 'fr/fr_FR/mls/medium/samples/speaker_0.mp3',
		downloadSize: '~77 MB · 22 kHz · 125 speakers',
		downloadBytes: 77_000_000,
		processing: null,
		approval: {
			status: 'approved',
			by: 'Listening test — kept unranked for later auditioning',
			at: '2026-09-13',
			evidence: 'docs/benchmarks/tts.md'
		}
	}
];

/** Recorded for Piper candidates until the learner picks one by listening to its hosted sample. */
const PIPER_PENDING: LanguageApproval = {
	status: 'candidate',
	by: 'Not yet tested — the learner auditions the samples in Settings and picks one',
	at: '2026-11-01',
	evidence: 'docs/benchmarks/tts.md'
};

/** Size of most medium-quality Piper voices (~63 MB); a larger one passes its own `bytes`. */
const PIPER_MEDIUM_BYTES = 63_200_000;

/**
 * A medium-quality rhasspy Piper voice with its hosted sample.
 *
 * @param id The voice id stored in settings.
 * @param name The name shown in the voice pickers.
 * @param folder The voice's folder inside `rhasspy/piper-voices`, e.g. `en/en_US/ryan/medium`.
 * @param file The voice's file name without `.onnx`, e.g. `en_US-ryan-medium`.
 * @param options.bytes Its `.onnx` size, when it is not the usual ~63 MB (multi-speaker voices are larger).
 * @param options.approval Its approval record; a candidate by default.
 * @returns The voice.
 */
function piperVoice(
	id: string,
	name: string,
	folder: string,
	file: string,
	{ bytes = PIPER_MEDIUM_BYTES, approval = PIPER_PENDING }: { bytes?: number; approval?: LanguageApproval } = {}
): PiperVoice {
	return {
		id,
		name,
		engine: 'piper',
		voicePath: `${folder}/${file}.onnx`,
		samplePath: `${folder}/samples/speaker_0.mp3`,
		downloadSize: `~${Math.round(bytes / 1e6)} MB · 22 kHz`,
		downloadBytes: bytes,
		processing: null,
		approval
	};
}

const ENGLISH_PIPER_VOICES: PiperVoice[] = [
	piperVoice('piper-en-ryan-medium', 'Piper Ryan (M, US)', 'en/en_US/ryan/medium', 'en_US-ryan-medium'),
	piperVoice('piper-en-lessac-medium', 'Piper Lessac (F, US)', 'en/en_US/lessac/medium', 'en_US-lessac-medium'),
	piperVoice('piper-en-alan-medium', 'Piper Alan (M, UK)', 'en/en_GB/alan/medium', 'en_GB-alan-medium'),
	piperVoice('piper-en-alba-medium', 'Piper Alba (F, UK)', 'en/en_GB/alba/medium', 'en_GB-alba-medium')
];

/** Persian: Supertonic does not speak it. Every rhasspy Persian voice uses eSpeak `fa`. */
const PERSIAN_PIPER_VOICES: PiperVoice[] = [
	piperVoice('piper-fa-amir-medium', 'Piper Amir', 'fa/fa_IR/amir/medium', 'fa_IR-amir-medium'),
	piperVoice('piper-fa-ganji-medium', 'Piper Ganji', 'fa/fa_IR/ganji/medium', 'fa_IR-ganji-medium'),
	piperVoice('piper-fa-ganji-adabi-medium', 'Piper Ganji Adabi', 'fa/fa_IR/ganji_adabi/medium', 'fa_IR-ganji_adabi-medium'),
	piperVoice('piper-fa-gyro-medium', 'Piper Gyro', 'fa/fa_IR/gyro/medium', 'fa_IR-gyro-medium'),
	piperVoice('piper-fa-reza-ibrahim-medium', 'Piper Reza Ibrahim', 'fa/fa_IR/reza_ibrahim/medium', 'fa_IR-reza_ibrahim-medium')
];

/**
 * Chinese: Supertonic does not speak it. Only Huayan is listed: rhasspy's other
 * Chinese voices (chaowen, xiao_ya) expect pinyin phonemes, which the eSpeak
 * phonemizer does not produce.
 */
const CHINESE_PIPER_VOICES: PiperVoice[] = [
	piperVoice('piper-zh-huayan-medium', 'Piper Huayan', 'zh/zh_CN/huayan/medium', 'zh_CN-huayan-medium')
];

/**
 * Urdu: Supertonic does not speak it. Both rhasspy Urdu voices (MIT) use eSpeak
 * `ur`; Fasih comes first as its v2 (October 2026) is the newer training.
 */
const URDU_PIPER_VOICES: PiperVoice[] = [
	piperVoice('piper-ur-fasih-medium', 'Piper Fasih (M)', 'ur/ur_PK/fasih/medium', 'ur_PK-fasih-medium', { bytes: 64_832_023 }),
	piperVoice('piper-ur-aegis-female-medium', 'Piper Aegis (F)', 'ur/ur_PK/aegis_female/medium', 'ur_PK-aegis_female-medium', { bytes: 63_515_589 })
];

/**
 * Bengali: Supertonic does not speak it. rhasspy's one Bengali voice (eSpeak
 * `bn`) holds 16 speakers from Google's OpenSLR 37 corpus (CC BY-SA 4.0) and
 * CMU Indic; the adapter speaks with the first.
 */
const BENGALI_PIPER_VOICES: PiperVoice[] = [
	piperVoice('piper-bn-google-medium', 'Piper Google (Bangladesh)', 'bn/bn_BD/google/medium', 'bn_BD-google-medium', { bytes: 76_782_515 })
];

// ------------------------------------------------------------ piper-plus ---

/**
 * Japanese G2P for every piper-plus voice: the OpenJTalk/jpreprocess
 * phonemizer (NAIST-JDIC bundled) compiled to WASM by piper-plus. One shared
 * 60 MB download (≈20 MB compressed), verified by SHA-256 before it runs;
 * see `speech/tts/piper/japaneseG2p.ts`.
 */
export const JAPANESE_G2P_BYTES = 60_077_874;
/** What the dictionary costs over the network: the CDN compresses it. */
export const JAPANESE_G2P_TRANSFER_BYTES = 19_806_684;

/** rhasspy Piper voices; a voice's `voicePath` is relative to this. */
export const PIPER_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

/**
 * piper-plus's OpenJTalk/jpreprocess phonemizer (NAIST-JDIC bundled), from the
 * npm release pinned in package.json and matched by the vendored glue in
 * `speech/tts/piper/vendor/piper-plus-wasm`. jsDelivr refuses files this large;
 * unpkg serves the byte-identical npm file with CORS/CORP headers.
 */
export const JAPANESE_G2P_URL = 'https://unpkg.com/piper-plus@0.7.0/dist/rust-wasm/piper_plus_wasm_bg.wasm';
export const JAPANESE_G2P_SHA256 = 'f94f140761e3b4733a339cab6c1cbe077788c7de8f5a014888082c94856ebca0';

/** The weights URL of a Piper or piper-plus voice (the piper-plus entry stores a full URL). */
export function voiceModelUrl(voice: PiperVoice | PiperPlusVoice): string {
	return voice.engine === 'piper-plus' ? voice.voicePath : `${PIPER_VOICES_BASE}${voice.voicePath}`;
}

/** One cached download a voice needs. */
export interface VoiceAsset {
	url: string;
	/** What it occupies on the device. */
	bytes: number;
	/** What it costs to download (smaller when the host compresses it). */
	transferBytes: number;
}

/**
 * Every cached download a voice needs before it can speak offline. Downloads
 * shared by several voices keep the same URL in each list (the Japanese
 * dictionary, the Supertonic model), so a caller can count them once. This is
 * the one place the adapters that fetch the bytes and the store that checks
 * the cache both read, so they cannot disagree.
 *
 * @param voice The voice.
 * @returns Its downloads.
 */
export function voiceAssets(voice: LanguageVoice): VoiceAsset[] {
	if (voice.engine === 'supertonic') {
		return SUPERTONIC_MODEL_FILES.map((file) => ({ url: file.url, bytes: file.bytes, transferBytes: file.bytes }));
	}

	if (voice.engine === 'piper') {
		return [{ url: voiceModelUrl(voice), bytes: voice.downloadBytes, transferBytes: voice.downloadBytes }];
	}

	const modelBytes = Math.max(0, voice.downloadBytes - JAPANESE_G2P_BYTES);
	return [
		{ url: voiceModelUrl(voice), bytes: modelBytes, transferBytes: modelBytes },
		{ url: JAPANESE_G2P_URL, bytes: JAPANESE_G2P_BYTES, transferBytes: JAPANESE_G2P_TRANSFER_BYTES }
	];
}

/** Recorded for a Japanese candidate: nothing has been human-tested yet. */
export const JAPANESE_PENDING: LanguageApproval = {
	status: 'candidate',
	by: 'Not yet tested — needs a human listening test / transcript review',
	at: '2026-09-25',
	evidence: 'docs/benchmarks/tts.md, docs/benchmarks/stt.md (Japanese sections to be added)'
};

const PIPER_PLUS_BASE = 'https://huggingface.co';

const JAPANESE_PIPER_PLUS_VOICES: PiperPlusVoice[] = [
	{
		id: 'piper-plus-css10-ja',
		name: 'CSS10 (F) · piper-plus',
		engine: 'piper-plus',
		voicePath: `${PIPER_PLUS_BASE}/ayousanz/piper-plus-css10-ja-6lang/resolve/main/css10-ja-6lang-fp16.onnx`,
		downloadSize: '~40 MB voice + 20 MB Japanese dictionary · 22 kHz',
		downloadBytes: 39_700_000 + JAPANESE_G2P_BYTES,
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
		modelLanguage: 'ja',
		processing: null,
		approval: {
			...JAPANESE_PENDING,
			by: `${JAPANESE_PENDING.by}. Licence: Tsukuyomi-chan corpus terms (credit required)`
		}
	}
];

// ---------------------------------------------------------------- Models ---

/** How the voice library in Settings describes a model, above the voices it groups. */
export interface VoiceModelInfo {
	name: string;
	/** One sentence a learner can choose by. */
	summary: string;
	/** Technical facts: sample rate, voice count, origin, licence. */
	details: string;
}

export const VOICE_MODELS: Readonly<Record<VoiceEngine, VoiceModelInfo>> = {
	supertonic: {
		name: 'Supertonic 3',
		summary: 'Natural, expressive voices. One download serves all ten voices, in every language Supertonic speaks.',
		details: '44 kHz · 10 voices · 31 languages · Supertone, OpenRAIL-M licence'
	},
	piper: {
		name: 'Piper',
		summary: 'Light, steady voices. Each voice is its own download; most have a short sample to hear first.',
		details: '22 kHz (Tom: 44 kHz) · rhasspy/piper-voices'
	},
	'piper-plus': {
		name: 'piper-plus',
		summary: 'Japanese voices with natural pitch accent. Each voice is its own download and shares one Japanese dictionary.',
		details: '22 kHz · OpenJTalk pronunciation · piper-plus 0.7.0'
	}
};

/**
 * One sentence per language a voice can speak, roughly "Hello, today we will
 * practise speaking together.", for trying a voice in Settings and for the
 * dev voice check.
 */
export const VOICE_SAMPLE_SENTENCES: Readonly<Record<string, string>> = {
	ar: 'مرحبا، سنتدرب اليوم على التحدث معا.',
	bn: 'হ্যালো, আজ আমরা একসাথে কথা বলার অনুশীলন করব।',
	bg: 'Здравейте, днес ще се упражняваме да говорим заедно.',
	cs: 'Dobrý den, dnes si spolu procvičíme mluvení.',
	da: 'Hej, i dag øver vi os i at tale sammen.',
	de: 'Hallo, heute üben wir gemeinsam das Sprechen.',
	el: 'Γεια σας, σήμερα θα εξασκηθούμε στην ομιλία μαζί.',
	en: 'Hello, today we will practise speaking together.',
	es: 'Hola, hoy vamos a practicar la conversación juntos.',
	et: 'Tere, täna harjutame koos rääkimist.',
	fa: 'سلام، امروز با هم صحبت کردن را تمرین می‌کنیم.',
	fi: 'Hei, tänään harjoittelemme puhumista yhdessä.',
	fr: "Bonjour, aujourd'hui nous allons nous entraîner à parler ensemble.",
	hi: 'नमस्ते, आज हम साथ में बोलने का अभ्यास करेंगे।',
	hr: 'Bok, danas ćemo zajedno vježbati govor.',
	hu: 'Szia, ma együtt gyakoroljuk a beszédet.',
	id: 'Halo, hari ini kita akan berlatih berbicara bersama.',
	it: 'Ciao, oggi ci eserciteremo a parlare insieme.',
	ja: 'こんにちは。今日は一緒に話す練習をしましょう。',
	ko: '안녕하세요, 오늘은 함께 말하기 연습을 해요.',
	lt: 'Labas, šiandien kartu mokysimės kalbėti.',
	lv: 'Sveiki, šodien mēs kopā vingrināsimies runāt.',
	nl: 'Hallo, vandaag gaan we samen spreken oefenen.',
	pl: 'Cześć, dzisiaj razem poćwiczymy mówienie.',
	pt: 'Olá, hoje vamos praticar a conversação juntos.',
	ro: 'Bună, astăzi vom exersa vorbitul împreună.',
	ru: 'Здравствуйте, сегодня мы вместе потренируемся говорить.',
	sk: 'Dobrý deň, dnes si spolu precvičíme rozprávanie.',
	sl: 'Pozdravljeni, danes bomo skupaj vadili govorjenje.',
	sv: 'Hej, i dag övar vi på att prata tillsammans.',
	tr: 'Merhaba, bugün birlikte konuşma pratiği yapacağız.',
	uk: 'Привіт, сьогодні ми разом потренуємося говорити.',
	ur: 'السلام علیکم، آج ہم مل کر بات چیت کی مشق کریں گے۔',
	vi: 'Xin chào, hôm nay chúng ta sẽ cùng nhau luyện nói.',
	zh: '你好，今天我们一起练习说话。'
};

// ----------------------------------------------------------------- Table ---

/** Voices listed before a language's Supertonic voices: the ones learners already use. */
const EARLIER_VOICES: Readonly<Record<string, readonly LanguageVoice[]>> = {
	fr: FRENCH_VOICES,
	en: ENGLISH_PIPER_VOICES,
	ja: JAPANESE_PIPER_PLUS_VOICES,
	fa: PERSIAN_PIPER_VOICES,
	zh: CHINESE_PIPER_VOICES,
	ur: URDU_PIPER_VOICES,
	bn: BENGALI_PIPER_VOICES
};

function buildVoiceTable(): Readonly<Record<string, readonly LanguageVoice[]>> {
	const codes = new Set<string>([...Object.keys(EARLIER_VOICES), ...SUPERTONIC_LANGUAGES]);
	const table: Record<string, readonly LanguageVoice[]> = {};
	for (const code of codes) {
		const earlier = EARLIER_VOICES[code] ?? [];
		const supertonic = (SUPERTONIC_LANGUAGES as readonly string[]).includes(code) ? supertonicVoices(code) : [];
		table[code] = [...earlier, ...supertonic];
	}
	return table;
}

/** The on-device voices of each language, by its ISO 639-1 code. A code missing here has none. */
export const VOICES_BY_LANGUAGE: Readonly<Record<string, readonly LanguageVoice[]>> = buildVoiceTable();

/** Every on-device voice, for the voice worker. Each appears once: a voice speaks one language. */
export const ALL_VOICES: readonly LanguageVoice[] = Object.values(VOICES_BY_LANGUAGE).flat();

/** Any on-device voice by its id (ids are unique across languages). */
export function voiceById(voiceId: string): LanguageVoice | undefined {
	return ALL_VOICES.find((voice) => voice.id === voiceId);
}

/** The language an on-device voice speaks (ISO 639-1), or undefined for an unknown or cloud voice. */
export function languageOfVoice(voiceId: string): string | undefined {
	return Object.keys(VOICES_BY_LANGUAGE).find((code) => VOICES_BY_LANGUAGE[code].some((voice) => voice.id === voiceId));
}

/**
 * The settings, beyond its id, that decide how a voice sounds, for audio
 * cache keys: a clip made with other settings must never be replayed (the
 * 3-step Supertonic clips sounded broken). Empty for voices that have none,
 * so their stored clips stay valid.
 *
 * @param voiceId Any on-device voice.
 * @returns e.g. `steps8-speed1.05`, or an empty string.
 */
export function voiceRendition(voiceId: string): string {
	return voiceById(voiceId)?.engine === 'supertonic' ? `steps${SUPERTONIC_STEPS}-speed${SUPERTONIC_SPEED}` : '';
}
