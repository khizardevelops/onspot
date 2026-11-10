# Supported languages

What onspot can teach today, and exactly which speech technology each language uses. The
machine-readable source of truth is [`src/lib/languages/index.ts`](../../src/lib/languages/index.ts);
how a language gets approved is in [`languages.md`](languages.md).

Nothing below is bundled with the app. The learner's device downloads each model on demand
(Settings → Language data) from its public host, keeps it in the browser's Cache API, and runs it
locally. Cloud options are opt-in, bring-your-own-key, and labelled as sending data off the device.

## Overview

**Study languages (35): every language an on-device voice speaks.** Since 2026-11-08 the learner
can study any language in `VOICES_BY_LANGUAGE` (`voices.ts`), at the user's request. Only French
has been reviewed by a human; for the others nothing about recognition or the voices has been
measured yet, and each approval's by-line says so.

| Language | Code | Status | Local STT | Local TTS (default voice) |
|---|---|---|---|---|
| French | `fr` | ✅ Approved after review (2026-09-13) | Whisper small q4 | Piper Tom (M, medium) |
| Japanese | `ja` | Offered at the user's request (2026-11-08), not reviewed | Whisper small q4 | piper-plus CSS10 (F) |
| Persian | `fa` | Cloud recognition (2026-11-07), on-device read-back (2026-11-08) | none — Groq Whisper | Piper Amir (M, medium) |
| Chinese (Simplified) | `zh` | Offered at the user's request (2026-11-08), not reviewed | Whisper small q4 | Piper Huayan |
| Urdu | `ur` | Offered at the user's request (2026-11-08), not reviewed | Whisper small q4 | Piper Fasih (M) |
| Bengali | `bn` | Offered at the user's request (2026-11-08), not reviewed | Whisper small q4 | Piper Google (Bangladesh, speaker 0) |
| Arabic, Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, German, Greek, Hindi, Hungarian, Indonesian, Italian, Korean, Latvian, Lithuanian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Turkish, Ukrainian, Vietnamese | Supertonic's codes | Offered at the user's request (2026-11-08), not reviewed | Whisper small q4 | Supertonic F1 |

They are generated from one table, `LANGUAGE_FACTS` in `src/lib/languages/index.ts` (English and
native name, Common Crawl web share, Whisper's name for the language, writing system and
direction), with the general speaking prompts and the voice sample sentence as their preview.
French, Japanese and Persian keep their own hand-written definitions.

**Languages of instruction (35):** the same table; every one has an on-device voice for
explanations. Web shares are Common Crawl CC-MAIN-2026-43. Nobody is taught a language in itself: a learner of English is taught in
Russian until they choose (the language with the most web text after English,
`defaultInstructionLanguageFor`).

**When the configuration cannot handle a language**, Settings says so (`languages/support.ts`,
shown under Language and under Text-to-speech): no on-device voice for the studied language or
the language of instruction, an ElevenLabs model that does not speak it (Multilingual v2: 29
languages; Flash/Turbo v2.5 adds Hungarian, Norwegian and Vietnamese, per ElevenLabs' "What
languages do you support?", checked 2026-11-08), or OpenAI's own speech API outside its listed
languages. A custom OpenAI-compatible server's languages cannot be known, so nothing is claimed
about it. Whisper (on the device and Groq's) covers every study language.

**Script handling for the new languages:** sentences also end at the Devanagari danda `।`/`॥`
(Hindi, Bengali), the Urdu full stop `۔` and the Greek question mark `;` (U+037E); Chinese text (Han without kana) is split into
words with a Chinese `Intl.Segmenter`, Japanese (with kana) with the Japanese one.

## On-device voices for any language

Voices are listed by the language they speak in
[`src/lib/languages/voices.ts`](../../src/lib/languages/voices.ts), and serve either role:
reading back a target language, or the instruction-language half of an explanation.

| Engine | Languages | Download | Notes |
|---|---|---|---|
| Supertonic 3 (int8, sherpa-onnx) | ar bg cs da de el en es et fi fr hi hr hu id it ja ko lt lv nl pl pt ro ru sk sl sv tr uk vi | ~145 MB once, shared by every Supertonic voice | 10 styles (F1–F5, M1–M5), 44 kHz; 8 denoising steps at speed 1.05, Supertone's reference settings (3 steps sounded watery); weights OpenRAIL-M |
| Piper (medium) | fr, en (existing voices), **fa** (Amir, Ganji, Ganji Adabi, Gyro, Reza Ibrahim), **zh** (Huayan), **ur** (Fasih M, Aegis F; MIT), **bn** (Google, 16 speakers, the first is used; OpenSLR 37 CC BY-SA 4.0 + CMU Indic) | ~63–77 MB per voice | eSpeak G2P (`static/piper-wasm/`, which already holds `ur_dict`/`bn_dict`); 22 kHz (Tom 44 kHz) |
| piper-plus | ja | ~40 MB per voice + 60 MB dictionary | OpenJTalk G2P |
| none | any other code | — | cloud TTS only |

Measured in Chromium on one WASM thread (2026-11-08, `docs/benchmarks/tts.md`): at 8 denoising
steps Supertonic speaks a sentence at rtf ~1.6 on an unloaded laptop (5 steps: ~1.0); fewer steps
are faster but leave high-frequency noise. Feedback comes after the take, so clips are prepared
ahead of time. Both voices from one Supertonic model use ~262 MB of worker memory. A pair that includes a
Piper voice uses more (300–490 MB); the worker's idle shutdown returns it.

## Model sizes

Sizes are what each model occupies on the device (browser Cache API). The download can be smaller
when the host compresses it; that is noted where it differs.

| Language | Part | Model | On device | Download |
|---|---|---|---|---|
| French | STT | Whisper small q4 (`onnx-community/whisper-small`) — **shared by all languages** | ~299 MB | ~299 MB |
| French | TTS | Piper Tom (M, medium, 44 kHz) — default | ~64 MB | ~64 MB |
| French | TTS | Piper UPMC (medium, 2 speakers) | ~77 MB | ~77 MB |
| French | TTS | Piper Siwis (F, medium) | ~63 MB | ~63 MB |
| French | TTS | Piper MLS (medium, 125 speakers) | ~77 MB | ~77 MB |
| Any of 31 | TTS | Supertonic 3 int8 (10 styles, 44 kHz) — **one model for every Supertonic voice** | ~145 MB | ~145 MB |
| French | G2P | eSpeak-ng French data (`@diffusionstudio/piper-wasm`) | 18 MB | served with the app, not downloaded |
| Japanese | STT | Whisper small q4 — **the same file as French** | ~299 MB (0 if already installed) | ~299 MB (0 if already installed) |
| Japanese | TTS | CSS10 (F, 22 kHz, fp16) — default | ~40 MB | ~40 MB |
| Japanese | TTS | Mera (F, 22 kHz) | ~39 MB | ~39 MB |
| Japanese | TTS | Tsukuyomi-chan (F, 22 kHz, fp16) | ~40 MB | ~40 MB |
| Japanese | G2P | OpenJTalk/jpreprocess dictionary (NAIST-JDIC, WASM) — shared by all Japanese voices | ~60 MB | ~20 MB (compressed) |

What installing a language actually costs (STT + default voice + its G2P):

| Situation | Adds on device | Download |
|---|---|---|
| French on a fresh device | ~363 MB | ~363 MB |
| Japanese on a fresh device | ~399 MB | ~359 MB |
| Japanese when French is already installed | **~100 MB** | **~60 MB** |
| Another Japanese voice, after the first | ~40 MB | ~40 MB |

The app shows the real figure for the current device in Settings → Language data ("Adds about …
to this device · about … to download"), computed from what is already cached; verified
2026-09-25: installing Japanese after French fetched no Whisper bytes, only 19.8 MB of dictionary
and 39.7 MB of voice.

**Candidate** means the stack loads and speaks in the browser, but no human has yet approved the
transcription quality or the voices. Production builds hide candidates; development builds show
them marked "candidate, not yet approved" so the listening test can be run in the real app.

## Shared runtime (all languages)

| Layer | Technology |
|---|---|
| Speech-to-text engine | [Transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`), ONNX Runtime Web **WASM** backend, in the STT Web Worker (`src/lib/speech/stt/transformers/stt.worker.ts`) |
| Long recordings | Sequential 30 s Whisper windows seeking to the last timestamp (not pipeline chunking) |
| Text-to-speech runtime | The lazy on-device voice worker (`src/lib/speech/tts/local/tts.worker.ts`): Piper and piper-plus on `onnxruntime-web` (WASM), Supertonic on the prebuilt sherpa-onnx WASM runtime (`static/sherpa-onnx/`, from `scripts/sherpa-tts-assets.sh`). Two voices resident (target + explanation); two Supertonic voices share one model; the worker ends after 90 s idle |
| Model storage | Browser Cache API: `transformers-cache` (STT), `onspot-tts-cache` (voices, phonemizers) |
| Speech cache | Rendered read-backs stored in the local SQLite DB, keyed `tts:<mode>:<language>:<voice>:<tuning>:<hash>`; cloud keys also include the provider, endpoint, model and API voice |
| Audio post-processing | Per voice: 4-band EQ and compressor (Web Audio) plus the learner's Advanced EQ; then every clip is leveled to −20 LUFS (BS.1770) and peak-limited at −1 dBFS (`src/lib/utils/audioEffects.ts`) |
| Evaluation & translation | Any OpenAI-compatible LLM the learner configures (BYOK: Groq, DeepSeek, a local LM Studio / llama.cpp / Ollama server, …); prompts in `src/lib/adapters/llm/` |
| Cloud STT (optional) | Groq `whisper-large-v3-turbo` (BYOK) |
| Cloud TTS (optional) | ElevenLabs multilingual voices, or any OpenAI-compatible speech API (BYOK) |

## French (`fr`) — approved

### Speech-to-text

| | |
|---|---|
| Model | [`onnx-community/whisper-small`](https://huggingface.co/onnx-community/whisper-small), `q4` — **~299 MB** |
| Decoder language | `french` |
| Quality | 5.5 % aggregate WER over three human-transcribed clips — [`benchmarks/stt.md`](../benchmarks/stt.md) |
| Cloud fallback | Groq `whisper-large-v3-turbo`, language `fr` |

### Text-to-speech

| | |
|---|---|
| Engine | [Piper](https://github.com/rhasspy/piper) VITS, run directly on onnxruntime-web (`PiperAdapter`) |
| Grapheme-to-phoneme | eSpeak-ng French, via [`@diffusionstudio/piper-wasm`](https://www.npmjs.com/package/@diffusionstudio/piper-wasm) (18 MB, served from `static/piper-wasm/`) |
| Voices ([`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices)) | Piper Tom (M, medium, 44 kHz, ~64 MB) — **default**, with an EQ and compression profile · Piper UPMC (medium, 2 speakers, ~77 MB) · Piper Siwis (F, medium, ~63 MB) · Piper MLS (medium, 125 speakers, ~77 MB) |
| Approval | Human listening test, 2026-09-13 — [`benchmarks/tts.md`](../benchmarks/tts.md) |

### Language model prompts

Shared evaluation/translation prompts with a French contrastive example that keeps literal and
word-for-word translations structurally distinct.

## Japanese (`ja`) — offered at the user's request, not reviewed

### Speech-to-text

| | |
|---|---|
| Model | [`onnx-community/whisper-small`](https://huggingface.co/onnx-community/whisper-small), `q4` — **~299 MB**, the same weights as French, so a device that has French data does not download them again (0 MB extra) |
| Decoder language | `japanese` |
| Quality | Not yet measured. Needs a transcript review on real, human-transcribed Japanese speech (character error rate) before approval |
| Cloud fallback | Groq `whisper-large-v3-turbo`, language `ja` |

### Text-to-speech

The official Piper Japanese voice (`hi_fi_captain`) needs Piper 1.7's own OpenJTalk phoneme
scheme and is licensed CC BY-NC-SA, and no browser build of `jpreprocess` exists to feed the
existing eSpeak-based Piper path. Japanese therefore uses **piper-plus**, a Piper fork built for
Japanese, as a second engine in the same TTS worker.

| | |
|---|---|
| Engine | [piper-plus](https://github.com/ayutaz/piper-plus) VITS, run directly on onspot's onnxruntime-web (`PiperPlusAdapter`) with piper-plus's short-text padding/trim helpers ([`piper-plus`](https://www.npmjs.com/package/piper-plus) 0.7.0, MIT) |
| Grapheme-to-phoneme | OpenJTalk-compatible **jpreprocess** front end with the NAIST-JDIC dictionary, compiled to WASM by piper-plus. Produces phoneme IDs plus per-phoneme pitch-accent features (A1/A2/A3). 60 MB (~20 MB transferred), downloaded once from unpkg, **SHA-256-verified** against the npm release before it runs, shared by all Japanese voices (`src/lib/speech/tts/piper/japaneseG2p.ts`) |
| Model inputs | `input`, `input_lengths`, `scales`, `lid` (language id), `prosody_features`, and a zero `speaker_embedding` (+ mask) where the export requires one |
| Voices | **CSS10 (F)** — default; CSS10 Japanese public-domain audiobook data, ~40 MB fp16 · **Mera (F)** — Apache-2.0, ~39 MB · **Tsukuyomi-chan (F)** — Tsukuyomi-chan corpus terms (credit required), ~40 MB. All 22 kHz |
| Correction profile | None yet (raw output); set after the listening test if needed |

### Transcript handling

- Words are split with `Intl.Segmenter('ja')` (the browser's ICU dictionary), with inflections
  re-joined onto their word (食べました, 美味しかったです) and particles kept separate, so every word
  can be clicked to hear it and corrections underline the right characters
  (`src/lib/utils/words.ts`). French keeps its space/apostrophe rule unchanged.
- Sentences split on `。！？` as well as `.!?…`; the adaptive transcript font counts Japanese
  characters as double width.

### Language model prompts

`src/lib/adapters/llm/languageGuidance.ts` adds Japanese rules to the shared prompts:

- Keep the transcript unspaced and unromanized; copy corrections character-for-character.
- Do not "correct" the recognizer's kanji/kana spelling choices.
- Grammar focus: particles, conjugation, counters, plain/polite mixing. Exam mode expects
  consistent です/ます and no casual contractions; casual mode accepts plain forms.
- Fillers (えーと, あの, まあ, なんか) and mode-appropriate spoken connectors.
- Readings for beginners: kana + romaji for any kanji in a suggestion.
- Translations: literal keeps Japanese information order; word-for-word keeps SOV order and marks
  particles (`[topic]`, `[object]`, …); the word breakdown gives romaji plus gloss. A Japanese
  contrastive example replaces the French one. CEFR levels are also given as the nearest JLPT level.

### Smoke evidence (not approval)

2026-09-25, Chromium and Firefox: all three voices load and speak; a TTS → Whisper round trip
recovered 日本語を話す練習を毎日しています。 exactly from CSS10 and Mera, with typical small-model
confusions elsewhere (駅→歴, 京都→境界). Synthetic audio is never scored — approval still needs
the human listening test and a transcript review on real recordings.

### What approval needs

1. Listening test of the three voices; pick the default and any correction profile.
2. Transcript review of whisper-small on real Japanese learner speech with human transcripts.
3. Record both in `benchmarks/tts.md` / `benchmarks/stt.md`, set `approval.status = 'approved'`
   on the language, its STT and the approved voices, and run the download flow in a production
   build.

## Persian (`fa`) — cloud recognition, on-device read-back

Persian recognition and correction have no on-device stack: the learner supplies cloud keys for
them, and the app never offers a local option it cannot stand behind. Read-back can run on the
device since 2026-11-08 with Piper's five Persian voices, which load and speak in the browser
voice check (`LanguageDefinition.local = { stt: false, tts: true, correction: false }`).

| | |
|---|---|
| Speech-to-text | Groq [`whisper-large-v3-turbo`](https://console.groq.com/docs/speech-to-text), `language=fa` — no download |
| Correction & translation | Any configured cloud LLM (Groq / DeepSeek / custom), with Persian rules in `adapters/llm/languageGuidance.ts` |
| Text-to-speech | Piper Amir, Ganji, Ganji Adabi, Gyro or Reza Ibrahim on the device (candidates); or OpenAI's speech API. ElevenLabs Multilingual v2 and Flash/Turbo v2.5 do not speak Persian, and Settings says so |
| Script | Perso-Arabic, right-to-left; `direction: 'rtl'` in the registry |
| Status | Approved at the user's request (2026-11-07, read-back on the device 2026-11-08); no model quality claim |

Choosing Persian switches speech-to-text and correction to Cloud, and Settings → Processing locks
those two switches with an honest hint.

### Right-to-left handling

- `directionForText()` (`utils/words.ts`) picks RTL for Arabic-script or Hebrew text, `auto`
  otherwise, so transcripts, corrections, follow-up questions and word lists lay out correctly
  without trusting the current setting — an old Persian take stays RTL after switching away.
- Arabic-script text (Persian, Arabic, Urdu) is drawn by one bundled face, Noto Naskh Arabic
  (`@fontsource/noto-naskh-arabic`, regular and bold, Arabic subset only). It backs every UI stack
  (`--font-sans`, `--font-serif`, `--font-mono`, `--neo-font-family`) and is
  `--font-arabic-script` for target-language words set on their own. A word must never be drawn
  by two fonts: letters from different fonts do not join (Urdu explanations drew کہا as ک + o + ا
  when a system font lacked ہ and ے).
- Sentence/clause splitting accepts `؟`, `،` and `؛`; word tokenization keeps the zero-width
  non-joiner inside a word (`می‌خواهم`, `کتاب‌ها`).
- The Persian LLM guidance covers script and ZWNJ preservation, formal vs colloquial Tehrani
  register, the را object marker and ezafe, plus a Persian contrastive translation example.

### What local support would need

1. A Persian STT model (or Whisper's Persian quality verified on learner speech) that passes the
   human gates in `languages.md`, and a correction model that writes good Persian.
2. Set the matching `local` flags to `true` and flip the processing copy from "cloud only" to a
   normal Local/Cloud choice.
