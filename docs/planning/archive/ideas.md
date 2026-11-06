# Archived ideas

> Archived 2026-11-03 from `docs/planning/ideas.md`. Frozen; current work is in
> [`docs/planning/ideas.md`](../ideas.md).

## Archived 2026-11-06

### First-run onboarding for keys (implemented 2026-11-06)

A new `/welcome/` setup guide opens automatically on a device with no usable LLM (and not after a
skip or completion). It walks through the coach key first: a free Groq key (recommended, and it can
transcribe speech too), DeepSeek, ChatGPT/OpenAI, or a Claude/OpenAI-compatible gateway. It links
to each key page, tests the key before saving it, and never saves one that fails. A second step
asks about the voice only when the learner is choosing one: on-device Piper (private, free, flat,
one-time download) or ElevenLabs (better sounding, needs a key and credits). The guide is honest
that cloud TTS sounds better. Settings → Learning → **Setup guide** reopens it, and Practice's
"Set up LLM" gate goes there too. The page uses the app's paper/card language and works in light,
dark and at phone width.

### Mode-coloured background glare (implemented 2026-11-06)

The Practice ambience follows the live mode: blue-green in casual, red/error in exam. The mode
switch only exists in a draft, so changing it there updates the glare immediately; once a session
has takes the mode is locked. Three large soft blobs sit low in the visible page and drift slowly
(38/46/52s transform-only animations, stopped by reduced motion); exam uses a stronger colour mix
than casual so the red does not read dimmer. The tone is a data attribute on the practice grid that
swaps the ambient inks and the stage's top-left wash (`PracticeScreen.svelte`).

### Explain what onspot can and cannot improve (implemented 2026-11-06)

Settings → Learning → **What onspot can and cannot improve** states the coach's scope in two
columns: it helps with spontaneous speaking, grammar, vocabulary and register; it does not judge
accent, score pronunciation or certify an exam. The note explains that feedback comes from the
words the learner produced, so the app does not guess at sound.

### Export a session transcript (implemented 2026-11-06)

A session can be saved as a Markdown file from History's row action or the Practice session menu.
The export contains the session's title, date and mode, then every take: the prompt, **You said**,
**Did you mean to say?**, the explanation with its tags stripped, the follow-up, stored translation
variants and each correction with its category, severity, replacement and explanation
(`utils/sessionTranscript.ts`). It uses the desktop save dialog where one exists and a browser
download elsewhere.

### Download notifications (implemented 2026-11-06)

The language-data progress bar already followed the learner across pages. Finishing now raises a
6 s toast saying the data is ready to use offline, and a failure says what went wrong. When the app
is in the background, the same message goes to the device as a system notification if the learner
has allowed notifications (`stores/languageData.ts`, `platform/notifications.ts`).

### Practice reminders (implemented 2026-11-06)

Settings → Learning → **Practice reminders** is off by default. When on, a gentle nudge appears in
Practice after a practice gap: about one day for **Frequent**, about three days for **Infrequent**.
A take recorded in the app restarts the clock; **Not now** snoozes the nudge for the chosen cadence.
The reminder is checked on launch, when the app returns to view and every five minutes while open;
with notification permission it can also appear as a system notification while the app is in the
background (`stores/reminders.ts`, `settings/ReminderSettings.svelte`).

### Show the word-for-word mapping as aligned pairs (implemented 2026-11-06)

The **Each word** breakdown under Word-for-word now reads left to right like the sentence: each
pair is its own column with the source word above a short rule and its translation below, both
centred. The row wraps when a take has more or longer words. It is the same layout on phones,
where five short pairs fit in one row at 390 px; the learner may later ask for the earlier
vertical list on phones only (`AttemptCard.svelte`).

## Archived 2026-11-03

### Automatic model choice (implemented 2026-11-01)

Settings → LLM → Model **Automatic** (the default) picks a model per request from the provider's
list in order of accuracy (Groq) or cost (DeepSeek). Less-resourced languages stay on the strongest
model, using each language's Common Crawl share, and requests are steered by the provider's
per-minute and per-day token and request limits (`adapters/llm/providers.ts`, `pacing.ts`).

### Paper-textured background and matching textured cards (implemented)

The app uses a paper-textured page and matching textured cards to give the learning session a
stationery feel.

### Audio file compression (implemented 2026-10-31)

Recordings are stored as Opus: 24 kbps for takes and 32 kbps for read-back. Whisper hears 16 kHz,
which 24 kbps Opus keeps, and the smaller files save space. The recorder uses the platform's Opus
encoder through `MediaRecorder`, with a WASM fallback (`utils/recorder.ts`,
`speech/audioFormat.ts`).

### Switch models to `@wllama/wllama` / GGUF (rejected 2026-09-30)

The idea was to replace the ONNX and Transformers.js models with GGUF versions to cut RAM and disk
use. Rejected: wllama is llama.cpp and runs GGUF LLMs only; it cannot run Whisper or Piper, and the
app has no local LLM. whisper.cpp, the GGUF-style Whisper, was benchmarked at about 4× less RAM
and a smaller download, but 8–12× slower in WASM (a 60 s answer took about 15–20 minutes). Piper
has no GGUF path. Evidence: [`benchmarks/stt.md`](../../benchmarks/stt.md). The follow-up became
"Find a lighter STT model or runtime", which remains active.
