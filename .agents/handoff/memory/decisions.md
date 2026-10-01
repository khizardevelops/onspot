# Decisions

### STT runtime: stay on Transformers.js, not whisper.cpp / wllama (2026-09-30)
wllama is llama.cpp for GGUF LLMs; it cannot run Whisper or Piper and there is no local LLM.
whisper.cpp (`@transcribe/shout`) was measured on `/stt-bench/`: ~0.6 GB browser PSS vs
~2.4 GB, 190/264 MB vs 299 MB, q8_0 same WER on eval2 — but rtf 14.6 (q5_1) / 22.7 (q8_0)
against 1.81 on the same machine, and it needs SharedArrayBuffer (absent in the Android
WebView). Evidence: `docs/benchmarks/stt.md`. Revisit only if a WASM whisper.cpp build is
shown to run near real time.

### Japanese TTS: piper-plus engine, not Piper + jpreprocess (2026-09-25)
No jpreprocess WASM exists for the browser; the official Piper Japanese voice needs Piper 1.7's
own OpenJTalk scheme and is non-commercial. piper-plus (MIT) ships exactly the requested
technology (jpreprocess/OpenJTalk G2P in WASM + VITS) and MIT/Apache/PD-data voices. It runs as a
second adapter in the existing TTS worker on our ORT instance; its `PiperPlus` class is not used
(it re-downloads without cache/progress and silently drops Japanese if G2P fails). The 60 MB
phonemizer is fetched from unpkg and SHA-256-verified, never bundled.

Settled calls and the evidence behind them. Reversing one needs new evidence, not a hunch. Raw
measurements live in `docs/benchmarks/`; the summaries below link there rather than repeat tables.

## STT model: `whisper-small q4` (299 MB)
5.5% aggregate WER over three clips, stable across them (4.5-6.8%). The alternatives:
base fp32 9.9%, base q4 11.0%, French fine-tune 21.7%. Costs rtf 1.48 — slower than real time,
accepted because transcript quality is what this app needs.

## Long-form decoding: sequential windows, not pipeline chunking
Transformers.js' overlap merge drops whole chunks without timestamps and swings from 8.0% to
63.2% WER over a two-second stride change; `stride >= chunk/2` never terminates. Sequential
windows seeking to the last emitted timestamp: 7.2%, and ~2x faster.

## Device: WASM, not WebGPU
WebGPU is available here and builds sessions, but returns 92% WER at q4 and 68.8% at int8
against 9.6% on WASM. This reverses an approved decision; the approval was conditional on
quantized weights needing WebGPU, and they do not.

## Precision: q4 only
int8/uint8/q8 all fail to build a session — one broken export under three names, with a 4-bit
`embed_tokens` missing its scale. Confirmed across `whisper-base`, `whisper-base-ONNX` and
`whisper-small`. fp16 fails separately (no float16 path on WASM).

## TTS voice: `Piper Tom (M, medium)`, decided by listening test
STT-style benchmarks (rtf, round-trip WER) measure speed and intelligibility, not how a voice
sounds — so the TTS choice was made by ear, not by the numbers `docs/benchmarks/tts.md` tracks.
Ranked 2026-09-13: 1) Piper Tom (M, medium) — needs an EQ boost in the high end and more
loudness; 2) Piper UPMC, jessica (#0); 3) Piper Siwis (F, medium); 4) Piper UPMC, pierre (#1).
`Piper MLS (medium)` (125 speakers) kept unranked for later individual auditioning. Removed
from the registry entirely (not just unranked): `Piper Siwis (F, low)`, MMS-TTS French at all
three precisions, Audio8 TTS 0.6B (remote), Web Speech API — each lost the listening test or a
technical gate. Their evidence stays in `docs/benchmarks/tts.md`.

## Rejected: `whisper-small-cv11-french`
Best single-clip score of any model (2.4% on set1) and the worst aggregate (21.7%). Truncates,
emits filler dots, mangles proper nouns. Kept out of the registry with a comment saying why.

## Rejected: Kokoro-82M for French
kokoro-js ships a frozen English-only voice registry; `ff_siwis` downloads but cannot be
registered. Its own model card grades French **B- on <11 hours**, a single voice. Its G2P
dependency (`phonemizer`) is English-only too.

## Rejected: Matcha-TTS
No French model exists anywhere. sherpa-onnx's French offering *is* Piper.

## French G2P: `@diffusionstudio/piper-wasm`
The only browser eSpeak build carrying French data. 18 MB, gitignored, shared by every Piper
voice. Call it with the input as a JSON **array**; a bare object aborts with an opaque
emscripten pointer.

## Piper implemented directly, not via `piper-tts-web`
That package pins onnxruntime-web 1.20 and Transformers 3.3. With kokoro-js also present that
would be three Transformers copies and two ORT versions in one page.

## Separate ONNX Runtimes for Piper and Transformers.js
Sharing one via `globalThis[Symbol.for('onnxruntime')]` makes Transformers.js take a branch
that never populates `supportedDevices`, breaking every model load.

## One card per download
Voice, precision and repo differences are separate cards. Speaker-within-a-voice and OS-voice
pickers stay as card config, because they reuse the same weights.

## `eval/` is the single source of truth for test data
Discovered by `import.meta.glob`; never copied into `public/` or inlined into source. Four
genuine transcript errors in set1 and one in eval3 were corrected; `Et bien`/`Eh bien` was
deliberately left alone as contested and acoustically identical.

---

## Product architecture (Phase 1)

### SvelteKit SPA, not the Vite+Svelte starter
The inception requires `@sveltejs/adapter-static` with `fallback: 'index.html'` for a purely
client-side app. Migrated the root Vite project in place, keeping the adapters and utilities.
`prerender` is **false**: `prerender = true` makes adapter-static write a second `index.html`
that the fallback then overwrites.

### COOP/COEP via a Vite middleware, not `server.headers`
SvelteKit's Vite plugin installs its own dev/preview servers and drops `server.headers` /
`preview.headers`. A `configureServer`/`configurePreviewServer` middleware sets them instead.
Verified `crossOriginIsolated === true` in headless Chromium.

### DB abstraction: one CRUD layer over a `SqlDriver`
`IDatabaseAdapter` is implemented once in `SqlDatabaseAdapter`; Tauri and OPFS supply only a
driver. This keeps the two runtimes from drifting and keeps SQL out of stores/components.
`TauriSqlAdapter` translates `?` → `$1` (the plugin documents `$#` for SQLite). Audio is stored as
base64 `TEXT`, not `BLOB`, so both drivers behave identically. `export`/`import` are a portable
SQL dump; a raw `.sqlite` page image is a possible later optimisation for Tauri.

### OPFS uses the SAH-pool VFS in a Worker
OPFS synchronous access handles are worker-only. The SAH pool avoids the async-proxy worker and
is the current recommended backend. It works without cross-origin isolation, but isolation is
still required for ORT-Web `SharedArrayBuffer`, so both are kept.

### Arch linker pin
`src-tauri/.cargo/config.toml` sets `linker = "gcc"`. GCC reports `x86_64-pc-linux-gnu` while
Rust's host triple is `x86_64-unknown-linux-gnu`, so the toolchain looked for a non-existent
`x86_64-linux-gnu-gcc`. Scoped to the host target so other platforms are unaffected.

### API keys live in localStorage, not the database
The database is the thing that gets exported and synced to Google Drive / WebDAV. BYOK keys
(Groq, DeepSeek, OpenAI, HF) are therefore kept in `localStorage` under `onspot.key.*`
(`stores/secrets.ts`), and only non-secret preferences go in the DB (`stores/settings.ts`).
This is the same rule the lab already applied to the HF token: never commit it, never put it in a
`VITE_` variable.

### One OpenAI-compatible LLM client for Groq and DeepSeek
Both providers implement `POST {baseUrl}/chat/completions` with a bearer key, so a single client
(`adapters/llm/client.ts`) serves both plus any custom OpenAI-compatible endpoint. The evaluation
prompt requests `response_format: { type: 'json_object' }` but the parser also strips code fences
and scans for the outer `{...}`, because not every provider honours JSON mode.

### LLM output maps onto the prototype's four categories
The evaluation JSON has `corrections`, `vocabulary` and `connectors`, but only the four existing
correction categories (`grammar`/`register`/`filler`/`style`) are persisted, so the prototype's
insight columns and DB schema do not need to change. Vocabulary upgrades become `style`
suggestions; connector advice becomes `register`/`filler`.

### Local STT runs in a Web Worker
The lab left main-thread inference open because the tab froze hard enough that Playwright could
not click during a load. The product needs a responsive UI (live waveform, progress bar), so
`workers/stt.worker.ts` now owns the pipeline and the decode loop; `WorkerWhisperAdapter` is the
main-thread proxy. PCM is moved in by transfer (the caller's array is sliced first, because a
transfer detaches the buffer). Verified: the worker imports Transformers.js and relays real
download progress with no main-thread block.

### UI: shadcn-svelte for primitives, prototype for layout
shadcn-svelte is installed (button, card, input, label, textarea, badge) and its `cn` helper plus
element-ref types live in `src/lib/utils/index.ts` (the registry imports `$lib/utils`). The
bespoke prototype look (rail, composer, serif transcript, feedback panel) is built directly with
Tailwind against the tokens in `src/app.css`, rather than forcing the prototype into stock
shadcn styling.

### No "target exam" setting
The prototype/settings originally carried a "Target exam" select (DELF B1, TCF, …). Removed at the
user's request: the LLM prompt now states only the CEFR level. The Exam/Casual *mode* is separate
and stays — it drives the register/filler advice and the exam-status badges.

### LLM model is an enum-backed dropdown, not free text
`adapters/llm/providers.ts` defines `LLM_MODELS` (the enum) and `LlmModelId`. The Settings model
field is a `<select>` per provider, plus a "Refresh model list" button that calls
`GET {baseUrl}/models` with the key and merges unknown ids in as "From your account". The custom
provider keeps free-text base URL + model inputs. Each provider carries a `note` and links
(`keyUrl`, `modelsUrl`) so a user who cannot see a model is told to enable it under Groq's Model
Permissions (or the equivalent) rather than being left stuck.

### DeepSeek model names moved on
The inception named `deepseek-chat` / `deepseek-reasoner`. DeepSeek's current API (checked
2026-09) serves `deepseek-flash` and `deepseek-v4-pro` (legacy names still accepted). The enum and
default use the current names.

### Settings has a real connection test
`testConnection()` in `adapters/llm/client.ts` sends the smallest possible chat completion
(`max_tokens: 16`, "reply OK") with a 20s timeout, rather than calling `GET /models`. That
exercises the exact path evaluation uses — auth, base URL and model availability together — and
returns the model's reply so the user can see it actually produced output. The endpoint is built
by `stores/llm.ts` `currentLlmEndpoint()`, now shared with practice evaluation instead of being
duplicated. Browser-verified: no key → "Add an API key first."; invalid key → Groq's 401
"Invalid API Key" is surfaced verbatim.

### Per-word pronunciation: synthesize on click and cache, do not slice the sentence
Clicking a word in the transcript plays it; hover only highlights. The tempting "synthesize the sentence once and split
the audio at word boundaries" needs forced alignment and fights French liaisons and the absence of
inter-word silence. Since Piper's VITS is deterministic, `stores/pronunciation.ts` synthesizes a
word once, caches the WAV object URL, and reuses it; `components/Transcript.svelte` renders each
word as a token with click and keyboard handlers. The
token approach also carries the correction colour instead of nesting correction markup around
already-hoverable words. `utils/highlight.ts` was deleted.

### A session's mode is locked once it starts
`PracticeState.mode` is the live mode. `setSessionMode()` is a no-op once `sessionId` is set, and
the header switch is disabled. `openSession()` restores the stored session mode. A draft session
can still switch, which also updates the default setting. The rail `+` button (`newSession()`)
clears the session and unlocks the mode. Evaluation now uses the session mode, not the global
setting.

### Translation display is controlled per attempt
The evaluation prompt returns translations in the normal call. Each attempt card owns its display
state and exposes a labelled Translate menu; the removed global Practice-header toggle no longer
controls every card. `translationMode` only seeds a card's initial view. DB migration v3 added the
legacy single `attempts.translation`; migration v4 added the JSON `attempts.translations` column.

### Provider model list: curated chat models + filtered live list
The old curated Groq list included Llama 3.1/3.3, which are Enterprise-only and 404 on a standard
key. The curated list is now `openai/gpt-oss-120b` (default) and `openai/gpt-oss-20b`. The
"Refresh model list" result is filtered to chat models — whisper (STT), orpheus (TTS),
prompt-guard/safeguard (classifiers) are removed. `stripThinking()` drops `<think>` blocks from
GPT-OSS replies before display and before JSON extraction.

### Provider errors are shown in full
`chatCompletion`/`listModels` kept only 300 characters of a provider error body, which cut the
actionable tail off Groq's messages. The cap is now 2000, and the UI wraps and scrolls the text
(`max-h-40 overflow-y-auto break-words whitespace-pre-wrap`) instead of clipping it.

### The LLM output cap is derived from 60s of fast speech
A learner answers for at most 60s. Conversational French is ~120-150 wpm and fast speakers reach
~200, so the liberal ceiling is **240 words** (200 wpm + 20% headroom), in `src/lib/config.ts`.
Transcripts are truncated to it (`capWords`) before evaluation, and `MAX_EVALUATION_TOKENS`
(2048) sizes the output budget: correctedText + naturalSpeech + English translation all mirror
the transcript, plus a short summary and a bounded correction list. Requesting far more than the
answer can contain is what tripped low output-tokens-per-minute provider limits (the
`Requested 1110, Limit 1000` 429).

### Phase 4 views: Insights, History polish, toasts
- `/insights/` (rail `BarChart3`) aggregates all attempts and corrections client-side
  (`src/lib/insights.ts`): 4 stat cards and recurring patterns grouped by `category|label`,
  style excluded. Clicking a pattern shows every occurrence grouped by session, with an
  "open session" jump. Data comes from a new `listAllCorrections()` on the DB adapter.
- History gained search (title + transcript), replay of the last recording, rename and delete.
  `deleteSession()` removes attempts, corrections and audio explicitly rather than trusting
  `ON DELETE CASCADE`, because the Tauri plugin may run statements on different pooled
  connections where `PRAGMA foreign_keys` was not set.
- A small toast store/component (`stores/toast.ts`, `components/Toasts.svelte`) gives feedback
  for those actions.

### Phase 4 finished: linked correction marks, regex history, header session actions
- `Transcript.svelte` now tags tokens with their correction id and takes `activeCorrectionId` /
  `onSelect`, so a mark highlights and selects its correction and the feedback row highlights the
  mark. **Trap:** the transcript sits inside the attempt's select `<button>`, so the mark click
  must `stopPropagation()` or the parent handler immediately re-selects the attempt and clears the
  correction.
- History search is a `{ sessions, error }` derived: literal substring by default, `RegExp` when
  Regex is on, case toggled; an invalid pattern returns the message instead of throwing, and
  literal matches are highlighted in the snippet.
- Practice header has rename/delete for the current session (`renameSession`/`deleteSession` +
  toasts); delete then starts a fresh session.

### Groq account model probe (2026-09-14)
One `max_tokens: 1` chat completion was sent to every model the key lists, to populate dashboard
metrics and read the `x-ratelimit-*` headers. Full results live in
[`docs/benchmarks/llm-providers.md`](../../../docs/benchmarks/llm-providers.md) — that file is
authoritative; do not copy its table here. Headlines: the gpt-oss/qwen tier is **8 000 TPM** (one
evaluation approaches it);
Llama 3.1/3.3 are Enterprise-only and absent from the account; `whisper-*` are STT, `orpheus-*`
are TTS (terms required), `prompt-guard` is a classifier. The key was read from a local file and
never printed.

### Attempt UX rollout: audio caching, translations, compact corrections
- **Superseded wheel prototype** (`components/AttemptWheel.svelte`): only the current attempt was
  interactive, neighbours are rotated/scaled/faded off-centre. Wheel/keyboard/chevrons move
  between attempts. It was replaced by `AttemptStream.svelte`; the current behavior is documented
  below.
- **TTS is cached in the database** (`adapters/tts/service.ts`) keyed by
  `tts:<mode>:<voice>:<hash(text)>`. Repeats cost no model call and survive reload; changing the
  voice is a new key, which is what makes retroactive re-render work. `attempts.tts_voice`
  remembers the last voice used. Agent cards expose a "Play corrected audio" button, a
  sentence-segments toggle, and (local mode) a voice selector that re-renders.
- **Translations**: the LLM returns versioned variants stored as JSON on the attempt. Each card's
  labelled menu controls its own view; `translationMode` only supplies the initial view.
- **Corrections** now carry `replacementTranslation` so `ici → dans ce pays` also teaches what the
  replacement means. The card is compact: category + label + a speaker **icon**, old → new,
  the translation, then a short explanation.
- **Word audio no longer auto-plays on hover** — clicking a word plays it; hover only highlights.
- **Export my data**: Settings → Storage downloads a JSON of sessions, attempts, corrections,
  prompts, settings and base64 recordings (`utils/export.ts`). The TTS cache is excluded
  (regenerable).
- DB migration **v4**: `attempts.translations`, `attempts.tts_voice`,
  `corrections.replacement_translation`. The evaluation output cap rose to **3072** tokens for the
  extra translation variants.

### Superseded prototype: fanned vertical conveyor
After the centered wheel was rejected, `components/AttemptWheel.svelte` briefly used this design:
the **active attempt is flat at the top**, full width; the previous attempts sit **directly
beneath it** in the scroll flow, each rotated around its top edge (`rotateX(offset * 30deg)`,
`transform-origin: top center`) with decreasing opacity, forming a curved glance of the belt.
Scrolling/wheel/↑↓/chevrons/drag move the belt; changing attempts runs a `lay-flat` keyframe on
the newly active card. Cards use the full parent width (the earlier `max-w-2xl` centering is
gone). The wheel only rolls once the active card has hit its own scroll edge.

### Attempt list is a free-scrolling chat with a conveyor exit
The current design (`components/AttemptStream.svelte`,
replacing `AttemptWheel.svelte`):
- A normal `overflow-y-auto` **flat chat list**, oldest → newest, no fixed grid.
- Scroll-linked conveyor: a card gets `rotateX`/`translateY`/opacity only as its top crosses
  above the viewport top (`progress = -relativeTop / 150`), so old cards are pushed up and out
  with the curve, and scrolling back brings them down flat. Fully visible cards are flat.
- A **bottom spacer** = `viewportHeight - lastCardHeight - 24` makes the newest card settle at
  the **top of the viewport when scrolled to the end**, so only the current attempt is on screen.
- Scrolling is visual only and never changes the active attempt. Card click selects explicitly;
  adding a new attempt selects it and settles it at the top.
- New attempts measure the floor spacer, wait for layout, then animate to their final offset.

### Attempt stream: compositor animation, per-card translation, click-to-select
Fixes after the first stream attempt felt glitchy:
- **Animation moved to the compositor.** The per-frame JS transforms were replaced with CSS
  scroll-driven animation (`animation-timeline: view(); animation-range: exit 0% exit 100%`) on
  `.attempt-slot`, wrapped in `@supports`. Cards stay flat until they start exiting the top, then
  curve away; reversing is smooth. No JS writes transforms per scroll; a `ResizeObserver` only
  keeps the floor spacer correct as card content changes.
- **New-card lift uses a timed scroll, not native smooth scrolling.** Browser `behavior: smooth`
  has unspecified timing and snapped when the new card and floor spacer changed layout together.
  `AttemptStream` now eases `scrollTop` over 1050ms and adds a matching inner-card arrival; user
  wheel/touch/pointer input cancels it immediately. The scroll-linked 3D transform stays in CSS.
- **Per-card translation control is visibly labelled `Translate`**, not an icon-only action. Its
  menu offers Idiomatic / Literal / Word-for-word / Compare all three / Hide and explains the
  purpose of every variant. Every menu option remains selectable; choosing a view on an old or
  versionless set runs a focused translation request and persists a complete v2 set. The
  global header toggle was removed; the `translationMode` setting only seeds a card's initial view.
- **No horizontal scrollbar**: the stream is `overflow-x-hidden`; card wrappers, the article,
  translation and segment text use `min-w-0` / `break-words`.
- **Click a card** to select it and scroll it to the top, pushing the rest up; the handler ignores
  clicks that land on buttons/inputs/selects.
- **Scrolling never selects an attempt.** It only moves the conveyor. The feedback panel changes
  through an explicit card click or a newly-created attempt. The previous/next chevrons and count
  overlay were removed; they cluttered the stream and duplicated scrolling plus card clicks.

### Translation semantics are shared, versioned, and progressively disclosed
`adapters/llm/translationPrompt.ts` is the single source of truth for both the initial evaluation
and focused regeneration prompts. It defines idiomatic as native phrasing, literal as grammatical
English that preserves French lexical/structural choices, and word-for-word as exact token or
morpheme order even when the result is broken English. A contrastive `je m'appelle` example
requires `my name is` / `I call myself` / `I me call`, preventing providers from collapsing the
last two variants into the same polished sentence.

`TranslationSet.version = 2` marks output produced with these rules. Old/versionless sets are
regenerated when a translation view is chosen, even if their three legacy strings are non-empty;
incomplete initial-evaluation output remains versionless so a copied idiomatic fallback cannot be
mistaken for a valid literal or word-for-word result. The JSON DB column absorbs the extra fields,
so no SQL migration is needed. V2 also stores up to two meaningfully different idiomatic variants
and an ordered word/morpheme breakdown. The attempt card hides both by default and exposes them
with small disclosure controls; explicit regeneration stays inside the Translate menu.

### UI capture sandbox: clone-and-clean, preserve real interactivity
`docs/prompts/ui-capture.md` asked for a standalone capture of the chat-history UI for an external
AI. Two wrong turns were rejected and reverted:
1. Adding `expanded` / override props to `AttemptStream` and `AttemptCard` — instruments
   production code.
2. Stripping every `{#if}` and freezing the UI into a static "peak clutter" collage — destroys the
   interaction the reviewer needs to judge.
The standing rule is **clone and clean, keep it live**: copies live under
`src/routes/ui-sandbox/components/` as `Mock*` components that share nothing with production
(no stores, no adapters, no DB/LLM/TTS calls) but **keep** their Svelte state, `{#if}` blocks,
click handlers, hover tooltips and tab/toggle behavior. External calls are replaced with local
component state (simulated playback, simulated generation/spinners). `npm run bundle:ui` packs
only `src/routes/ui-sandbox/**/*.svelte`, so the bundle can never leak product code or become a
refactor target for files the product depends on. The sandbox is self-contained and can stay in
the repo indefinitely.

### External UI critique applied to the real components (2026-09-14)
The `ui-sandbox/` mock is only a repomix bundle for external UX review; the fixes were applied to
the live components, not the mock.
- **Active card state**: `AttemptCard` gets `border-[var(--brand)] ring-2 ring-[var(--brand-soft)]`
  when active; inactive gets a hover border.
- **Severity vs category colour**: `Transcript` colours marks by `severity`
  (error/warning/suggestion), not category; the feedback panel shows category as a neutral badge
  and severity as a coloured dot.
- **Offset-based corrections**: `Correction` gained `start`/`end` (migration **v5**), computed in
  `buildCorrections` when claiming distinct occurrences (no double-marking, no overlap); the
  transcript tags tokens by offset and falls back to claiming occurrences for legacy rows.
- **Real audio player**: new `stores/audio.ts` + `components/AudioBar.svelte` (play/pause, seek,
  speed 0.75/1/1.25×, loop, active segment). All practice playback routes through it; the old
  fire-and-forget `new Audio()` calls are gone. Segment rows show a pause icon while playing.
- **Responsive split**: page grid is `grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(320px,30vw,420px)]`;
  the feedback panel is below on small screens with a max-height.
- **Feedback panel**: severity summary, category/severity filters, an accordion per correction
  (explanation, `formalAlternatives` chips, exam badge, Hear it), sorted by `sortOrder`. The
  duplicate "Session stats" heading is gone; a single compact one-line summary remains.
- **Card header**: only Play + Translate stay visible; replay recording, sentence mode and voice
  moved into an overflow `…` menu. Nested rounded panels replaced with `border-t` separators.
- **#11 motion**: the conveyor was kept per the user's explicit request but softened
  (`rotateX 34deg`, opacity 0.2) and disabled under `prefers-reduced-motion`.
- **A11y**: card slots are focusable (`role=button`, Enter/Space), transcript corrections are real
  buttons (only those are tab stops), icon buttons have `aria-label`s, translation/audio async
  states are `aria-live`, menus close on Escape.

Still open from the critique: design-token sweep (#6), replacing the JS spacer/ResizeObserver
with CSS (#12), arrow-key menu navigation + 44px touch targets + contrast pass (#13), removing
the redundant `attempt.translation` field (#21), list virtualization (#23), container queries
(#25), and automated a11y/visual tests (#26).

### Apple-inspired interaction and responsiveness pass (2026-09-15)
- Added shadcn-svelte Tabs, Dropdown Menu, Collapsible, Progress, Separator, Tooltip, Select and
  Alert Dialog primitives. Production Practice/Attempt/Feedback interactions and all seven
  Settings choices use these instead of custom menus, native selects, prompt/confirm dialogs, and
  ad-hoc disclosure controls.
- The visual language is restrained glass, layered neutral surfaces and a teal→violet gradient;
  phase changes, disclosures, filtering, translation detail, theme changes and route changes now
  animate. `prefers-reduced-motion` remains authoritative.
- Feedback summary is severity-only and count-over-label; category is secondary and lives in the
  hamburger. Empty replacements are semantic deletions and render as strike-through + Remove.
- The conveyor remains compositor-driven but now exits decisively at 58deg/0.06 opacity. A
  requestAnimationFrame fallback is used only where view timelines are unsupported.
- Mobile navigation moves from the side rail to a 60px bottom bar at <=640px. This prevents the
  requested feedback labels from truncating at a 390px viewport.

### Local-model resource policy (2026-09-15)
- Piper moved completely into a lazy module worker; French G2P and ONNX inference no longer block
  the main thread. Requests serialize, PCM is transferred, only one voice remains loaded, and all
  voice sessions release after 90 seconds idle.
- Whisper remains worker-hosted but now caps ORT WASM at two threads only on >=6-core, >=6GB,
  cross-origin-isolated devices; all other devices use one. Its pipeline also releases after 90
  seconds idle.
- Piper downloads use `ReadableStream.tee()`: Cache Storage consumes one branch while inference
  consumes one growable `Uint8Array`. This removes the former multi-copy 64–77MB memory spike.
- Audio time updates no longer invalidate every AttemptCard; the cards subscribe to a separate
  low-frequency playback-identity store. Replaced blob URLs are revoked, pronunciation URLs are
  bounded to 48, the mic meter is capped at 25Hz, and the visible timer at 4Hz.
- `openSession()` loads correction lists in parallel; offscreen cards use `content-visibility`,
  and the stream observes only its viewport plus newest card. Font imports are Latin-only.
- Browser evidence on a cold fresh origin: Piper Tom downloaded 64MB and generated 2.94 seconds
  of speech in 44.9 seconds while requestAnimationFrame continued at ~60fps (2,688 frames), with
  an 87ms maximum sampled timer gap. No page or console errors.

### Coach notes responsive disclosure (2026-09-15)
- Coach notes is one shadcn Collapsible, not a second custom toggle system. The state is owned by
  Practice and bound into FeedbackPanel so the parent grid and panel content animate together.
- Desktop defaults open and collapses the feedback column from up to 440px to a 64px icon/count
  rail. Below 1024px it defaults closed as a 58px horizontal bar and opens to 42% of app height.
- Selecting a marked transcript word always reopens Coach notes so linked feedback is never hidden.
  Motion follows `prefers-reduced-motion` and the 390px view has no horizontal overflow.

### Language registry is the single source of truth (2026-09-15)
- `src/lib/languages/index.ts` holds every `LanguageDefinition` (STT, voices, prompts, approval).
  Adding a language is one entry after a human quality pass; nothing else in the app names a
  language directly. `docs/architecture/languages.md` is the human-facing tracker.
- A language is offered only when it and each of its STT/voice entries are `approved`; the
  approval record names the test, the date and the evidence file. This preserves the lab rule
  that no download is exposed before a human has judged its output.
- Downloads are manual, per language, and cancellable — never automatic on selection. The
  product requirement is that a mis-click costs nothing, so the user can switch languages and
  download later. The gate tells the user to open Settings → Language data rather than downloading
  silently from the Practice screen.
- The combined progress bar is global (layout-level) so navigation does not hide or cancel it.
- Cancel terminates the model workers; the next use lazily recreates them, so a partial cache
  never blocks a retry.

### TTS correction profiles are declarative and per voice (2026-09-15)
- `LanguageVoice.processing` carries the listening-test correction (high-shelf EQ, compressor /
  limiter, makeup gain, peak normalization target); `utils/audioEffects.ts` renders it in an
  `OfflineAudioContext`. No voice-specific branches live in the DSP code.
- STT input conditioning is deliberately untouched: the approved WER was measured on raw decoded
  PCM, so any filtering would require a fresh measurement before it can be approved.

### Tabs selected state: `data-state`, not `data-active` (2026-09-15)
- bits-ui's Tabs trigger exposes `data-state="active"`; the shadcn base classes that use
  `data-active:` therefore never apply. Custom selected styling must target
  `[data-state=active]` (or `data-[state=active]:`). This was the real reason the feedback
  severity tabs looked identical selected and unselected.

### AlertDialog.Action does not close the dialog (2026-09-24, bits-ui 2.19)
- Unlike Radix, bits-ui's `AlertDialog.Action` is only "the button responsible for taking an
  action" and **does not close** the dialog out of the box (documented behaviour; `Action` uses
  `DialogActionState`, which has no click handler, while `Cancel` uses one that closes). Every
  Action handler must close its bound `open` state itself. This bit Restore database (dialog
  trapped the learner with no result when the import failed) and the Voice preview regenerate
  dialog; the Practice delete dialog already closed explicitly in `deleteCurrent()`.

### Long cards are flat; the conveyor is for short cards only (2026-09-15)
- onspot takes run 60s–5min, so an attempt card can be several viewport-heights once translations
  and a word breakdown are open. The scroll-driven exit animation is meaningless for those cards
  and actively hostile to reading, so cards over `max(480px, 75% viewport)` get a JS `tall` class
  that disables the animation. Short cards keep the conveyor.
- The detection is per-card via `ResizeObserver` (only the resized card is re-measured), so
  expanding/collapsing anything fixes the card's own behaviour immediately.
- Compare-all translations stack vertically at full card width. Vertical space is the axis the
  product has; the old three-column layout squeezed 5-minute content into narrow columns.

### Advanced voice tuning: layered per voice, part of the cache key (2026-09-15)
- The approved `LanguageVoice.processing` profile stays the baseline. Learner adjustments live in
  `settings.voiceTunings[voiceId]` as ±12 dB offsets (`VoiceTuning`) and are merged by
  `resolveProfile`; Reset deletes the entry, restoring the approved sound exactly.
- `processPcm` runs a fixed chain: 3-band EQ → approved compressor (if any) → makeup →
  input-peak normalization → learner volume → final limiter. The limiter is what makes a positive
  volume/EQ boost safe; normalization is computed from the input peak because the final gain
  cannot be known before rendering.
- The cache key includes `tuningSignature`, so each tuning is its own cached WAV and a slider
  change can never replay stale audio. The preview store's selection key includes the same
  signature (caught by the browser test: without it, the in-memory preview replayed stale audio).
- Advanced is the same Settings page, not a second tab: General/Advanced is a segmented toggle
  and the advanced section is a `Collapsible` in the normal flow. Hiding it changes nothing about
  what is applied; values stay in the store.
- Advanced is the default selection on load (user request, 2026-09-18). It is page-local state,
  not a persisted setting.

### Voice preview: reuse the synthesis cache, guard regeneration (2026-09-15)
- Settings previews the selected local/cloud voice with `LanguageDefinition.preview` through the
  same `synthesizeSpeech` path as practice, so the WAV lands in the normal DB audio cache and the
  voice processing profile is heard. No separate cache format or model call path.
- Play never regenerates: it reuses the in-memory blob URL while that URL is the active track,
  otherwise it re-reads the cached WAV. Only the confirm dialog calls `force: true`, because a
  regeneration costs model time (and a cloud request) for no benefit unless the cached audio is
  actually wrong.
- Generation is deduplicated per `mode:language:voice`; if the selection changes mid-generation
  the result is discarded rather than played.

### Card depth beats flat minimalism (2026-09-15)
- Page background and card surfaces are deliberately separated (`#f1efe9` vs white in light,
  `#0b0b0d` vs `#19191d` in dark) with explicit card borders and stronger shadows. Attempt cards
  and feedback correction cards both carry this, because a 5-minute card needs a clear boundary
  while scrolling.

### Settings preview applies processing live (2026-09-18)
The preview is synthesized once raw and played through `createProcessingChain` — the same Web
Audio graph `processPcm` renders offline — so tuning is audible instantly and matches read-backs.
Re-rendering the whole chain (not EQ-after-compressor) matters: Tom's compressor (ratio 8) would
otherwise make the live sound differ from the rendered one.

### Export is the SQLite database itself (2026-09-18)
User request: one `.sqlite` with everything, including cached audio. Web uses sqlite-wasm's
serializer; desktop uses `VACUUM INTO` + Tauri dialog/fs plugins. Keys and models stay out.

### SQLite import replaces the database file (2026-09-24, revised same day)
The `.sqlite` export is a whole-database image, so its restore is a whole-database replace, not a
merge. **Web:** the worker calls `sqlite3_deserialize()` on the open connection (main becomes the
backup in wasm memory), `pool.unlink('/onspot.db')`, writes the backup back with
`VACUUM INTO '/onspot.db'` through the normal VFS write path, and reopens. The first version used
`SAH.pool.importDb('/onspot.db', bytes)`, which writes the raw image with one large
`FileSystemSyncAccessHandle.write()` and never truncates; a Zen/Firefox user hit
`Unknown write() failure.` from that path (sqlite-wasm's SAH xWrite short-write guard), so it was
removed. `VACUUM INTO` also preserves `schema_migrations`, so `init()` still migrates older
backups (verified v5 → v6 backfill). **Desktop:** closes the sqlx pool, overwrites the plugin's
`onspot.db` (app config dir) and removes stale `-journal`/`-wal`/`-shm` sidecars. A table-by-table
copy was rejected: it would leave main's schema current and skip migration backfills, and on
desktop a connection-scoped `ATTACH` can silently run on another pooled connection.
`importSqliteBackup()` reloads settings and Practice after the replace. Because the import is
destructive, it sits behind a shadcn AlertDialog that names the chosen file; the legacy JSON
restore remains the non-destructive merge path. Web browser-verified (Chromium 19/19 + 8/8,
Firefox 7/7 + 7/7 parity); Tauri awaits runtime verification.

### Paper texture is rendered once and cached as an image (2026-09-18)
A live full-screen WebGL canvas slowed first content 2–4× under software GL (History: 0.9–2.4s →
4–6.5s). Snapshotting to WebP (Cache API) makes later loads faster than before (≈0.4–1s) with no
live GL context; the first render is deferred and done at the screen's real pixel ratio.

### UI library: @dvcol/neo-svelte replaces shadcn-svelte (2026-09-24)
User direction: remove shadcn-svelte and use neo-svelte's components throughout. Pinned to the
npm release 1.2.0 (master 2.0 is unreleased). Constraints learnt while migrating:
- `NeoThemeProvider` is mandatory and renders children only after its stylesheet loads; it needs
  `sass-embedded` in devDeps. We pass `reset={false}` (Tailwind preflight) and `remember={false}`
  (the app owns `onspot.theme`).
- 1.2.0 has **no cascade layers**: neo's scoped CSS usually beats a plain `:global(.cls)`.
  Override with `.scope :global(.neo-button.cls)` (or a prop). neo's theme sheet is unlayered, so
  it beats every Tailwind utility — hence the `revert-layer` heading fix in `app.css`.
- Neo buttons wrap children in `.neo-content`; NeoCard without header/footer renders children
  directly (`contentProps` inert).
- `NeoDialogConfirm`/`NeoConfirm` are not exported in 1.2.0 and deep imports are blocked: confirm
  dialogs are `NeoDialog` + two NeoButtons, with `portal` (a glass/backdrop-filter ancestor
  otherwise traps the fixed dialog). Handlers still close the bound `open` explicitly.
- `NeoRange` has no vertical orientation → EQ faders are horizontal.
- `NeoDivider`'s `margin` prop is folded into its height `calc()`; multi-value margins make the
  height invalid (a 21px grey bar). Use `style="margin: …"`.
- NeoTabs can report `undefined` through `onchange` when `active` is cleared; handlers ignore it.
  Neo's deferred empty transition can crash Svelte if a block is removed and restored within a
  microtask.
- NeoPill's type only allows a `div` tag; clickable chips are small NeoButtons.
- Never pass reactive props to NeoThemeProvider: a prop change destroys and remounts the whole
  app (1.2.0). Theme switches go through `NeoThemeSync` → `context.update({ theme })`.
- NeoTooltip 1.2.0 ignores the "click" open reason, so NeoMenu only opens by hover (500ms). Always
  use `$lib/components/PopMenu.svelte`, never NeoMenu directly. Tooltips/collapses take the
  `$lib/neo` timing presets.
- Relief and surfaces are app-owned: `src/neo-depth.css` (generated, × `--neo-depth`) and the
  key/well/sheet rules in `app.css`. Keys lighter card stock + `--paper-key`, wells darker and
  recessed, active tab = raised key in an inset track (2026-09-24, user asked for stronger
  concave/convex and distinct component paper).

### Prefer libraries and existing components (2026-09-18; component library now neo-svelte)
User direction: use web APIs, existing deps and shadcn-svelte components rather than hand-rolled
equivalents (e.g. Web Audio `getFrequencyResponse` instead of hand-written biquad maths).

### `.sqlite` restore never destroys the current database (2026-09-25)
The worker exports the current DB to memory before replacing it and writes it back if the backup
write fails (Firefox quota). `navigator.storage.persist()` is requested from the restore click —
Firefox ignores it without user activation — and never awaited unless room is short (it resolves
only when the user answers the prompt).
