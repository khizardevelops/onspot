# Supported languages

What onspot can teach today, and exactly which speech technology each language uses. The
machine-readable source of truth is [`src/lib/languages/index.ts`](../../src/lib/languages/index.ts);
how a language gets approved is in [`languages.md`](languages.md).

Nothing below is bundled with the app. The learner's device downloads each model on demand
(Settings → Language data) from its public host, keeps it in the browser's Cache API, and runs it
locally. Cloud options are opt-in, bring-your-own-key, and labelled as sending data off the device.

## Overview

| Language | Code | Status | Local STT | Local TTS (default voice) |
|---|---|---|---|---|
| French | `fr` | ✅ Approved (2026-09-13) | Whisper small q4 | Piper Tom (M, medium) |
| Japanese | `ja` | 🧪 Candidate — shown in dev builds only | Whisper small q4 | piper-plus CSS10 (F) |

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
| Speech-to-text engine | [Transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`), ONNX Runtime Web **WASM** backend, in the STT Web Worker (`src/lib/workers/stt.worker.ts`) |
| Long recordings | Sequential 30 s Whisper windows seeking to the last timestamp (not pipeline chunking) |
| Text-to-speech runtime | `onnxruntime-web` (WASM), in the lazy TTS Web Worker (`src/lib/workers/tts.worker.ts`); one voice resident, released after 90 s idle |
| Model storage | Browser Cache API: `transformers-cache` (STT), `onspot-tts-cache` (voices, phonemizers) |
| Speech cache | Rendered read-backs stored in the local SQLite DB, keyed `tts:<mode>:<language>:<voice>:<tuning>:<hash>` |
| Audio post-processing | Web Audio chain per voice: 4-band EQ, compressor/limiter, makeup gain, peak normalization (`src/lib/utils/audioEffects.ts`), plus the learner's Advanced EQ |
| Evaluation & translation | Any OpenAI-compatible LLM the learner configures (BYOK: Groq, DeepSeek, …); prompts in `src/lib/adapters/llm/` |
| Cloud STT (optional) | Groq `whisper-large-v3-turbo` (BYOK) |
| Cloud TTS (optional) | OpenAI-compatible speech API (BYOK) |

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
| Voices ([`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices)) | Piper Tom (M, medium, 44 kHz, ~64 MB) — **default**, with an EQ/loudness correction profile · Piper UPMC (medium, 2 speakers, ~77 MB) · Piper Siwis (F, medium, ~63 MB) · Piper MLS (medium, 125 speakers, ~77 MB) |
| Approval | Human listening test, 2026-09-13 — [`benchmarks/tts.md`](../benchmarks/tts.md) |

### Language model prompts

Shared evaluation/translation prompts with a French contrastive example that keeps literal and
word-for-word translations structurally distinct.

## Japanese (`ja`) — candidate

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
| Grapheme-to-phoneme | OpenJTalk-compatible **jpreprocess** front end with the NAIST-JDIC dictionary, compiled to WASM by piper-plus. Produces phoneme IDs plus per-phoneme pitch-accent features (A1/A2/A3). 60 MB (~20 MB transferred), downloaded once from unpkg, **SHA-256-verified** against the npm release before it runs, shared by all Japanese voices (`src/lib/adapters/tts/japaneseG2p.ts`) |
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
