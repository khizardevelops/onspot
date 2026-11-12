# ADR-007 — Browser SQL host, async dispatch, and driver-side secrets

Status: accepted (P2, 2026-11-12)

## Context

P2 needs the Rust schema, migration runner and repositories to run in the
browser too. The engine must stay the existing `sqlite.worker.ts` /
`OpfsSqliteAdapter` path, because it owns the OPFS access handle and the
page's single connection. Rust calls therefore cross into JavaScript promises.
The native port required `Send + Sync`; JavaScript objects and futures are
neither.

## Decision

### Async command surface

- `dispatch` is `async` on the bridge. Tauri's `core_command` is an async
  command and clones the `Arc<Core>` before awaiting; the wasm exports return
  promises. The event handshake stays synchronous.
- Native repositories are unchanged; they simply complete without yielding.

### Two port flavours

- `SqlDriver`, `HistoryStore` and `SettingsStore` are `Send + Sync` and use
  `#[async_trait]` on native targets.
- On `wasm32` the same traits use `#[async_trait(?Send)]` and drop the bounds,
  matching `EventSink`'s existing split. The store implementations select the
  flavour with `cfg_attr`.
- `repo-sql`'s rusqlite driver is behind the default `native` feature, so the
  wasm bridge depends on the crate with `default-features = false` and supplies
  its own driver.

### The browser SQL host

- `init_core_wasm(config, callback, sqlHost)` accepts an optional
  `{ execute, select, batch, close }` object. `src/lib/core-client/sqlHost.ts`
  builds it over `getDatabaseAdapter().driver()`; `close` is a no-op so the page's
  adapter outlives the core.
- `WasmSqlDriver` implements the port with `js_sys::Function` calls and
  `JsFuture`. Rows come back as plain objects and are decoded into `SqlRow`.
- The browser adapter has already run its own migration chain before the host
  is built; the Rust migration then finds every version applied and writes
  nothing. The Rust chain still owns an uninitialised or older file.
- SQL text and parameters originate in Rust; the SQLite engine and its version
  remain the vendor's wasm.

### Secrets stay driver-side

- The `SecretStore` implementation is `src/lib/core-client/secrets.ts`
  (`localStorage`, same `onspot.key.` names). `stores/secrets.ts` keeps its
  public store API and calls it.
- There are **no** `secrets.*` Rust commands. Adding them would either require
  the Rust core to call JavaScript synchronously in Tauri (not possible without
  `eval`) or move keys to a Rust file, changing where an existing key lives and
  whether it survives an upgrade. Keeping keys out of the core is also the
  strongest form of I3.
- Regression coverage: the browser contract check writes a secret, asserts
  `settings.get` returns `null` for it, and asserts a whole-database export from
  the legacy path does not contain the value. `SettingsService` additionally
  filters `onspot.key.` rows in case a restored file contains one.

## Consequences

- One dispatcher, one command catalog and one set of services run on both
  transports; only the port implementation differs.
- Browser storage commands fail with `bridge.unavailable` when a driver boots
  without a SQL host (for example a core build in a page whose wasm package is
  absent). The settings store falls back to the legacy adapter and logs it, so a
  release without the wasm package still opens.
- JavaScript promises mean the wasm command surface is async; a caller must
  `await` `init_core_wasm` and `dispatch_wasm`.

## Rejected

- **Synchronous Atomics bridge:** needs `SharedArrayBuffer`; production is not
  cross-origin isolated (COOP `same-origin-allow-popups`).
- **Second OPFS connection from Rust:** OPFS access handles are exclusive.
- **Letting the core own the worker's lifetime:** the legacy adapter still
  shares it until P8.
- **Rust file-backed secrets:** changes persistence for existing learners and
  puts keys on disk outside browser storage.
