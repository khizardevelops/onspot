# ADR-004 — The event catalog lives in `onspot-app`, not the bridge

- Status: accepted
- Date: 2026-11-12 (P1)
- Deciders: migration lead

## Context

The master strategy prompt (P1 and §5) says the `UiEvent` enum is "defined once
in the bridge" and delivered through the `EventSink` port. The dependency rule
it also sets is one-way: drivers → bridge → app → ports → domain. A use case in
`onspot-app` has to construct and emit `UiEvent` values, so if the enum lives in
`bindings/onspot-bridge`, `onspot-app` would have to depend on the bridge and
the arrow would point outward. The two requirements cannot both hold.

## Decision

1. `UiEvent` and `EventSink` live in `onspot-app` (`crates/onspot-app/src/events.rs`).
   They are wire types: `serde` derives and the `ts-rs` export target, but no
   driver, no framework runtime and no transport.
2. `onspot-bridge` re-exports both. Drivers still import them from the bridge,
   so no driver names a core crate directly (invariant I8).
3. The bridge owns the transports (wasm callback, Tauri channel) and the wire
   error shape (`BridgeError`), because those are driver-facing.
4. Event names and payloads are frozen by the same rules as commands: additive
   changes only; a renamed field is a new event. Unknown events are ignored by
   drivers.

## Consequences

- Use cases can emit without importing the bridge; the arrows stay inward.
- `ts-rs` exports for `UiEvent`/`CoreConfig` run from the `onspot-app` crate, so
  `bun run bridge:types` runs the export tests of both crates.
- The master prompt's wording ("defined in the bridge") is superseded for the
  enum's *location*; its contract rules and the one-catalog principle still
  apply. This ADR is the deviation record the working rules ask for.
- If a future port needs to emit from outside the app crate, the enum moves to
  `onspot-ports`, not outward to the bridge.

## Alternatives rejected

- **Keep `UiEvent` in the bridge and have the app depend on it.** Inverts the
  dependency direction and lets use cases call transport code.
- **Define the event twice** (a core event and a wire mirror). Two catalogs drift;
  the parity work would be invisible.
- **Put `UiEvent` in `onspot-domain`.** Events describe driver-visible progress,
  not domain facts; keeping them in the app keeps the domain free of transport
  concerns.
