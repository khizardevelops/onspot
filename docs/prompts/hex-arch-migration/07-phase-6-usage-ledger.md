# PHASE 6 — Usage ledger: accounting, rate limits, monitoring

Standing context: Master Strategy Prompt; P0–P5 merged.

## Mission

Port the usage/limits engine — `src/lib/usage/` (`monitor.ts` ~906,
`ledger.ts`, `rateLimits.ts`, `publishedLimits.ts`, `format.ts`) — to Rust
with deterministic time, and rewire the Settings usage meter and any
practice-loop gating (e.g. warnings before hard provider limits) behind the
toggle.

## Tasks

1. **Understand before porting.** `usage/monitor.ts` is one of the largest
   logic files in the app (verify LOC). Map its public surface and callers
   (`rg "usage/" src/lib --files-with-matches`), and write a short
   `docs/architecture/usage-map.md` (counts tracked, reset windows, storage
   rows, UI contracts) — the P0 discipline applies here too.
2. **Goldens**: ledger math (token estimates from request/response payloads,
   per-provider/per-day buckets, reset boundaries at local midnight or
   whatever the TS does — capture, don't guess), `rateLimits` decisions,
   `publishedLimits` tables, `format.ts` display strings (numbers → the
   exact formatted output the UI shows).
3. **Domain + use cases**:
   - `onspot-domain::usage`: `UsageEntry`, bucket value objects, limit
     tables as data.
   - `onspot-app::usage`: `RecordUsage` (called by the P4 `LlmProvider`
     adapter wrapper — token estimates must be computed from the same
     fields the TS estimates from), `UsageSnapshot` query,
     `MaybeWarn` producing `usage_warning` events at the same thresholds.
   - `UsageRepo` (already created in P2) gains the exact read/write patterns
     the ledger needs; fixture-db tests prove legacy rows are read
     correctly.
4. **Clock discipline**: all window/reset math through the injected `Clock`;
   tests pin instants and sweep boundary conditions (23:59:59, midnight,
   DST-affected local days — reproduce the TS's timezone behavior exactly;
   if the TS uses UTC, use UTC; if local, use the same local semantics and
   test around transitions).
5. **Bridge + rewire** (I7): commands `usage.snapshot`, (internal recording
   needs no command); event `usage_warning { kind, provider, message_code }`.
   Settings' `UsageMonitor.svelte` / `UsageMeterRow.svelte` consume the
   snapshot through `core-client` when `core` backend; the practice loop's
   pre-flight warnings flow through the P3 event stream. Flip default after
   gates.

## Acceptance gates

- [ ] Ledger/rate-limit/format goldens pass; boundary-sweep clock tests pass
      with the same timezone semantics as the TS.
- [ ] Fixture-db interop: usage rows written by legacy are aggregated
      identically by core (and vice versa).
- [ ] Manual smoke (web + desktop, `core` backend): run a few evaluations,
      usage meter matches legacy on the same db; warnings fire at the same
      thresholds; nothing regressed in the practice loop.
- [ ] All I1 gates green; `.agents/handoff/` updated.

## Out of scope

Changing any published limit values (data-only move), sync/export (P7).
