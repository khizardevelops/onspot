# ADR-002 — `VITE_CORE_BACKEND` strangler toggle

- Status: superseded by P8 (removed)
- Date: 2026-11-12 (P0); removal 2026-11-14 (P8)
- Deciders: migration lead

## Context

Invariant I7 requires a per-feature backend switch so a rewired screen can fall
back to the TypeScript implementation while its Rust replacement is being
proven. Without it, every phase would be a flag day; with it left in place, two
implementations would drift forever. The same switch must be absent from a
release once the program's definition of done is met (P8).

The app is a static SPA built by Vite, also packaged by Tauri. There is no
server at runtime, so the flag is a build-time constant. That is acceptable: a
shipping build picks one backend, and a developer or tester rebuilds to compare.

## Decision

1. **One variable, two values:** `VITE_CORE_BACKEND=legacy|core`. Unset means
   `legacy`. Anything else fails at startup with a message naming the two
   values; a typo must not silently select the old path.
2. **One reader.** `src/lib/core-client/backend.ts` reads the variable once and
   exports `coreBackend` plus `useCore(feature)`. No component, store or adapter
   reads `import.meta.env.VITE_CORE_BACKEND` directly, and none compares it to a
   string.
3. **Per-feature, not per-phase.** `useCore(feature)` consults a frozen
   allowlist (`FEATURES_WITH_CORE`) of features whose gates have passed. In P1
   the list holds only the demo command. A feature is added to the list in the
   commit that flips it, after its golden fixtures pass against the Rust
   implementation. `legacy|core` is the global switch; the list prevents a
   half-migrated screen from being sent to the core just because the variable
   says `core`.
4. **One call site per store.** A store that supports both backends branches
   once, at the top of the action, into a legacy function and a core function:
   the legacy function is today's body moved verbatim behind a name, not
   rewritten. The store keeps its public shape (same exports, same state fields)
   so views do not know which backend is active.
5. **Default stays `legacy`** until every feature of a phase has passed its
   gates, then the phase's last commit flips the default to `core`. A release
   never ships with a feature that is `core` in the default build and unproven;
   `.env.example` documents the variable and its two values.
6. **No runtime toggle in the UI.** A learner never chooses a backend. The
   switch exists for development, CI and the parity harness.
7. **Removal in P8:** delete `backend.ts`, both `legacy` branches, the allowlist
   and `VITE_CORE_BACKEND` from `.env.example`, CI and docs in one commit; then
   run `rg VITE_CORE_BACKEND` to prove nothing is left. The definition of done
   treats a surviving reference as a failure.

## Removal note (P8)

The toggle was removed once every feature ran on the core. `backend.ts`, the
allowlist, `coreBackend`, `useCore(...)` and `VITE_CORE_BACKEND` are gone from
`src`, `.env.example`, the browser check scripts and CI. `deprecated/src/lib/core-client-backend.ts`
keeps the old module for history only; live code must not import from
`deprecated/`.

## Consequences

- Both code paths exist in a build only for the features that are mid-way, and
  an unreferenced legacy path is visible debt that the phase must remove.
- CI can run the parity harness twice (`legacy` and `core`) without a rebuild
  per test, by building two bundles. P1 adds a `build:core` script when the
  first feature lands; P0 does not need it.
- Golden fixtures are captured only from `legacy`, so a behaviour change made
  while porting shows up as a fixture diff (ADR-003).
- The toggle costs one branch per action and disappears completely at P8.

## Alternatives rejected

- **Runtime flag in `localStorage`.** It lets a learner's device run a
  half-migrated path, and it survives a deploy. Rejected.
- **A separate `src/lib/core-client/legacy/` fork of each store.** Duplicating
  whole stores makes the diff between paths invisible; branching inside one
  action keeps them side by side until the legacy body is deleted.
- **Feature flags per command in the bridge.** The bridge should not know that a
  legacy path exists; the driver chooses, the bridge serves.
