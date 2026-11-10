# Supported languages

The app ships no models. Every language's speech recognition and voice are downloaded by the
user, on demand, from public model hosts. This file explains how languages are tracked and
approved; the machine-readable source of truth is
[`src/lib/languages/index.ts`](../../src/lib/languages/index.ts).

## Where the data lives

| Concern | Location |
|---|---|
| Approval status, STT descriptors, prompts | `src/lib/languages/index.ts` (`LanguageDefinition`) |
| On-device voices by language code (both roles), their approvals and audio profiles | `src/lib/languages/voices.ts` (`VOICES_BY_LANGUAGE`) |
| How the voice worker builds one adapter per voice | `src/lib/speech/tts/local/registry.ts` |
| STT model + language hint | `LanguageDefinition.stt` |
| Voice EQ / compression profile | `LanguageVoice.processing` in `voices.ts` |
| Download + progress + cancel | `src/lib/stores/languageData.ts` |
| Evidence for each approval | `docs/benchmarks/stt.md`, `docs/benchmarks/tts.md` |

## Approval rule

A language is offered to users only when `approval.status === 'approved'`, and every STT model
and voice it lists carries its own approval record (who tested it, when, and where the evidence
lives). This is the same standard the model lab applied: a human must have tested output quality
before a download is exposed, because a 64–299 MB model that fails the classroom is worse than no
model.

The user can decide to offer a language before that review, as they did for Persian (2026-11-07)
and for every language the on-device voices speak (2026-11-08). The approval then records exactly
that (`REQUESTED_LANGUAGE_APPROVAL`: "Offered at the user's request … not yet reviewed"), its
speech-to-text approval stays `candidate` (`WHISPER_NOT_REVIEWED`), and its voices stay
`candidate`, so nothing claims a quality nobody measured. Every voice has still loaded and spoken
in the browser voice check (`/model-lab/voices/`).

## Adding a language

A language an on-device voice already speaks needs only a row in `LANGUAGE_FACTS`
(`src/lib/languages/index.ts`): English and native name, Common Crawl web share, Whisper's name
for it, writing system and direction. It then appears as a study language and a language of
instruction, with the general prompts and its voice sample sentence. A language with no
on-device voice would be a language of instruction only. For a reviewed language with
its own prompts or rules:

1. Evaluate candidate STT models and voices with a human quality pass (listen to the voice, read
   the transcripts). Record the evidence under `docs/benchmarks/`.
2. Add the STT descriptor and voice list to a new `LanguageDefinition` in
   `src/lib/languages/index.ts`, including each entry's `approval` record, its `direction`, and
   its `local` flags (all `false` for a cloud-only language).
3. Add the language's speaking prompts and its `preview` sentence (used by the Settings voice
   preview; keep it short because the first synthesis is the slow part).
4. If the voice needs a tone correction, give it a `processing` profile (4-band EQ, compressor).
   Its level needs none: every on-device clip is brought to the same loudness (−20 LUFS) and kept
   under −1 dBFS by `processPcm` (`src/lib/utils/audioEffects.ts`). The DSP code is generic; only
   the numbers are per-voice.
   Learners can layer their own ±12 dB volume/EQ adjustments on top in Settings → Advanced →
   Voice & audio → Equalizer; those are stored per voice and never modify the approved defaults.
5. Set `approval.status = 'approved'` and run the download flow in a browser before shipping.

## Current state

| Language | Code | Local STT | Default voice | Status |
|---|---|---|---|---|
| French | `fr` | `onnx-community/whisper-small` q4 | Piper Tom (M, medium) | Approved after review (2026-09-13) |
| Japanese | `ja` | `onnx-community/whisper-small` q4 | piper-plus CSS10 (F) | Offered at the user's request (2026-11-08) |
| Persian | `fa` | none (cloud only) | Piper Amir (M, medium) | Approved at the user's request (2026-11-07; on-device read-back 2026-11-08) |
| 32 more: Chinese, Urdu, Bengali and Supertonic's languages | `LANGUAGE_FACTS` | `onnx-community/whisper-small` q4 | Supertonic F1 (Chinese: Piper Huayan; Urdu: Piper Fasih; Bengali: Piper Google) | Offered at the user's request (2026-11-08) |

The full list, and the 35 languages of instruction, are in
[`supported-languages.md`](supported-languages.md). `languages/support.ts` tells the learner in
Settings when their configured engines cannot handle the selected languages.

### Cloud-only steps

`LanguageDefinition.local` says which engines may run on the device (`stt`, `tts`,
`correction`). Persian sets `stt` and `correction` to `false`: no local model has passed the
human quality gates for them, so the app offers no download that cannot be trusted. Its `tts` is
on (Piper's Persian voices). Consequences, all driven by that one object:

- Choosing the language (first run or Settings) switches any Local step to Cloud
  (`stores/practice.ts`), and `initSettings` corrects stale or restored settings.
- `Settings → Processing` locks the three Local/Cloud switches to Cloud with an honest hint, and
  `stores/processing.ts` / `stores/languageData.ts` never ask for local data.
- The first-run language picker disables the local choices and says the language is cloud-only.
- Read-back needs a cloud voice; explanation audio uses the cloud voice path
  (`explanationAudioUnavailable` returns null when `ttsMode === 'cloud'`).

Speech-to-text uses Groq `whisper-large-v3-turbo` with `language=fa`, the LLM any configured
cloud provider, and read-back Piper's Persian voices or OpenAI's speech API (ElevenLabs does not
speak Persian).

### Right-to-left text

`LanguageDefinition.direction` is `rtl` for Persian. Target-language text is laid out from the
script itself (`directionForText` in `utils/words.ts`), so an old Persian take still reads
right-to-left after switching languages, while Latin sample text stays LTR:

- Transcripts set `dir` + `lang` and use the bundled Arabic-script face (`--font-arabic-script`,
  Noto Naskh Arabic, which also backs every UI font stack) when the text is Arabic-script.
- The follow-up question, correction `original`/`replacement`, `formalAlternatives` and the word
  breakdown's source column follow the same rule; the language of instruction stays LTR.
- Sentence and clause splitting accept `؟`, `،` and `؛`, and word tokens keep the zero-width
  non-joiner (U+200C) inside a word (`می‌خواهم`).
- `languageGuidance.ts` adds Persian evaluation and translation rules (script/ZWNJ, formal vs
  colloquial Tehrani register, را/ezafe, a Persian contrastive example).

The full per-language stack (engines, G2P, voices, prompts) is in
[`supported-languages.md`](supported-languages.md).

Candidate entries are committed with `approval.status = 'candidate'`. Production builds offer
approved languages only (`APPROVED_LANGUAGES`); development builds also offer candidates
(`OFFERED_LANGUAGES`), labelled "candidate, not yet approved", so step 5 can be run in the real
app.

## Voices

On-device voices are not part of a `LanguageDefinition`. They live in
`src/lib/languages/voices.ts`, keyed by the ISO 639-1 code of the language they speak, because
a voice serves either role: reading back a target language (`voicesFor`) or reading the
instruction-language half of an explanation (`explanationVoicesFor`). So any of the
`INSTRUCTION_LANGUAGES` with voices in the table gets on-device explanation audio, whatever the
learner studies. A target language lists its voices only when its `local.tts` is on.

Coverage order per language (decided 2026-11-08, `docs/benchmarks/tts.md`):

1. **Supertonic 3**: one shared ~145 MB model (sherpa-onnx int8) for 31 languages, ten voice
   styles (F1–F5, M1–M5). Two Supertonic voices share one loaded model, so an explanation
   whose two voices are both Supertonic stays at about 262 MB of worker memory.
2. **Piper**: the voices already in use (French Tom, UPMC, Siwis, MLS; English Ryan, Lessac,
   Alan, Alba) and the languages Supertonic lacks: Persian (five `fa_IR` voices), Chinese
   (Huayan; rhasspy's other Chinese voices use pinyin phonemes, which eSpeak does not produce),
   Urdu (Fasih, Aegis) and Bengali (Google).
3. **None**: every other language speaks through cloud TTS.

A voice's `engine` selects its TTS path: `piper` (eSpeak G2P), `piper-plus` (OpenJTalk G2P in
WASM, Japanese) or `supertonic` (the prebuilt sherpa-onnx runtime). New voices are committed as
`candidate`; the learner auditions them in Settings. Check that every voice loads and speaks with
the dev-only voice check at `/model-lab/voices/` before shipping a new entry.
