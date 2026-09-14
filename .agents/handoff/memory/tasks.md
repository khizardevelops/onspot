# Tasks

## Current priority — Phase 3: BYOC sync
- [ ] Google Drive OAuth 2.0 PKCE, client-side upload/download.
- [ ] WebDAV support for Nextcloud, ownCloud, and pCloud.
- [ ] Local `.sqlite` import/export. The database adapter already supports a portable SQL dump;
  raw SQLite bytes can remain a later Tauri optimization.

## Verification and polish backlog
- [ ] Complete a real end-to-end local practice run after downloading Whisper small q4: record,
  worker transcription, configured LLM evaluation, persistence, and read-back.
- [ ] Apply the Piper Tom high-end EQ and loudness pass identified by the listening test.
- [ ] Consider pre-warming word audio for the visible attempt only if measured usage warrants the
  extra CPU/memory; Piper is now worker-hosted and releases its session after 90 seconds idle.
- [ ] Add per-file SPDX headers for AGPL-3.0 compliance.

## Completed agent tooling
- [x] Isolated, interactive chat-history UI sandbox at `src/routes/ui-sandbox/` (Mock components,
  hardcoded live data, real progressive disclosure with simulated backends) plus
  `npm run bundle:ui` (repomix, sandbox `.svelte` only). Production components and stores are
  deliberately untouched.
- [x] Consolidated all benchmark/metric data into `docs/benchmarks/` (`stt.md`, `tts.md`,
  `runtime.md`, `llm-providers.md`, `README.md`) and de-duplicated it out of `rules/constraints.md`,
  `known-issues.md`, `decisions.md` and `plan.md`. `docs/approved-tech.md` and
  `docs/groq-models.md` are now redirect stubs.

## Completed product foundation
- [x] SvelteKit static SPA, Tauri v2 shell, COOP/COEP, and Tauri/OPFS database adapters.
- [x] Mic capture, worker-hosted local Whisper, Groq STT, structured LLM evaluation, persistence,
  Piper/cloud TTS, and cached audio.
- [x] Practice, History, Insights, Settings, search, replay, rename/delete, export, and toasts.
- [x] Explicit card selection with a compositor-driven attempt conveyor, deterministic 1050ms new
  card lift, and no previous/next overlay or scroll-driven selection.
- [x] Per-attempt translation v2: strict idiomatic/literal/word-for-word semantics, retroactive
  regeneration and persistence, optional idiomatic alternatives, word breakdown, and progressive
  disclosure without output headings.
- [x] Apple-inspired product polish using shadcn-svelte primitives throughout Practice,
  AttemptCard, FeedbackPanel, Settings and navigation; smooth phase/disclosure/menu/card
  transitions and a mobile bottom navigation bar.
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
