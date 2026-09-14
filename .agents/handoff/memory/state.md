# State

## Current State
The **onspot** product UI and core practice pipeline are implemented. The current Practice view
uses a free-scrolling attempt conveyor, explicit card selection, per-attempt translation controls,
and strict versioned translation output with progressively disclosed alternatives and word detail.
Phase 3 BYOC sync is the next product phase; a real local Whisper + LLM end-to-end proof and the
Piper Tom EQ/loudness pass remain verification/polish work.

The earlier model-selection lab is complete. Its approved STT/TTS choices and evidence live in
`docs/approved-tech.md`; do not re-litigate them without new evidence.

## Product shape (from `docs/prompts/inception.md`)
- SvelteKit + `@sveltejs/adapter-static` (`fallback: 'index.html'`) → pure client-side SPA.
- Tauri v2 desktop wrapper (.exe first, cross-platform ready).
- Tailwind CSS v4 + shadcn-svelte.
- AGPL-3.0.
- Record 30–60s spontaneous French → transcribe (local Whisper / Groq) → LLM evaluates →
  read corrected phrasing back (local Piper / cloud TTS).
- Hybrid DB behind `IDatabaseAdapter`: Tauri SQL (`@tauri-apps/plugin-sql`) on desktop,
  `@sqlite.org/sqlite-wasm` (OPFS, in a Worker) on web.
- BYOK LLMs (Groq, DeepSeek) and BYOC sync (Google Drive PKCE, WebDAV, local `.sqlite`).

## Decided models carried into the product
- **STT: `onnx-community/whisper-small` q4, 299 MB, 5.5% aggregate WER** (WASM). WASM, not
  WebGPU. Whole reasoning in `memory/decisions.md` and `docs/approved-tech.md`.
- **TTS: Piper Tom (M, medium)**, 64 MB, 44 kHz. `Piper UPMC` (jessica/pierre) and
  `Piper Siwis` are the alternates. Listening-test decision, 2026-09-13.
- Cloud fallbacks per inception: Groq `whisper-large-v3-turbo`, OpenAI-compatible LLMs.

## Build status
- [x] **Phase 1 — scaffold, headers, DB abstraction.** Done and browser-verified.
- [x] **Phase 2 — speech + AI pipeline.** Mic capture, STT Web Worker, cloud adapters, LLM
  evaluation, TTS read-back and the record→transcribe→evaluate→persist orchestration.
  Worker plumbing browser-verified; a full local transcription + evaluation still needs the
  299 MB download and an LLM key.
- [ ] Phase 3 — BYOC sync
- [x] Phase 4 — product UI. Practice, Settings, History (search + regex/case, replay, rename,
  delete), Insights, toasts, click-to-pronounce, session-locked mode, per-attempt translation
  variants, clickable transcript↔feedback correction marks, and the attempt conveyor are done.
  Phase 3 is next.

### Current attempt-card UX
- `AttemptStream.svelte` is a flat oldest→newest scroll list. Cards roll over the top edge with a
  CSS scroll-driven 3D conveyor transform; scrolling back to older attempts reverses the motion.
- New attempts rise to the top over 1050ms with deterministic eased scrolling plus a light card
  arrival transform. The component stays mounted when the list is empty so the first attempt also
  animates. Wheel, touch, or pointer input cancels programmatic motion immediately.
- Every attempt with translation data has a labelled **Translate** menu. It explains and selects
  Idiomatic, Literal, Word-for-word, or all three views. A `ResizeObserver` keeps the floor spacer
  correct when translation content changes a card's height.
- Translation output is the translation text alone; variant explanations live only in the menu.
  All menu choices are enabled. Choosing a variant on an old/versionless record regenerates the
  full strict v2 translation set through the configured LLM and saves it on that attempt for reuse.
- Translation v2 keeps idiomatic, literal, and word-for-word structurally distinct. It can also
  save 0–2 idiomatic alternatives and an ordered word/morpheme breakdown. Alternatives and the
  breakdown stay collapsed beneath the primary translation until the learner requests them;
  regeneration is a secondary action inside the Translate menu.
- Scrolling the conveyor does not change `activeAttemptId`; selection is explicit via card click,
  or adding a new attempt. There are no previous/next buttons or floating attempt counter.

### Phase 1 implemented

SvelteKit migration (was a root-level Vite + Svelte app):
- `svelte.config.js` + `@sveltejs/adapter-static` (`fallback: 'index.html'`, pure SPA).
- `src/routes/+layout.ts` with `ssr=false`, `prerender=false` → single `index.html`.
  Do **not** set `prerender=true`: it emits a second index.html the fallback overwrites.
- `src/app.html`, `src/app.css` (Tailwind v4 + `@tailwindcss/vite`), self-hosted
  `@fontsource` fonts (no font CDN — privacy).
- Design tokens: shadcn contract (`--background`, `--primary`, ...) plus onspot's own
  (`--brand`, `--warn`, `--good`, `--glow-*`). shadcn's `--accent` is the subtle hover
  surface, **not** the brand; the brand is `--brand`.
- `components.json` for shadcn-svelte; `cn()` in `src/lib/utils/cn.ts`.
- COOP/COEP set by a custom middleware plugin in `vite.config.ts` because SvelteKit's Vite
  plugin discards `server.headers`/`preview.headers`. Verified: `crossOriginIsolated === true`.

Tauri v2:
- `src-tauri/` generated by `tauri init`, identifier `app.onspot.desktop`, crate `onspot`.
- SQL plugin registered; `capabilities/default.json` has `sql:default` + `sql:allow-execute`.
- `src-tauri/.cargo/config.toml` pins linker `gcc` (Arch triple mismatch). `cargo check` clean.

Database layer (`src/lib/adapters/db/`):
- `types.ts` — `IDatabaseAdapter` + models (Prompt, Session, Attempt, Correction, AudioAsset,
  Setting, SyncMetadata) and the low-level `SqlDriver`.
- `schema.ts` — versioned migrations (v1), shared by both runtimes.
- `SqlDatabaseAdapter.ts` — all CRUD written once over `SqlDriver`; aliases rows to camelCase;
  corrections stored as a JSON array; `export`/`import` are a portable SQL dump.
- `TauriSqlAdapter.ts` — `@tauri-apps/plugin-sql`; translates `?` → `$1` (plugin's documented
  SQLite syntax).
- `OpfsSqliteAdapter.ts` + `sqlite.worker.ts` — `@sqlite.org/sqlite-wasm`, OPFS SAH-pool VFS in
  a Worker. Verified loading in headless Chromium.
- `index.ts` — `getDatabaseAdapter()` factory on `window.__TAURI_INTERNALS__`.

Lab UI (`src/App.svelte`, `src/lib/components/*`) was archived to
`.agents/handoff/archive/lab-ui-2026-09-13/`; the adapters, `lib/tts`, `lib/utils` and
`lib/types.ts` were kept. The prototype supersedes that UI.

### Phase 2 implemented (partial)

Adapter layout now matches the inception:
- `src/lib/adapters/stt/` — `BaseAdapter`, `engine` (device probe, download progress,
  `whisperTranscribe` sequential windows, `windowedTranscribe`), `WhisperAdapter`,
  `MoonshineTinyFrAdapter`, `WebSpeechAdapter`, `CustomHFAdapter`, `registry` (`sttRegistry`),
  and the new **`GroqWhisperAdapter`** (BYOK cloud STT; encodes 16 kHz PCM to WAV and POSTs it).
- `src/lib/adapters/tts/` — `BaseTTSAdapter`, `PiperAdapter` (4 French voices), `registry`
  (`ttsRegistry`), `cachedFetch`, `phonemize`, `roundTrip`, and the new **`OpenAITtsAdapter`**
  (BYOK cloud TTS, decoded to PCM).
- `src/lib/adapters/llm/` — `client` (OpenAI-compatible chat completions), `providers`, `prompt`
  (evaluation schema/rules), `translationPrompt` (shared strict translation semantics), `evaluate`
  (tolerant JSON extraction/normalization), and `translate` (focused retroactive regeneration).
- `src/lib/utils/wav.ts` — mono Float32 → 16-bit WAV.
- `src/lib/stores/settings.ts` — DB-backed preferences (level, exam, mode, stt/tts mode, LLM
  provider/model, voice). `src/lib/stores/secrets.ts` — **localStorage** API keys, deliberately
  never in the synced DB.

LLM JSON includes `{ correctedText, naturalSpeech, translations, summary, corrections[],
vocabulary[], connectors[] }`. `translations` v2 contains idiomatic, optional idiomatic variants,
literal, word-for-word, and (for focused regeneration) an ordered word breakdown.
Corrections use the 4 DB categories (`grammar`/`register`/`filler`/`style`); vocabulary upgrades
are intended to be persisted as `style` suggestions and connectors as `register`/`filler`, so the
prototype's insight columns keep working without new categories.

### Phase 2 continued: capture, worker, orchestration

- `src/lib/workers/stt.worker.ts` — **the local model now runs off the UI thread.** Handles
  `ping` / `load` / `transcribe`, relays `createDownloadProgress` and `onDeviceResolved`, and
  moves PCM in by transfer. This closes the lab's #1 open item.
- `src/lib/adapters/stt/WorkerWhisperAdapter.ts` — main-thread proxy implementing the
  `BaseSTTAdapter` contract. `dispose()` terminates the worker.
- `src/lib/adapters/stt/service.ts` — `transcribeFrench()` chooses local worker or Groq;
  `preloadLocalSTT()`; `sttDiagnostics()` (the worker `ping`).
- `src/lib/adapters/tts/service.ts` — `synthesizeFrench()` (Piper or OpenAI) → WAV URL;
  `listLocalVoices()`.
- `src/lib/utils/recorder.ts` — `VoiceRecorder`: MediaRecorder + live RMS level for the
  waveform, decode to 16 kHz mono on stop.
- `src/lib/utils/wav.ts`, `src/lib/utils/base64.ts` — WAV encoding and audio (de)serialisation.
- `src/lib/practice/prompts.ts` — 8 seed prompts, seeded into the DB on first run.
- `src/lib/stores/practice.ts` — the orchestration: prompt → record → transcribe → evaluate →
  persist Session/Attempt/Corrections/AudioAsset → speak `naturalSpeech`. Maps vocabulary and
  connectors into correction rows. `openSession()` reloads a past session.
- DB **migration v2**: `attempts.natural_speech`, `attempts.summary`.

### Phase 4 started: product UI

- `src/routes/+layout.svelte` — rail nav (Practice / History / Settings) + theme toggle,
  calls `initSettings()`.
- `src/routes/+page.svelte` — Practice: prompt composer, live waveform + 1:00 timer, STT
  progress, transcript with correction highlights, feedback panel and session stats.
- `src/routes/settings/+page.svelte` — level/mode, BYOK provider + keys, an **enum-backed model
  dropdown** with "Refresh model list" and **"Test connection"** buttons plus provider guidance
  links, local/cloud STT and TTS, Piper voice. No target-exam field.
- `src/routes/history/+page.svelte` — session list; opens a session into Practice.
- `src/routes/insights/+page.svelte` — stat cards, recurring-pattern columns, and a
  per-pattern occurrence detail with a jump back into the session.
- `src/lib/insights.ts` — cross-session aggregation (style suggestions excluded from patterns).
- `src/lib/components/Toasts.svelte` + `src/lib/stores/toast.ts` — transient feedback.
- shadcn-svelte components installed under `src/lib/components/ui/` (button, card, input,
  label, textarea, badge). The registry imports `$lib/utils`; `src/lib/utils/index.ts` re-exports
  `cn` plus the registry's `WithElementRef`/`WithoutChildren` helper types.
- `src/lib/utils/highlight.ts` — escapes then wraps correction originals for the transcript.

### UI sandbox (dev tooling, production untouched)
- `src/routes/ui-sandbox/` is a standalone, **1:1 interactive** clone of the chat-history UI for
  an external UX/UI review. `components/MockTranscript.svelte`, `MockAttemptCard.svelte`,
  `MockAttemptStream.svelte` and `MockFeedbackPanel.svelte` copy production markup and **keep**
  all Svelte state, `{#if}` progressive disclosure and click/hover handlers, but drop stores,
  adapters and DB/LLM/TTS calls; those are replaced with local simulated state. Clicking cards,
  toggling translation variants, opening the segments panel and linking corrections all work.
- `+page.svelte` holds a hardcoded four-attempt live session including a French proverb, with
  bindable active-attempt/correction state.
- `AttemptStream.svelte`, `AttemptCard.svelte` and `stores/practice.ts` are **unmodified**; the
  sandbox imports nothing from them. `npm run bundle:ui` (repomix) packs only
  `src/routes/ui-sandbox/**/*.svelte` to `repomix/ui-sandbox-bundle.xml` (the `repomix/` folder is
  gitignored, so generated output never lands in the repo root).

## Invariants (carried over, still true)
- All local inference is client-side. Device resolved at load time, never hardcoded. WASM default.
- Device stays WASM. WebGPU returns nonsense for quantized weights on the test machine.
- Quantization is a bandwidth lever, not a speed lever. q4 is the only quantized precision that
  loads; int8/uint8/q8 Whisper cannot build a session.
- Long audio uses sequential 30s windows seeking to the last emitted timestamp. No
  `chunk_length_s`/`stride_length_s`.
- Piper and Transformers.js keep separate ONNX Runtime instances.
- HF token lives only in `localStorage`; never in a `VITE_` var.
- The browser Cache API is per-origin.
