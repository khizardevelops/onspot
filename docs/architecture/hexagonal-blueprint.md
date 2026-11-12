# Hexagonal architecture blueprint

Status: accepted at P0 (2026-11-12). Supersedes the tree proposed in
`docs/prompts/hex-arch-migration/00-master-strategy-prompt.md` only where this
document says so; the mission, invariants and phase order are unchanged.

## Why

onspot's behaviour lives in ~49,400 lines of TypeScript and Svelte (222 source
files under `src/`), while the Rust side is ~780 lines of Tauri shell. Every
screen, store and adapter reaches into the Svelte runtime, the DOM, Web Workers,
SQLite-WASM and the Tauri API at once, so the same rule is written once per
runtime and can only be tested in a browser. The migration moves behaviour into a
framework-free Rust core and leaves the drivers as views and transports.

The end state is fixed by the program definition of done: the Svelte driver holds
views, view state and `core-client` glue; `src-tauri` commands only marshal; a
future driver (CLI now, Rune or anything else later) talks to the same core
through the same bridge.

## Current shape (verified 2026-11-12, P0)

| Area | Files | Lines | Where |
|---|---|---|---|
| Practice state machine + attempt pipeline | 1 store (+1 context helper) | 1,757 + 39 | `src/lib/stores/practice.ts`, `practiceSession.ts` |
| SQLite schema, migrations, SQL adapter | 3 | 178 + 792 | `src/lib/adapters/db/` |
| LLM client, prompts, evaluation, explanation, glosses | 14 | 2,933 | `src/lib/adapters/llm/` |
| Settings, secrets, processing choices | 3 | 485 + 57 + 197 | `src/lib/stores/` |
| Language registry and voices | 3 | 611 + voices table | `src/lib/languages/` |
| Usage ledger, limits, monitor | 4 | 1,410 | `src/lib/usage/` |
| Sync (Drive, WebDAV, diff policy) | 7 | 1,320 | `src/lib/adapters/sync/` |
| Speech (STT, TTS, workers, playback) | 40+ | ~9,000 | `src/lib/speech/` |
| Views | ~40 | ~15,000 | `src/lib/components/`, `src/routes/` |
| Tauri shell | 7 Rust files | 783 | `src-tauri/src/`, `src-tauri/plugins/speech/` |

Exact per-file coupling, ordering and offenders: `coupling-matrix.md`.

## Target tree (as built in P0)

```
/
├── Cargo.toml                    # workspace: core, adapters, bridge, src-tauri
├── .cargo/config.toml            # host linker pin (moved from src-tauri/)
├── crates/
│   ├── onspot-domain/            # entities, value objects, error taxonomy; serde+thiserror only
│   ├── onspot-ports/             # object-safe async port traits; depends on domain
│   ├── onspot-app/               # use cases; depends on domain, ports, dsp
│   ├── onspot-dsp/               # pure signal/text helpers
│   └── adapters/
│       ├── llm-openai/           # package onspot-adapter-llm-openai
│       ├── repo-sql/             # package onspot-adapter-repo-sql
│       ├── sync-drive/           # package onspot-adapter-sync-drive
│       ├── sync-webdav/          # package onspot-adapter-sync-webdav
│       └── native-stt/           # package onspot-adapter-native-stt
├── bindings/
│   └── onspot-bridge/            # command/event catalog, dispatcher, ts-rs, transports
├── drivers/
│   └── cli/                      # onspot-cli (P8)
├── src/                          # SvelteKit driver: views + view state + core-client
├── src-tauri/                    # existing Tauri shell, workspace member
├── docs/architecture/            # this file, PORTS, BRIDGE, DRIVER-GUIDE, ADRs
└── scripts/
    ├── coupling-audit.mjs        # coupling-matrix.md generator
    ├── check-boundaries.mjs      # I2/I8 guards (Rust tree + TS layers)
    └── capture-golden.mjs        # I4 fixtures
```

`drivers/desktop` is not created: `src-tauri/` stays where Tauri expects it and
is a workspace member.

### Dependency direction

```
drivers (src/, src-tauri/, drivers/cli) -> bindings/onspot-bridge -> onspot-app -> onspot-ports -> onspot-domain
                                                                       ^
crates/adapters/*  ------------- implement ports ----------------------┘
crates/onspot-dsp  ------------- pure helpers, used by app --------------┘
```

Rules:

1. Arrows point inward only. A core crate never names a driver, a framework, a
   wasm binding layer, an HTTP client or an async runtime.
2. `onspot-domain` has no dependencies today; `serde` and `thiserror` are the
   only ones it may gain.
3. `onspot-ports` may only depend on `onspot-domain`. A port's signature uses
   domain types and `CancelToken`, never a driver type.
4. `onspot-app` may depend on domain, ports and dsp. It emits
   `UiEvent` through the `EventSink` port; it never touches a store.
5. Adapters depend on ports (and domain for their data shapes). An adapter never
   imports another adapter.
6. `onspot-bridge` is the only crate that knows a driver exists. It may use
   `wasm-bindgen` (feature `wasm`) and Tauri (feature `tauri`); the core half
   stays driver-agnostic.
7. The Svelte driver imports `src/lib/core-client/` and view modules; nothing
   else from the core. `src-tauri` commands only marshal.

### Enforcement

- `scripts/check-boundaries.mjs` runs `cargo tree -e normal --no-dedupe -p
  <core crate>` for the four core crates and fails on `tauri`, `wasm-bindgen`,
  `js-sys`, `web-sys`, `reqwest`, `tokio` or `svelte` anywhere in the normal
  tree. Dev-dependencies are excluded, which is why test-only helpers are
  allowed.
- The same script reports TypeScript layer violations: an adapter importing
  `src/lib/components/`, or anything outside `src/lib/components` and
  `src/routes` importing a `.svelte` file. P0 reports warnings (there are none
  today); `--strict` turns them into failures when a later phase has cleaned up
  the remaining cases.
- CI job `.github/workflows/architecture.yml` runs both guards, checks that the
  coupling matrix and the golden fixtures regenerate byte-identically, and runs
  `cargo fmt`, `cargo clippy` and `cargo test` for the workspace.

## Ports and the host-adapter transition

Each port starts with the adapter that exists today, so phases land
independently:

- **Rust-native** (desktop/Android): implement the port directly, e.g.
  `native-stt` reuses the whisper.cpp engine already in
  `src-tauri/plugins/speech`.
- **Legacy host adapters** (web, temporary): the wasm core calls a small JS shim
  through a `#[wasm_bindgen]` extern, and the shim delegates to the current
  TypeScript implementation (Workers, sqlite-wasm, Web Audio). The core cannot
  tell that the other side is TypeScript.

Permanent host adapters are documented as the web implementation of the port:
STT (Transformers.js worker), TTS (Piper/Supertonic workers), audio capture and
playback (Web Audio), SQL (sqlite-wasm worker), secrets (browser storage),
notifications (Notification API), and the fetch-based HTTP client where a CORS
browser call is the only option.

## Phase map

| Phase | Moves (verified sources) | Risk |
|---|---|---|
| P0 | Nothing. Audit, workspace, boundary guards, fixture harness. | none |
| P1 | Bridge spine + one demo command on web and desktop. | low |
| P2 | `adapters/db/schema.ts` (178) + `SqlDatabaseAdapter.ts` (792) + `TauriSqlAdapter.ts` (108), `stores/settings.ts` (485), `stores/secrets.ts` (57), history read/rename/delete, migration 12 compatibility. | medium (data) |
| P3 | `stores/practice.ts` state machine (1,757), `utils/recorder.ts` (361), silence + word cap, STT/TTS/playback ports. | high |
| P4 | `adapters/llm/` client + evaluation + repair + explanation + pacing (2,933 total; prompt strings frozen). | high (parity) |
| P5 | Translations (`translate.ts`, `translationPrompt.ts`), `glossary.ts`, gloss/phrase jobs, `insights.ts` (121). | medium |
| P6 | `usage/` ledger, limits, monitor (1,410), rate-limit warnings. | medium |
| P7 | `utils/export.ts` (433), `adapters/sync/` (1,320), `languages/index.ts` (611) + `stores/languageData.ts` (443) planning, reminders (199), onboarding. | high (OAuth/network) |
| P8 | CLI driver, delete the toggle and all legacy business modules, final audit. | low |

## P0 audit corrections

Recorded here and in `.agents/handoff/memory/state.md`; later phases should
trust these numbers over the master prompt's Nov 2026 audit.

1. **`stores/practice.ts` is 1,757 lines, not ~1,453**, and the master prompt
   understated its imports: 30+ modules including the LLM adapters, speech
   service, DB adapter, language data, settings, audio and prompt catalogue.
   It is the largest single migration in the program.
2. **`stores/practiceSession.ts` does not orchestrate anything.** It is a 39-line
   Svelte context helper that lets the Text-size preview render the same
   Practice screen with a non-live session. It shrinks rather than ports: once
   `practice.ts` is a thin view model, the context object only carries the
   snapshot, `live` and `setActiveAttempt`.
3. **`prompt.ts` and `languageGuidance.ts` split differently than assumed.**
   `prompt.ts` (183) owns the evaluation JSON schema, the request messages and
   the length limits. `languageGuidance.ts` (79) contains only language-specific
   rule text (Japanese, Persian and the shared level note) appended to those
   prompts. Both must move byte-identically (invariant I5); the
   `languageGuidance.ts` strings are prompt text, not UI copy.
4. **`stores/processing.ts` does derive language-data requirements** and is the
   single source consumed by both the Settings capability rows and the Practice
   gate (`firstMissingRequirement`, `processingReady`). It is therefore part of
   P2's use cases, not a view store.
5. **The schema is at version 12**, not the 10 recorded in the master prompt:
   migration 10 (`sessions.setup`), 11 (`prompts.instruction_language`) and 12
   (`prompt_submissions`) are uncommitted in the working tree. A v0.2.4 database
   is at 9; the compatibility fixture must therefore be captured at 9 **and** at
   12, and the Rust chain must accept both.
6. **The coupling matrix does not put `practice.ts` on top**, because it imports
   no components and touches few browser globals. Its cost is fan-out (30+
   internal modules), which the counted categories do not measure. Treat the
   matrix as a layer-coupling rank and `practice.ts` as the largest orchestrator;
   P3 is still the high-risk phase.
7. **`src/` is ~49,400 lines across 222 source files**, not ~41,800; the
   difference is mostly the speech workers and model-lab tooling that arrived
   after the audit. Rust is 783 lines, close to the 788 recorded.
8. **There are no adapter→component imports today**, so the TypeScript boundary
   rules start with zero warnings. The UI and adapters are already separated at
   import level; the coupling is through stores and runtime globals.

## Invariants

I1–I10 from the master prompt apply unchanged. The checks that enforce them:

| Invariant | Check |
|---|---|
| I1 always shippable | `bun run check`, `bun run build`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, smoke checklist |
| I2 core purity | `bun run lint:boundaries` (cargo tree) |
| I3 data compatibility | SQLite fixture DBs at schema 9 and 12, opened by both repo paths |
| I4 parity before deletion | `bun run golden:capture` + Rust tests against `tests/golden/` |
| I5 prompts frozen | hash fixtures for rendered templates (P4) |
| I6 no user-visible change | view copy stays in the driver; stable error codes |
| I7 strangler toggle | ADR-002 |
| I8 one bridge | boundary rules + pass-through Tauri commands |
| I9 small commits | review convention |
| I10 verify, don't trust | this audit section |
