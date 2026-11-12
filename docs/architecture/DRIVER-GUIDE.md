# Driver guide

How to put a UI or a process in front of onspot's core. Written in P0 as the
target contract; the working examples arrive with P1 (a demo command on web and
desktop) and P8 (the CLI).

## What a driver is

A driver is everything the core is not: it draws or prints, it collects input,
it owns a process lifetime, and it maps core errors to words a learner can read.
It contains no business rule. If a driver starts deciding whether a take is
silent, which prompt to show or when to sync, that rule belongs in the core.

## The loop

1. **Initialise once.** Call `system.init` with a `CoreConfig` (database
   location, stored settings, planted environment facts), the host adapters the
   platform provides (see `PORTS.md`) and an event sink. The response carries the
   current view snapshot.
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
| CLI | Call the bridge's Rust API directly; print the event stream as text. |
| Another language (FFI) | The same JSON envelope over a C ABI; the catalog is the contract. |

## Rules

1. No driver imports a core crate other than the bridge.
2. A driver supplies every port the platform can implement natively (SQL,
   files, notifications, HTTP, OAuth) and shims the rest.
3. A driver never persists its own copy of core state beyond a cache of the
   last snapshot.
4. New copy for an existing error code is a UI change; a new error code is a
   core change and needs the bridge's version bump rules.
5. Feature the core does not expose yet? Add the command in the bridge with its
   ADR, not a second implementation in the driver.

## A future Rune driver (design note only)

Rune is pre-release and has no Android target; no Rune code is in scope. It
would qualify as a driver exactly as the CLI does: initialise the core, render
the snapshot, send commands, consume events, map codes to copy. Nothing in
`crates/` or `bindings/onspot-bridge` changes to make that possible, which is the
test of this architecture.

## Where to start

- Contract: `docs/architecture/BRIDGE.md`
- Capabilities and their adapters: `docs/architecture/PORTS.md`
- Why the layering exists and what must not leak: `hexagonal-blueprint.md`
- Toggle rules while features migrate: `adr/002-core-backend-toggle.md`
