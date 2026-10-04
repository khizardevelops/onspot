# Tasks

## SvelteKit 3 migration (branch `migration`, 2026-10-04)
- [x] Migrate (sv migrate), check 0/0, build, preview smoke in Chromium (4 routes, nav, COOP/COEP).
- [ ] Restart the dev server on :5173 (svelte.config.js is gone) and exercise Practice with real
  STT/TTS/LLM; then the Tauri desktop + Android builds.
- [ ] Commit and merge `migration` into main.
- [ ] Optional: Kit 3 polls `_app/version.json` hourly (`version.pollInterval`); set it to 0 in
  `vite.config.ts` if the Tauri/static build should not.

## Japanese (candidate → approved)
- [ ] Listening test of CSS10 / Mera / Tsukuyomi-chan; choose default + any processing profile.
- [ ] whisper-small q4 Japanese transcript review (CER) on real human-transcribed learner speech.
- [ ] Record evidence in docs/benchmarks, flip `approval.status`, test the download in a prod build.
- [ ] Verify a real Japanese evaluation with an LLM key (corrections offsets on unspaced text).
- [ ] Optional: furigana (ruby) for kanji in transcripts/corrections, neo-styled.

## Follow-ups from the 2026-10-03 audit
- [x] Audit + follow-up fixes committed by the user (`4bc2d94`).
- [ ] Verify the wrong-language flag with a real LLM call (only tested with a mocked response).
- [ ] Optional: detect the spoken language from audio (Whisper language-id / Groq `verbose_json`),
  since local Whisper forced to French can translate English speech into French text.
- [ ] Optional: multi-tab takeover for the web DB (BroadcastChannel → holder `pauseVfs()`); today a
  second tab only gets a clear "open in another tab" message.
- [ ] Run a real take with the downloaded model to exercise the reworked STT worker load/idle path.
- [ ] Tune the silent-take threshold (-46 dBFS) on a real microphone.
- [ ] Decide on light `--muted-foreground` contrast (4.25-4.49:1 on rail/inset/control).
- [ ] Tauri: atomic migrations/corrections and `.sqlite` import validation + rollback.

## Current priority — Phase 3: BYOC sync
- [ ] Google Drive OAuth 2.0 PKCE, client-side upload/download.
- [ ] WebDAV support for Nextcloud, ownCloud, and pCloud.
- [x] SQLite **import** (restore a `.sqlite` backup). Settings → Storage → Restore database and
  History's empty state replace the local DB from the exported file. Legacy format-1 JSON restore
  remains available and merges safely. Browser-verified 17/17 + 7/7; the Tauri path is untested.

## UI library follow-ups (neo-svelte, 2026-09-24)
- [x] Replace shadcn-svelte with @dvcol/neo-svelte across the app; remove shadcn/bits-ui.
- [ ] Visually check LanguageDownloadBar during a real download and LanguagePicker (forced).
- [ ] Revisit when neo-svelte 2.0 (cascade layers, NeoDialogConfirm) is published: simplify the
  specificity overrides and the composed confirm dialogs.
- [ ] Sweep remaining hand-rolled buttons (AttemptStream, AudioBar, Transcript word buttons) for
  neo equivalents where they don't fight the conveyor/transcript layout.

## Resource usage
- [ ] Decide the Android STT path before adopting the WebGPU engine: native whisper.cpp in Tauri
  (whisper-rs) vs Transformers.js fallback. WebGPU spike passes on desktop (branch
  `spike/whisper-webgpu`, docs/benchmarks/stt.md).
- [x] whisper.cpp / wllama vs Transformers.js checked 2026-09-30 — rejected (8–12x slower).
- [ ] **User-owned (manual research):** find an STT alternative using `docs/research/model_problem.md`
  (the problem, every model in use, specs, benchmarks, gates, research leads). The user is not
  happy with ~1.9 GB for whisper-small q4; do not treat the current RAM as accepted.
- [ ] Optional: reduce STT resident RAM without losing accuracy (ORT arena/session options,
  quantized-embedding export, shorter idle release); measure with `/stt-bench/`.

## Language system follow-ups
- [ ] Evaluate and approve the next language (STT + voice) with a human quality pass, then add one
  `LanguageDefinition`; see `docs/architecture/languages.md`.
- [ ] Re-test the downloaded language data on a truly cold cache end to end (Whisper 299 MB +
  Piper 64 MB) including Cancel mid-download and resume.
- [x] Settings voice preview: cached first generation, instant replay, confirm-gated regeneration.
  Browser-verified cold (45s, 64 MB voice) and warm (1s after reload).
- [x] Settings redesign from `prototype/to-be-implemented/Settings.html` on shadcn components
  (Card, Field, InputGroup, ToggleGroup, Item, Slider, Toggle), 4-band EQ + volume, live-tuned
  voice preview, SQLite export. Browser-verified (37 + 12 checks, export verified separately).
- [x] History neumorphic cards + disclosed search options; Practice neumorphic Exam/Casual switch;
  feedback sidebar width fix; Paper texture background + rail; rail buttons as analogue keys.
- [ ] Run the desktop (Tauri) export and import once for real: dialog save, `VACUUM INTO` temp
  file, fs read/write, close + overwrite `onspot.db`, reopen. `cargo check` passes but neither
  flow is runtime-tested.
- [x] Advanced Voice audio: in-page General/Advanced toggle, per-voice volume + 3-band EQ,
  reset-to-approved, tuned cache keys. Browser-verified (26/26), including
  neutral→tuned→neutral cache behavior.
- [ ] Keep `languageDownloadBytes` honest when a non-default voice is selected (currently the
  default voice's estimate is used for the combined bar).
- [ ] Optional STT input conditioning (high-pass/normalization) if a future language needs it —
  any change invalidates the approved WER baseline and must be re-measured first.

## Verification and polish backlog
- [ ] Complete a real end-to-end local practice run after downloading Whisper small q4: record,
  worker transcription, configured LLM evaluation, persistence, and read-back.
- [ ] Confirm the Tom EQ/loudness profile on real read-backs by ear (implemented, not yet heard).
- [ ] Consider pre-warming word audio for the visible attempt only if measured usage warrants the
  extra CPU/memory; Piper is now worker-hosted and releases its session after 90 seconds idle.
- [ ] Add per-file SPDX headers for AGPL-3.0 compliance.

## Completed agent tooling
- [x] Isolated, interactive chat-history UI sandbox at `src/routes/ui-sandbox/` (Mock components,
  hardcoded live data, real progressive disclosure with simulated backends) plus
  `npm run bundle:ui` (repomix, sandbox `.svelte` only). Production components and stores are
  deliberately untouched.
- [x] `npm run bundle` (`repomix/bundle.mjs`): export any page (auto-discovered from
  `src/routes`), several pages combined or separately, or any folder/file/glob, with local
  imports traced. Real repomix runs verified (settings: 103 files; settings+history at depth 1
  as markdown).
- [x] Consolidated all benchmark/metric data into `docs/benchmarks/` (`stt.md`, `tts.md`,
  `runtime.md`, `llm-providers.md`, `README.md`) and de-duplicated it out of `rules/constraints.md`,
  `known-issues.md`, `decisions.md` and `docs/research/model-vetting.md` (was `docs/plan.md`).
  The `approved-tech.md` / `groq-models.md` redirect stubs were deleted in the 2026-10-01 docs reorg.

## Completed product foundation
- [x] SvelteKit static SPA, Tauri v2 shell, COOP/COEP, and Tauri/OPFS database adapters.
- [x] Mic capture, worker-hosted local Whisper, Groq STT, structured LLM evaluation, persistence,
  Piper/cloud TTS, and cached audio.
- [x] Practice, History, Insights, Settings, search, replay, rename/delete, export, and toasts.
- [x] Language registry + approval metadata, first-run picker, manual language-data download with
  a global cancellable progress bar, and per-voice TTS processing (EQ/limiter/normalization).
- [x] Language-parameterized STT/TTS/prompts/translation, and a refreshed Groq model list that
  auto-refreshes from `GET /models` when a key is present.
- [x] Visual pass: no purple accent, 56px rail, tinted mode/filter selection, bordered feedback
  cards, collapsible session stats, flush composer, no Sparkles, single-row attempt header.
- [x] Explicit card selection with a compositor-driven attempt conveyor, deterministic 1050ms new
  card lift, and no previous/next overlay or scroll-driven selection.
- [x] Per-attempt translation v2: strict idiomatic/literal/word-for-word semantics, retroactive
  regeneration and persistence, optional idiomatic alternatives, word breakdown, and progressive
  disclosure without output headings.
- [x] Apple-inspired product polish using shadcn-svelte primitives throughout Practice,
  AttemptCard, FeedbackPanel, Settings and navigation; smooth phase/disclosure/menu/card
  transitions and a fixed mobile hamburger menu that consumes no layout row.
- [x] Refresh/restart data rehydration: Practice opens the newest persisted session, History
  distinguishes DB failure from empty storage, and dev startup cannot silently change OPFS origin.
- [x] Feedback severity summary is count-over-label (7/2/3/2 shape) with category filters in the
  hamburger menu; deletion corrections use strike-through + Remove and never an empty arrow.
- [x] Coach notes opens/closes as one smooth shadcn Collapsible: compact desktop rail, closed-first
  phone summary bar, automatic reopening for linked transcript corrections, and no 390px overflow.
- [x] Performance pass: Piper in a lazy worker, single-voice/idle disposal, capped Whisper WASM
  threads, idle Whisper disposal, transfer/stream-based large buffers, lower-frequency meters and
  playback identity, parallel correction loads, Latin-only fonts and offscreen card containment.

## Repository state
- Git history now exists (initial commit `0a2d033 save point`). This is no longer an all-untracked
  working tree.

### External UI critique (applied to real components, 2026-09-14)
Done: #1 active card state, #2 severity-vs-category colour, #3 real audio player, #4 offset-based
corrections (migration v5), #5 responsive split, #7 flat sections (no nested cards), #8 header
overflow menu, #9 translation labels + formal-alternative chips, #10 feedback accordion/filters/
severity summary, #11 conveyor softened + reduced-motion (kept per user), #13 key a11y fixes,
#14 word-click vs card-select clarified, #15 duplicate stats removed, #16 sortOrder, #18 segment
playback state, #19 translation retry + revert-on-failure, #24 copy pass.

Remaining: #6 design-token sweep (kill nonessential <12px arbitrary sizes), #12 replace the last
JS floor-spacer measurement with CSS if a reliable dynamic-height solution emerges, #13b complete
the 44px touch-target/contrast pass, #21 drop the redundant `attempt.translation` field, #23 add
true list virtualization if `content-visibility` proves insufficient for very long histories,
#25 container queries, #26 axe-core/Playwright a11y + visual-regression tests.
