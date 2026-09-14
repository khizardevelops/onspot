# Decisions

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
