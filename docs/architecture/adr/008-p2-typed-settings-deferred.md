# ADR-008: Typed settings defaults and merge stay in TypeScript until P7

- Status: Accepted
- Date: 2026-11-12
- Phase: P2 (storage, settings, history)

## Context

The P2 phase prompt lists a typed `AppSettings` document with defaults and
normalisation as part of the settings move. The P2 implementation moved the
persisted rows and their bridge commands, but left the document in
`src/lib/stores/settings.ts`.

That document is not a storage concern alone. Loading it validates the studied
and instruction languages against the language registry, picks default voices,
normalises voice memories, clamps per-voice tuning, rewrites retired ElevenLabs
voices, decides provider/model compatibility, and records the Automatic-model
migration. Those rules depend on `src/lib/languages/`, the LLM provider catalog
and the speech voice catalog, all of which move in P7.

`memory/decisions.md` already deferred the typed document to P7. The phase
prompt and that decision disagree; the master strategy requires a conflict to
stop being silent.

## Decision

P2 owns `settings.list/get/set` over the same rows the legacy store writes.
`settings.ts` keeps the typed defaults, merge and normalisation until P7, when
the language, provider and voice catalogs move to the core. P7 will port the
document together with those catalogs and remove the TypeScript copy.

This is a scope correction, not a storage gap: the rows, key names, JSON values
and timestamps are already byte-compatible and proven by the native and browser
checks.

## Consequences

- P2 can close without inventing a second copy of the language/voice registry
  in Rust, which would immediately drift from the TypeScript one.
- A legacy database still loads exactly: the TypeScript document reads the
  Rust-written rows and vice versa.
- P7 gains a named deliverable: `AppSettings` defaults/merge in the core, with
  golden parity against this TypeScript implementation.
- The P2 phase prompt is historically inaccurate on this point; this ADR is
  the source of truth.

## Alternatives considered

- **Port the document now with an injected catalog snapshot.** Rejected: the
  snapshot would need the whole registry shipped through `CoreConfig`, plus a
  second source for provider/voice rules, for no P2 caller.
- **Port the registry now.** Rejected: that is P7 and would pull P7's largest
  risk into P2.
- **Leave the conflict undocumented.** Rejected by the master strategy.
