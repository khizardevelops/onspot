# Driver guide

How to put a UI or a process in front of onspot's core. The working examples are
the web/desktop driver in `bindings/onspot-bridge` (`src/lib/core-client` on the
TypeScript side) and the headless CLI in `drivers/cli`.

## What a driver is

A driver is everything the core is not: it draws or prints, it collects input,
it owns a process lifetime, and it maps core errors to words a learner can read.
It contains no business rule. If a driver starts deciding whether a take is
silent, which prompt to show or when to sync, that rule belongs in the core.

## The loop

1. **Initialise once.** The web/desktop driver calls `system.init` with a
   `CoreConfig` (database location, stored settings, planted environment facts),
   the host adapters the platform provides (see `PORTS.md`) and an event sink.
   The response carries the current view snapshot.
2. **Paint from the snapshot.** Keep it as fallback state.
3. **Send commands.** `{ cmd, v, payload }` in, `{ ok, data }` or
   `{ ok: false, error: { code } }` out. Never retry a command that reports a
   domain error; it will report the same one.
4. **Update from events.** Replace the snapshot fields the event names; do not
   re-request the whole state after each command.
5. **Map errors to copy.** `error.code` → the sentence the current app shows.
   The mapping lives in the driver (see `BRIDGE.md`); the core never returns
   learner-facing prose.

## Per-platform transports

| Platform | Use |
|---|---|
| Web SPA | The wasm exports of `onspot-bridge`; events through a JS callback. |
| Tauri desktop/Android | Thin `#[tauri::command]` wrappers calling the same dispatcher; events through `tauri::ipc::Channel`. |
| CLI | Call `onspot-app` use cases directly; events are structured stderr lines. |
| Another language (FFI) | The same JSON envelope over a C ABI; the catalog is the contract. |

## A driver in a day: the CLI

The CLI is the smallest complete driver because it skips capture, STT and TTS
(a headless process has no microphone or speaker). It lives in `drivers/cli` and
is deliberately boring:

- `src/db.rs` opens `RusqliteDriver`, runs the shared migrations and builds the
  three repositories (`SqlSettingsStore`, `SqlHistoryStore`, `SqlRecordsStore`)
  over one `SqlDriver`. This is the host side of the SQL port, not a second
  schema.
- `src/http.rs` implements `HttpClient` with `reqwest::blocking`. It adds the
  provider bearer token driver-side from `CliSecrets`; the core only sees an
  `HttpRequest`. Requests run on a worker thread and the loop polls
  `CancelToken`, so Ctrl-C cancels an in-flight call.
- `src/secrets.rs` is the CLI `SecretStore`: environment variables first, then a
  JSON keyfile (`--keys-file`, `ONSPOT_KEYS_FILE`, or the default under the
  config directory). Keys never enter the database, a prompt, an export or the
  event log.
- `src/settings.rs`, `src/sessions.rs`, `src/insights.rs`, `src/evaluation.rs`
  and `src/exports.rs` are thin calls into `onspot-app` use cases. They contain
  no evaluation, merge or export rule.
- `src/main.rs` parses the small command set and prints results. There is no
  Svelte, no Tauri and no node.

The CLI exposes: `settings get/set`, `sessions list/show`, `evaluate`,
`insights`, `export session --format md`, and `export database --out`. The
integration tests in `drivers/cli/tests/cli.rs` run the binary against a
temporary database, a stub HTTP server and a ctrl-c cancellation.

### Adding a command

1. Add the use case in `crates/onspot-app` (or reuse one), with ports for any
   I/O. No driver-specific types.
2. Add the handler in `bindings/onspot-bridge` so web and desktop share it.
3. Regenerate the TypeScript types with `bun run bridge:types`; never hand-edit
   `src/lib/core-client/types.gen.ts` or `bindings/`.
4. Add a thin CLI subcommand only if the process needs it.
5. Add a cross-driver test. The CLI must produce the same core request and
   result as the GUI for the same input.

## Events and types

- Events are additive and named in `docs/architecture/BRIDGE.md`. A driver that
  does not know an event ignores it.
- Command payloads and generated response types are the contract. The catalog
  in `bindings/onspot-bridge` is the source; `scripts/bridge-types.mjs` writes
  `src/lib/core-client/types.gen.ts` and `src/lib/core-client/bindings/*.ts`.
- Every command has `v`, starting at 1. Adding an optional field is not
  breaking; removing or renaming one is. The toggle-era `VITE_CORE_BACKEND` and
  its command versions were removed in P8.

## Rune driver (design note only)

Rune is pre-release and has no Android target; no Rune code is in scope. It
would qualify as a driver exactly as the CLI does: initialise the core, render
the snapshot, send commands, consume events, map codes to copy. Pin a `dev` rev
and verify headlessly with a PNG/element tree, not by eye. Nothing in `crates/`
or `bindings/onspot-bridge` changes to make that possible, which is the test of
this architecture.

## C ABI / FFI (design note only)

A non-Rust, non-web driver uses the same JSON envelope over a small C ABI:
`onspot_init`, `onspot_command`, `onspot_subscribe` and `onspot_free`. The
bridge owns the `extern "C"` exports, the caller owns the strings, and every
call returns an owned JSON result or an error object. The command catalog is the
contract; do not define a second schema in the FFI layer.

## Where to start

- Contract: `docs/architecture/BRIDGE.md`
- Capabilities and their adapters: `docs/architecture/PORTS.md`
- Why the layering exists and what must not leak: `docs/architecture/hexagonal-blueprint.md`
- Live example: `drivers/cli/`
