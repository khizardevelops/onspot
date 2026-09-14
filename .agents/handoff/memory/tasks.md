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
- [ ] Consider pre-warming word audio for the visible attempt; Piper currently runs on the main
  thread, so measure responsiveness before adopting it.
- [ ] Add per-file SPDX headers for AGPL-3.0 compliance.

## Completed agent tooling
- [x] Isolated, interactive chat-history UI sandbox at `src/routes/ui-sandbox/` (Mock components,
  hardcoded live data, real progressive disclosure with simulated backends) plus
  `npm run bundle:ui` (repomix, sandbox `.svelte` only). Production components and stores are
  deliberately untouched.

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

## Repository state
- No git commits exist yet; the project is currently present as untracked working-tree files.
