# PASTE THIS FIRST — onspot Core Extraction: Master Strategy Prompt

You are the senior Rust architect leading a multi-phase refactor of the
**onspot** repository (`khizardevelops/onspot`). This document is **standing
context for every phase** of the program. Each phase also has its own prompt
that adds the phase-specific mission. Never contradict this document; if a
phase instruction conflicts with it, stop and file an ADR.

## 1. Mission

onspot is a speak-first language-practice app (SvelteKit 5 SPA + Tauri v2 for
desktop/Android + a pure web PWA build). Today roughly **41,800 lines of
TypeScript/Svelte carry essentially all business logic**, and only **~788
lines of Rust** exist (a thin Tauri shell: two OAuth loopback commands, a
speech plugin wrapping whisper.cpp model download/load/transcribe, and
Linux display/mic fixes).

The owner has approved a **giant rewrite**: migrate the business logic to a
**pure-Rust core** organized as a Hexagonal Architecture (ports and adapters),
while the app keeps working in **all three runtimes it ships for today**:

1. **Browser / PWA** (static SPA, speech in WASM Web Workers, SQLite via OPFS)
2. **Tauri desktop + Android** (webview UI, native SQLite, whisper.cpp plugin)
3. **Future drivers**: a CLI now, and later *any* UI framework — the owner's
   stated aspiration is Rune (github.com/anomalyco/rune, pre-release) but
   **no Rune work is in scope**. The architecture must merely guarantee that a
   future `drivers/rune` (or iced, egui, a Python frontend over FFI, etc.)
   needs **zero changes to the core**.

The core must not know that Svelte, Tauri, the DOM, Workers, OPFS or any
framework exists. Drivers talk to the core only through one bridge.

## 2. Read before acting (every phase)

Follow the repo's own conventions — this is mandatory, not optional:

1. `AGENTS.md`, then everything active under `.agents/handoff/` (`README.md`,
   `memory/state.md`, `memory/tasks.md`, `memory/decisions.md`,
   `rules/style.md`, `rules/constraints.md`, `references/*`). Never edit
   `AGENTS.md` itself; write session state into `.agents/handoff/` and update
   it before ending every session.
2. `README.md`, `CONTRIBUTING.md`, `docs/architecture/*.md`,
   `src/lib/speech/README.md` (it documents the existing port/adapter seams).
3. Build tooling is **bun**: `bun install`, `bun run dev`, `bun run check`
   (type-check), `bun run build` (static web build), `bun run tauri dev/build`.
   Rust: stable toolchain; Android needs the targets from
   `scripts/android.local.env.example`.
4. CI lives in `.github/workflows/` (notably `android.yml` and
   `release.yml`); every phase must leave them valid. The web build must keep
   the cross-origin isolation headers from `static/_headers`
   (COOP `same-origin`, COEP `credentialless`) — local speech depends on them.
5. Every new Rust file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`
   (repo convention). Respect `.agents/handoff/rules/style.md`.

## 3. Non-negotiable invariants

Numbered so phases can reference them. Violating any of these fails the phase.

- **I1 — Always shippable.** Every phase ends with: `bun run check` green,
  `bun run build` green, `cargo fmt --check` green,
  `cargo clippy --workspace --all-targets -- -D warnings` green,
  `cargo test --workspace` green, and a manual smoke checklist passed on the
  affected surfaces. No phase may leave `main` un-releasable.
- **I2 — Core purity.** The core crates (`onspot-domain`, `onspot-ports`,
  `onspot-app`, `onspot-dsp`) must have **zero** dependencies on `tauri`,
  `wasm-bindgen`, `js-sys`, `web-sys`, `reqwest`, `tokio`, `svelte` —
  directly or transitively (dev-dependencies for tests are allowed and are
  excluded from the check). Enforced by `scripts/check-boundaries.mjs`
  (built in P0) which parses `cargo tree -e normal` per crate.
- **I3 — Data compatibility.** The SQLite schema and its migration chain move
  **verbatim**. A database written by the current release (v0.2.4) must open,
  migrate and work unmodified. Whole-database export/restore format stays
  byte-compatible. BYOK API keys are **never** persisted into the database or
  any export (this is a documented privacy promise).
- **I4 — Parity before deletion.** Every behavior ported from TypeScript is
  guarded by golden fixtures captured from the current TS implementation
  (P0 builds the harness). A TS module is deleted only after its Rust
  replacement passes the same fixtures and the per-feature backend toggle has
  flipped to the Rust path.
- **I5 — LLM prompts are frozen.** Prompt templates (`adapters/llm/prompt.ts`,
  `translationPrompt.ts`, `languageGuidance.ts`, `explanation.ts` text
  framing, `glossary.ts` prompts) are ported **byte-identical**. A test hashes
  the rendered templates against fixtures. Model-facing behavior must not
  drift while the code moves languages.
- **I6 — No user-visible behavior change** during migration: same screens,
  same flows, same error copy. The core returns **typed errors with stable
  codes**; user-facing strings stay in the Svelte driver, which maps
  code → copy (port today's copy from the TS catch blocks verbatim).
- **I7 — Strangler toggle.** A per-feature backend toggle
  (`VITE_CORE_BACKEND=legacy|core`, default `legacy` until a feature's gates
  pass) lets any rewired screen fall back to the legacy TS path. The toggle
  and all legacy paths are removed in P8.
- **I8 — One bridge.** Drivers (Svelte, Tauri commands, CLI) touch the core
  only through the bridge: the command catalog + event catalog with generated
  types. No driver imports core internals; no `#[tauri::command]` contains
  logic beyond marshaling.
- **I9 — Small commits, no drive-by refactors.** View-layer aesthetics,
  gestures, theming and layout stay untouched. Do not rename user-facing
  routes or reformat files that a phase does not need to touch.
- **I10 — Verify, don't trust.** File/LOC references in these prompts come
  from a Nov 2026 audit and may have drifted. Re-verify with `wc -l` /
  `rg` before relying on them, and record corrections in the phase's handoff
  update.

## 4. Target architecture

Finalize names via ADR-001 in P0, but this is the proposed shape:

```
/ (repo root)
├── Cargo.toml                  # [workspace] members = crates/*, drivers/*, src-tauri
├── crates/
│   ├── onspot-domain/          # entities, value objects, domain rules. serde + thiserror only.
│   ├── onspot-ports/           # all port traits (async, object-safe). depends on: domain.
│   ├── onspot-app/             # use cases / orchestration / state machines. depends on: domain, ports.
│   ├── onspot-dsp/             # pure signal/text helpers: isSilent, WAV encode, capWords, sameWords.
│   └── adapters/
│       ├── llm-openai/         # OpenAI-compatible chat client, JSON repair, pacing. deps: ports, reqwest(native)/host-http(wasm).
│       ├── repo-sql/           # repositories over SQL; drivers: rusqlite (native) + host bridge (web).
│       ├── sync-drive/         # Google Drive snapshot sync (HTTP via ports, OAuth via port).
│       ├── sync-webdav/        # WebDAV snapshot sync.
│       └── native-stt/         # desktop/Android whisper.cpp via the existing speech plugin internals.
├── bindings/
│   └── onspot-bridge/          # command/event catalog, dispatch, ts-rs types, wasm-bindgen exports (feature "wasm") + tauri helpers (feature "tauri").
├── drivers/
│   ├── cli/                    # onspot-cli (P8)
│   └── desktop -> src-tauri/   # stays at src-tauri/ (Tauri convention); workspace member, not moved.
├── src/                        # SvelteKit driver (existing). Shrinks to views + thin stores + core-client.
├── src-tauri/                  # existing shell; commands become pass-through.
└── docs/architecture/          # blueprint, coupling matrix, PORTS.md, DRIVER-GUIDE.md, ADRs
```

Dependency direction (one way, always inward):

```
drivers (svelte src/, src-tauri, cli)  ->  bindings/onspot-bridge  ->  onspot-app  ->  onspot-ports  ->  onspot-domain
                                                                      ^                  ^
crates/adapters/*  -------------------  implement ports ----------┘                   │
crates/onspot-dsp  ---------------------------------------- pure, used by app/domain ┘
```

Rules:

- `onspot-domain`: entities (`Session`, `Take`/`Attempt`, `Prompt`,
  `Correction`, `TranslationSet`, `WordGloss`, `VoiceProfile`, `UsageEntry`,
  `LanguageCatalog`...), value objects (`RunMode`, `CorrectionSeverity`,
  `CorrectionCategory`, `ExamStatus`, CEFR levels), domain services. Only
  `serde` (+ `thiserror`). Also owns the **error enum taxonomy** with stable
  codes.
- `onspot-ports`: one trait per outward capability, all `async`, object-safe
  (`dyn`-compatible), cancellation-aware (`CancelToken` parameter or
  `CancellationToken`-style handle owned by the use case). No generic
  associated-type gymnastics; keep them simple to mock.
- `onspot-app`: use cases that today live in `stores/practice.ts`
  (session/take state machine), `stores/languageData.ts` (download planning),
  `usage/monitor.ts`, `insights.ts`, `adapters/sync/service.ts` (diff/merge
  policy), `utils/export.ts` (document assembly), etc. Emits events through
  the `EventSink` port.
- `bindings/onspot-bridge`: the *only* place that knows both Rust and the
  drivers. Holds the command dispatcher (`Command -> Response` over JSON),
  the event catalog, `ts-rs` type generation, and per-driver transports.

## 5. The bridge (commands + events)

This is the contract that lets any language build a driver.

- **Command catalog** (`docs/architecture/BRIDGE.md`): every command is
  `{ "cmd": "practice.stop_and_analyze", "v": 1, "payload": {...} }` ->
  `{ "ok": true, "data": ... } | { "ok": false, "error": { "code": "...", "details": ... } }`.
  Commands are request/response only — never long-lived. Anything streaming
  is a subscription + events. Each command is versioned; breaking payload
  changes bump `v`.
- **Event catalog**: a serde-tagged `UiEvent` enum — `state_changed`,
  `transcription_progress`, `evaluation_started`, `attempt_persisted`,
  `tts_chunk`, `download_progress`, `usage_warning`, `error`, ... — defined
  once in the bridge, serialized with `serde`, delivered through the
  `EventSink` port.
- **Type generation**: `ts-rs` emits every command/event payload type into
  `src/lib/core-client/types.gen.ts`. The Svelte driver gets typed functions
  in `src/lib/core-client/` (hand-written, thin) that call either
  (a) `bindings/onspot-bridge` wasm exports (web), or
  (b) `invoke("core_<command>")` (desktop/Android), behind one interface so
  components never know which.
- **Transports**: web = `wasm-bindgen` exports + `serde-wasm-bindgen`
  marshaling; desktop/Android = thin `#[tauri::command]` wrappers in
  `src-tauri` that forward to the same dispatcher (events via
  `tauri::ipc::Channel`, the pattern already used by the speech plugin);
  CLI = direct Rust calls (no serialization needed) plus the JSON catalog for
  docs.
- **Bootstrap**: each driver calls `init_core(CoreConfig, EventSink,
  HostAdapters)` once. `HostAdapters` is how the browser build injects its
  JS-implemented ports (see §6).

## 6. Ports and the host-adapter transition pattern

The engine of the strangler approach. Each port starts with **legacy
adapters** so phases can land independently:

- **Rust-native adapters** (desktop/Android): implement the port directly in
  Rust (e.g. STT calls the existing whisper.cpp plugin code in-process).
- **Legacy TS host adapters** (web, temporarily): the wasm core calls out
  through a `#[wasm_bindgen]` extern to a small JS shim that delegates to the
  *existing* TS implementation (Workers, sqlite-wasm, Web Audio). The Rust
  core doesn't know or care that the implementation is TS.

Each later phase replaces legacy host adapters with Rust adapters (or, where
the owner decided "ports first" — speech engines, browser storage — keeps the
host adapter permanently and documents it as the web implementation of that
port).

Initial port catalog (map to today's code; verify in P0):

| Port | Today's implementation | First Rust adapter | Web (host adapter) |
|---|---|---|---|
| `LlmProvider` | `adapters/llm/client.ts`, `providers.ts` | `adapters/llm-openai` (reqwest) | host `fetch` bridge |
| `SttEngine` | `speech/stt/*` (transformers worker, Groq, native plugin) | `adapters/native-stt` (desktop/Android only) | transformers worker shim (permanent) |
| `TtsEngine` | `speech/tts/*` (piper worker, ElevenLabs, OpenAI-compat) | — (later; ports first) | piper worker shim (permanent) |
| `AudioCapture` | `utils/recorder.ts` (Web Audio in webview) | — | getUserMedia shim (permanent) |
| `AudioPlayback` | `speech/tts/streamingPlayback.ts`, Web Audio EQ | — | Web Audio shim (permanent) |
| `SqlDriver` | `adapters/db/{TauriSqlAdapter,OpfsSqliteAdapter}.ts` | `rusqlite` (native) | sqlite-wasm worker shim (permanent) |
| `SecretStore` | `stores/secrets.ts` (browser storage) | — | localStorage shim (permanent) |
| `HttpClient` | `adapters/sync/http.ts`, `fetch` | reqwest | fetch shim |
| `OAuthBroker` | `adapters/sync/google/oauth.ts` + `src-tauri/src/oauth.rs` | reuses oauth.rs loopback (desktop) | browser redirect shim |
| `BlobStore` | recordings/cached audio/model files (OPFS / fs) | `tauri-plugin-fs` path (native) | OPFS shim |
| `Clock`, `IdGen` | `Date.now`, `newId()` | std + ulid | same, injected |
| `NotificationScheduler` | `platform/notifications.ts`, `stores/reminders.ts` | tauri notification (later) | Notification API shim |
| `EventSink` | implicit today | bridge transports | JS callback |
| Repositories (`Sessions`, `Attempts`, `Glosses`, `Translations`, `Usage`, `Settings`) | `adapters/db/SqlDatabaseAdapter.ts` (679 LOC) + schema.ts | `adapters/repo-sql` | same, over SqlDriver |

## 7. Worked example (the pattern every phase follows)

Today (`src/lib/stores/practice.ts`, ~1,453 lines): `stopAndAnalyze()` reads
Svelte stores, checks phase, stops the recorder, checks silence, updates UI
phase strings, calls `transcribeSpeech(...)`, caps words, calls
`evaluateAttempt(...)`, persists via the DB adapter, mutates `writable` state,
and triggers playback — orchestration, domain rules, persistence and view
state welded together.

After P3 it looks like:

```rust
// onspot-app: use case. Knows ports, nothing else.
pub struct StopAndAnalyze<'a> { /* sessions, stt, llm, repo, clock, dsp, events, token */ }
impl StopAndAnalyze<'_> {
    pub async fn execute(&self) -> Result<(), CoreError> {
        let recording = self.capture.stop().await?;            // AudioCapture port
        if self.dsp.is_silent(&recording.pcm) {                // onspot-dsp
            self.events.emit(UiEvent::TakeSilent)?; return Ok(());
        }
        self.events.emit(UiEvent::Transcribing)?;              // EventSink port
        let heard   = self.stt.transcribe(&recording, &self.token).await?;   // SttEngine port
        let capped  = self.dsp.cap_words(heard, MAX_WORDS);
        let verdict = self.evaluate.run(capped.clone()).await?; // LLM use case (P4)
        let id      = self.repo.persist_attempt(/* ... */).await?;           // repository port
        self.events.emit(UiEvent::AttemptPersisted { id })?;
        Ok(())
    }
}
```

The Svelte store shrinks to: subscribe to events, hold a view snapshot, call
`bridge.practice.stopAndAnalyze()`, map `error.code` to copy. Recording UI,
waveform, buttons never move.

## 8. Phase map (details live in each phase prompt)

| Phase | Moves | Risk |
|---|---|---|
| P0 | Nothing — audit, workspace scaffold, boundary guards, fixture harness | none |
| P1 | Nothing — bridge spine + one demo command on web & desktop | low |
| P2 | `adapters/db/*` schema+SQL, `stores/settings.ts`, `stores/secrets.ts`, history read/rename/delete | medium (data) |
| P3 | `stores/practice.ts` state machine, recorder/silence/capWords, STT/TTS/playback ports | high |
| P4 | `adapters/llm/*` client+evaluation+repair+explanation+pacing+providers | high (behavior parity) |
| P5 | translations, `adapters/llm/glossary.ts`, gloss/phrase jobs, `insights.ts` | medium |
| P6 | `usage/*` ledger, rate limits, monitoring UI data | medium |
| P7 | `utils/export.ts`, `adapters/sync/*`, `languages/index.ts` + `stores/languageData.ts` planning, reminders, onboarding | high (network/oauth) |
| P8 | CLI driver, delete toggle + all legacy TS business modules, final audit | low |

## 9. Testing and parity strategy

- **Golden fixtures** (P0): `scripts/capture-golden.mjs` runs the *current*
  TS functions under `tsx` on synthetic inputs and writes JSON to
  `crates/**/tests/golden/`. No API keys, no real user data. Candidates:
  `jsonRepair`, `capWords`, `isSilent`, `sameWords`, `sentenceChunks`,
  insights aggregation, usage-ledger math, sync diff decisions, prompt
  rendering.
- **Contract tests**: every port has a test suite that runs against *all* its
  adapters (Rust and host-shim where feasible), so a shim can't silently
  diverge.
- **SQLite fixture**: check in a small synthetic database produced by the
  current release build; every repo change must open+migrate it on both
  `rusqlite` and the web shim path.
- **Determinism**: `Clock` and `IdGen` are injectable; tests never sleep and
  never hit the network (LLM/stt tests use canned response fixtures).

## 10. Working rules

1. Produce and maintain `docs/architecture/hexagonal-blueprint.md`,
   `PORTS.md`, `BRIDGE.md`, `DRIVER-GUIDE.md` and ADRs in
   `docs/architecture/adr/` for every deviation from this prompt.
2. Update `.agents/handoff/memory/{state,tasks,last-session}.md` and
   `decisions.md` at the end of every session.
3. Commits are small and conventional (`refactor(core): ...`,
   `feat(bridge): ...`); one logical change per commit; never mix a migration
   step with an unrelated cleanup.
4. If a phase discovers the audit was wrong about a file's role, stop that
   step, record the finding, adjust the plan in the handoff, continue.
5. Never edit `AGENTS.md`, never commit secrets, never add user data to
   fixtures, never widen a port's surface without an ADR.

## 11. Program definition of done (checked at P8)

- All business logic (§8 rows P2–P7) lives in core crates; the Svelte driver
  contains only views, view-state stores and the `core-client` glue;
  `src-tauri` commands are pass-through; `VITE_CORE_BACKEND` and legacy
  paths are gone.
- `scripts/check-boundaries.mjs` passes: core crates dependency-free of
  frameworks; TS dependency-cruiser rules block `svelte/store` imports
  outside view stores and block driver imports of anything but
  `core-client` + view modules.
- `drivers/cli` performs a real end-to-end loop (settings → list sessions →
  evaluate a transcript from a file → insights → export) against the same
  core the GUI uses.
- `DRIVER-GUIDE.md` documents adding a new driver in under a day, including
  the future Rune driver (design note only — no Rune code).
- All CI workflows green; release version bumped per repo convention.
