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
 * - A language with `approval.status !== 'approved'` is not shown to users and
 *   is filtered out of `APPROVED_LANGUAGES` below.
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

export interface LanguageStt {
	engine: 'whisper';
	/** Transformers.js repo id. */
	modelRepoId: string;
	dtype: string;
	/** Language name Whisper expects, e.g. `french`. */
	decoderLanguage: string;
	/** ISO 639-1 code used by cloud STT APIs, e.g. `fr`. */
	code: string;
	/** Approximate download size in bytes, used for the combined progress bar. */
	downloadBytes: number;
	approval: LanguageApproval;
}

export interface LanguageVoice {
	id: string;
	name: string;
	/** Path inside `rhasspy/piper-voices`. */
	voicePath: string;
	downloadSize: string;
	/** Approximate download size in bytes, used for the combined progress bar. */
	downloadBytes: number;
	/** eSpeak voice code used by the phonemizer, e.g. `fr`. */
	espeakVoice: string;
	/** `null` leaves the raw model output untouched. */
	processing: AudioProcessingProfile | null;
	approval: LanguageApproval;
}

export interface LanguagePrompt {
	title: string;
	text: string;
}

export interface LanguageDefinition {
	/** ISO 639-1 code, stored in settings and used as the DB key. */
	id: string;
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
		engine: 'whisper',
		modelRepoId: 'onnx-community/whisper-small',
		dtype: 'q4',
		decoderLanguage: 'french',
		code: 'fr',
		downloadBytes: 299_000_000,
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

/** Every language that has ever been declared, approved or not. */
export const LANGUAGES: readonly LanguageDefinition[] = [FRENCH];

/** Languages offered to users. Only human-approved entries pass. */
export const APPROVED_LANGUAGES: readonly LanguageDefinition[] = LANGUAGES.filter(
	(language) => language.approval.status === 'approved'
);

export const DEFAULT_LANGUAGE_ID = FRENCH.id;

export function getLanguage(id: string | null | undefined): LanguageDefinition | undefined {
	if (!id) return undefined;
	return APPROVED_LANGUAGES.find((language) => language.id === id);
}

export function requireLanguage(id: string | null | undefined): LanguageDefinition {
	const language = getLanguage(id) ?? APPROVED_LANGUAGES[0];
	if (!language) throw new Error('No approved languages are configured.');
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

/** Total bytes the user downloads for one language (STT + default voice). */
export function languageDownloadBytes(language: LanguageDefinition): number {
	const voice =
		language.voices.find((entry) => entry.id === language.defaultVoice) ?? language.voices[0];
	return language.stt.downloadBytes + (voice?.downloadBytes ?? 0);
}
