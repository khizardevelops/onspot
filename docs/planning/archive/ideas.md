# Archived ideas

> Archived 2026-11-03 from `docs/planning/ideas.md`. Frozen; current work is in
> [`docs/planning/ideas.md`](../ideas.md).

## Archived 2026-11-07

### iPhone and iPad as an installable PWA (implemented 2026-11-07)

iOS is the only platform without onspot, and the App Store needs a paid Apple account, so the
static web build ships as an installable home-screen app instead. Live at
[onspot.khizardevelops.workers.dev](https://onspot.khizardevelops.workers.dev) as Cloudflare
Workers static assets, deployed with `cf deploy --prebuilt` (`cf` cannot build SvelteKit directly;
`scripts/cf-deploy.sh` assembles the Build Output Specification). It has a web manifest, 192/512/
maskable icons and 28 iOS launch images, iOS meta tags with a theme-aware status bar, a
production-only service worker (offline shell, cached SQLite WASM, waiting-worker Reload prompt,
never registered in dev or the Tauri apps), and a dismissible install card plus a permanent
Settings → iPhone and iPad section. Local speech downloads stay available; cloud speech is a
recommendation on iPhone, and system notifications are honestly reported as unavailable there.
The brief is [`docs/prompts/ios-focused-pwa.md`](../../prompts/ios-focused-pwa.md); the platform
notes are in [`docs/architecture/platforms.md`](../../architecture/platforms.md#ios-and-ipados-pwa).

Remaining (tracked in `.agents/handoff/memory/tasks.md`): a real-device pass, the Google OAuth web
origin, Google Drive/WebDAV in the installed app, local model measurements on an iPhone, and the
GitHub Pages export-and-move notice.

### Persian support (cloud only) and right-to-left text (implemented 2026-11-07)

Persian ships with the cloud pipeline only: Groq `whisper-large-v3-turbo` (`language=fa`) for
speech-to-text, any configured cloud LLM for corrections and translation, and ElevenLabs or an
OpenAI-compatible voice for read-back. No local model has passed the human quality gates, so the
registry's `local` flags are all `false` and the app offers no download it cannot stand behind:
choosing Persian switches any Local step to Cloud, Settings → Processing locks the three switches
to Cloud with an honest hint, and the first-run picker disables the local choices.

Right-to-left text is decided by the script itself (`directionForText`), so transcripts,
corrections, follow-up questions, word lists and the Text size sample lay out RTL with a Persian
font stack, while the language of instruction stays LTR. `؟`, `،` and `؛` split sentences and
clauses, word tokens keep the zero-width non-joiner, and the LLM prompts carry Persian rules
(script/ZWNJ preservation, formal vs colloquial register, را/ezafe, a contrastive example). Details:
[`docs/architecture/supported-languages.md`](../../architecture/supported-languages.md#persian-fa--cloud-only).
The follow-up, finding local models for cloud-only languages, stays active in `ideas.md`.

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

## Archived 2026-11-10

### About page with GitHub/Twitter links (implemented 2026-11-10)

Added a dedicated `/about` route with the app's aims, a "What it can and cannot do" section
(two columns: what it helps with vs. what it does not), a link to the GitHub repo
(`github.com/khizardevelops/onspot`), and a link to the developer's X/Twitter
(`@khizardevelops`). The pre-existing "What onspot does" section was removed from Settings
and replaced with a plain link to the new About page. The About page icon (Info) was added
to the main navigation bar alongside the existing Practice/History/Insights/Settings keys.

### Language-aware prompts (implemented 2026-11-10)

When the learner changes their instruction language (e.g. from English to French), the
practice-topic prompt shown in the bar is now translated into that language in the background.
A new `promptDisplayText` field in `PracticeState` holds the translated version;
`prompt.text` (always English) remains the canonical seed. Translation falls back to English
silently on any error. The `setInstructionLanguage` function in `practice.ts` replaces the
previous `setSetting('instructionLanguage', …)` call in Settings so the prompt re-translates
immediately on change.

### Dynamic font size for follow-up questions (implemented 2026-11-10)

The follow-up question text now scales dynamically based on its length. Short questions render
at up to 22 px (≈1.5× the base); long questions shrink to a floor of 12 px. The calculation
uses the existing `fitFontSize` utility (area model, no DOM measurement) and is applied via a
CSS custom property `--follow-up-font-scale` on the follow-up container. The learner's
text-size preference (Settings → Text size) is multiplied in, so both scales compose cleanly.

### Part-of-speech info in word-hover tooltips (implemented 2026-11-10)

A new **Show part of speech in word tooltips** toggle in Settings (Language section) lets the
learner see whether a hovered word is a noun, verb, adjective, etc. When enabled, the LLM
returns a `pos` object alongside the glosses; POS is stored in a new optional `pos` array in
`TextGlosses` and shown as the detail line in the hover label. Disabled by default so existing
users are not affected. Requires a new hover to fetch updated data.

### Free-flow speaking mode (implemented 2026-11-10)

A third practice mode, **Free Flow**, is now available alongside Exam and Casual. In Free Flow
the learner speaks about anything they like without a set topic; the bar shows "Speak freely —
say anything you like" in a muted italic. The LLM evaluates grammar, vocabulary and register
as usual but also assesses coherence and substance (was the speech logically connected and
meaningful, or rambling?). The mode selector in the bar and the Default mode setting in
Settings both include the new option. History shows "Free Flow" for sessions recorded in this
mode. The evaluation prompt sends no topic line to the model in this mode.
