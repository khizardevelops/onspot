<div align="center">

# onspot

### The language app that makes you *speak*, then coaches you like a teacher.

**Stop tapping flashcards. Open your mouth.** onspot gives you a topic, listens to you talk for
a minute, then marks your spoken French the way a good teacher would: every mistake pinned to
the exact words you said, explained in plain English, and read back to you the way a native
speaker would say it.

[Why onspot](#why-onspot) · [Features](#what-it-does) · [How it works](#how-a-session-works) ·
[Privacy](#private-by-design) · [Getting started](#getting-started) · [Languages](#languages) ·
[Tech](#under-the-hood)

![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-0f766e)
![Runs locally](https://img.shields.io/badge/speech-runs%20on%20your%20device-0f766e)
![SvelteKit](https://img.shields.io/badge/SvelteKit-SPA-ff3e00)
![Tauri v2](https://img.shields.io/badge/Tauri-v2-24c8db)
![Status](https://img.shields.io/badge/status-early%20release-b7791f)

</div>

---

## Why onspot

Most language apps teach you to **recognise** a language. You can read the menu, pick the right
answer and finish the streak, then freeze the moment someone asks you a question.

That gap has a name: speaking **on the spot**. It only closes by doing the uncomfortable part,
which is talking, making mistakes and being corrected. onspot is built entirely around that loop:

- **You speak first.** No multiple choice, no word banks. A prompt, a microphone and one minute.
- **You get a teacher's feedback, not a score.** Specific corrections, why they're wrong, and
  what a fluent speaker would actually say.
- **You hear it done right.** The corrected version is read aloud in a natural voice, so the fix
  goes in through your ears as well as your eyes.
- **You do it again.** Retake the same prompt and watch your takes improve side by side.

## What it does

### 🎙️ Speak, don't tap
Get a speaking prompt ("Describe your morning routine", "Talk about a book that changed your
perspective"), hit record and talk for 30–60 seconds, or up to five minutes if you're on a roll.
A live waveform and timer keep you honest.

### 🎭 The real skill: making it up on the spot
**The skill is being able to lie, make up a story and tell it coherently in your target
language.** That's what speaking fluently actually is.

The topic is just a springboard. You don't have to tell the truth. Never been to Paris? Invent a
trip. Boring weekend? Make one up. Lie, exaggerate, turn your morning routine into a heist
thriller. Nobody is checking your story; onspot is checking your **language**.

Why making things up is the point, not a shortcut:

- **Real conversations don't come with a script.** Someone asks a question you didn't expect and
  you have to produce an answer *now*, with the words you have. Inventing a story under a timer
  is exactly that pressure, in a safe place.
- **Speaking exams work the same way.** Oral exams hand you a topic you may know nothing about
  and expect two coherent minutes on it. Candidates who can improvise confidently score; those
  waiting for a true story to remember stall.
- **Stories stretch your grammar.** A good story needs past tenses, sequencing ("first", "then",
  "in the end"), cause and effect, descriptions and reported speech. A true answer to "What did
  you do last weekend?" is often just "Not much". An invented one forces you to use the language
  you've been studying.
- **You learn to talk around gaps.** When you don't know a word, you rephrase, describe it or
  steer the story somewhere you *can* describe. That's the most valuable survival skill a
  speaker has, and you only build it by practising it.
- **Coherence is the test.** Anyone can string sentences together. Keeping characters, times and
  events consistent while you think in another language is the leap from "knows French" to
  "speaks French".

So the only rules are: **keep talking**, do it **in the language you're learning**, and try to say
it **correctly**. Tell the wildest story you like. onspot will mark the grammar, not the plot.

### 🧑‍🏫 Feedback like a teacher
Your answer is transcribed and analysed by a language model briefed to coach, not just grade:

- **Corrections linked to your words.** Mistakes are underlined in your own transcript; click one
  to jump to its explanation, or click the explanation to find it in what you said.
- **Severity at a glance.** Errors, warnings and suggestions are colour-coded, and you can filter
  by grammar, register, filler words or style.
- **Plain-English explanations** of *why*, pitched at your level (A1–C2).
- **Exam or casual mode.** Preparing for an exam? It holds you to formal, correct speech and flags
  anything to strictly avoid. Just chatting? It favours natural, idiomatic phrasing instead.
- **Better connectors and vocabulary.** It suggests upgrades a fluent speaker would plausibly use,
  including formal alternatives to casual fillers.
- **A one- or two-sentence summary** of the thing that matters most.

### 🔊 Hear the fix
- The **natural version** of what you meant is read aloud by a high-quality neural voice.
- **Click any word** in your transcript to hear how it's pronounced.
- **Replay sentence by sentence**, loop it and slow it down.
- Replay **your own recording** straight after, to hear the difference.

### 🌍 Understand every word
Each take can be translated three ways, so you see *how* the language works, not just what it
means:

- **Idiomatic**: how an English speaker would really say it.
- **Literal**: faithful to the original sentence structure.
- **Word-for-word**: every token in order, broken English and all.

There's also a word-by-word breakdown and alternative phrasings when you want to dig deeper.

### 📈 See yourself improve
- **History** keeps every session, grouped by day, searchable (including regular expressions),
  with replay, rename and delete.
- **Insights** finds your *recurring* mistakes across all sessions (the patterns worth drilling)
  and takes you straight back to every time they happened.

### 🎛️ Make it sound right to you
A per-voice **4-band equaliser and volume** with a live preview. Tune the voice until it's
comfortable to listen to for an hour, without ever changing the approved defaults.

## How a session works

```
  Prompt ──▶ You speak ──▶ Transcript ──▶ Teacher-style feedback ──▶ Hear it said right ──▶ Retake
   (topic)    (30–60 s)    (on-device)     (your chosen LLM)          (on-device voice)
```

1. **Pick a prompt** in exam or casual mode.
2. **Speak** about the topic in your target language. True story, made-up story or wild
   exaggeration: it doesn't matter, as long as you keep talking and aim for accuracy. Your audio
   is transcribed **on your device** by Whisper.
3. **Get marked.** The transcript, never your audio, is sent to the language model you chose,
   which returns corrections, explanations, a natural version and translations.
4. **Listen.** The corrected version is spoken **on your device** by a neural voice.
5. **Go again.** Each take slides into place in your timeline, so you can compare attempts.

## Private by design

onspot has **no server, no account and no tracking**. It was built privacy-first from day one:

| | Where it happens |
|---|---|
| Speech recognition (your voice) | **On your device** (Whisper in a Web Worker) |
| Read-aloud voices | **On your device** (Piper neural TTS in a Web Worker) |
| Your sessions, recordings and history | **On your device** (SQLite, in the browser or on the desktop) |
| Feedback and translation | The LLM provider **you** choose, with **your own** API key |

- **Works offline** for recording, transcription and read-back once the language data is
  downloaded. Only the feedback step calls out to your AI provider.
- **Bring your own key (BYOK):** Groq, DeepSeek, or any OpenAI-compatible endpoint. Keys stay in
  your browser and are never written to your database or exports.
- **Your data is portable.** Export everything (sessions, recordings, cached audio, settings) to a
  single `.sqlite` file, and restore it on another browser or computer.
- **Cloud speech is optional and labelled.** Prefer Groq's hosted Whisper or an OpenAI voice? Turn
  them on and the app tells you plainly that audio or text is leaving your device.

## Languages

| Language | Status | Speech recognition | Voice |
|---|---|---|---|
| 🇫🇷 French | ✅ Ready | Whisper small (q4) | Piper Tom + 3 more voices |
| 🇯🇵 Japanese | 🧪 In development | Whisper small (q4), shared with French | piper-plus with OpenJTalk (3 voices) |

Nothing is bundled with the app: each language's models download on demand from their public
hosts, and languages share what they can. Japanese reuses French's speech model, so it adds only
about 100 MB. Settings tells you exactly how much space a language will take before you download
it. Full model list and sizes: [`docs/supported-languages.md`](docs/supported-languages.md).

A language only ships once a human has **listened to its voices and checked its transcripts**.
Model choices are made by measurement, not marketing: French speech recognition runs at **5.5%
word error rate** across human-transcribed clips, and the voice won a human listening test against the alternatives. The
evidence is in [`docs/benchmarks/`](docs/benchmarks/README.md).

## Getting started

### Requirements

- **Node.js 20.19+ or 22.12+** and npm
- A modern browser (Chromium or Firefox). Speech runs on **WebAssembly**, so no GPU is needed.
- About **400 MB** of free space for a language's models
- An API key from an LLM provider for feedback. [Groq](https://console.groq.com) has a free tier.
- *(Desktop only)* the [Rust toolchain and Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Run it

```sh
git clone <this-repo> onspot && cd onspot
npm install

# Restore the French pronunciation data (18 MB, gitignored)
mkdir -p static/piper-wasm
cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} static/piper-wasm/

npm run dev          # web app at http://localhost:5173
npm run tauri dev    # desktop app
```

Then, in the app:

1. **Settings → Language data → Download** (one-time, cached afterwards)
2. **Settings → AI provider**: paste your API key and press **Test connection**
3. Allow the **microphone** when asked, pick a prompt, and start talking

### Build

```sh
npm run build        # static web build in build/
npm run tauri build  # desktop installer
npm run check        # type-check
```

The web build is a static site, but it must be served with cross-origin isolation headers, which
local speech needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

## Under the hood

| Layer | Technology |
|---|---|
| App | [SvelteKit](https://svelte.dev) (Svelte 5), static SPA via `adapter-static` |
| Desktop | [Tauri v2](https://tauri.app) |
| UI | [`@dvcol/neo-svelte`](https://github.com/dvcol/neo-svelte) neumorphic components, Tailwind CSS v4, a paper-textured theme with light and dark modes |
| Speech-to-text | [Transformers.js](https://huggingface.co/docs/transformers.js) running `whisper-small` q4 on ONNX Runtime Web (WASM), in a Web Worker |
| Text-to-speech | [Piper](https://github.com/rhasspy/piper) and [piper-plus](https://github.com/ayutaz/piper-plus) VITS voices on ONNX Runtime Web, in a lazily loaded Web Worker |
| Pronunciation (G2P) | eSpeak-ng (French), OpenJTalk/jpreprocess compiled to WASM (Japanese) |
| Audio | Web Audio: EQ, compressor, limiter and loudness normalisation per voice |
| Storage | SQLite everywhere: `sqlite-wasm` on OPFS in the browser, native SQLite on desktop, behind one adapter |
| Feedback | Any OpenAI-compatible chat API (Groq, DeepSeek, custom) |

Heavy work never touches the interface thread: transcription, speech synthesis and the database
each run in their own worker, so the app stays responsive while a model downloads or a voice
speaks.

## Roadmap

- **Sync to your own cloud**: Google Drive and WebDAV (Nextcloud, ownCloud, pCloud), still with
  no onspot server
- **More languages**, each approved through a human listening test and transcript review
- Pronunciation scoring and spaced-repetition drills built from your recurring mistakes

## Contributing

Issues and pull requests are welcome. Before proposing a new model or voice, read
[`docs/languages.md`](docs/languages.md): a model is only accepted once it has loaded and produced
output in a real browser and passed a human quality check. The project's working notes,
decisions and command reference live in [`.agents/handoff/`](.agents/handoff/README.md).

## Licence

onspot is free software under the **GNU Affero General Public License v3.0 or later**. See
[`LICENSE`](LICENSE). Model weights and voices are downloaded from their own hosts under their own
licences, listed in [`docs/supported-languages.md`](docs/supported-languages.md).
