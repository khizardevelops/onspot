# PHASE 0 — Audit, coupling matrix, guardrails, fixture harness

Standing context: the Master Strategy Prompt (repo root conversation or
`docs/architecture/`) governs everything. This phase changes **no application
behavior** and moves **no logic**. Its output is truth and guardrails.

## Mission

Re-verify the architecture audit against today's code, publish the coupling
matrix and target blueprint, scaffold the cargo workspace, install automated
boundary guards, and build the golden-fixture capture harness that every later
phase depends on.

## Tasks

1. **Read-first pass.** Do the full §2 reading list. Confirm the current
   `main` HEAD, and check `.agents/handoff/memory/state.md` for in-flight
   work you must not collide with.
2. **Re-verify the audit.** For every file named in the Master Prompt §6
   port table and §8 phase map: confirm existence, role and size
   (`wc -l`, `rg --files`). Known-discrepancy candidates to resolve:
   `stores/practice.ts` vs `stores/practiceSession.ts` (which orchestrates
   what?), the exact split between `adapters/llm/prompt.ts` and
   `languageGuidance.ts`, and whether `stores/processing.ts` derives
   language-data requirements consumed by settings/practice.
3. **Coupling matrix.** Write `scripts/coupling-audit.mjs` (Node, run with
   `bun`): for every file under `src/`, count and list imports of
   `svelte`, `svelte/store`, `svelte/*` runes files (`*.svelte.ts`),
   `@tauri-apps/*`, `plugin:speech`, direct browser globals (`window.`,
   `document.`, `navigator.`, `localStorage`, `indexedDB`, `AudioContext`,
   `fetch(`) and cross-layer imports (`components/` imported by
   `adapters/` etc.). Output a markdown table to
   `docs/architecture/coupling-matrix.md`, ordered by coupling score
   (worst first). Expected top offenders, verify: `stores/practice.ts`,
   `components/FeedbackPanel.svelte`, `components/PracticeScreen.svelte`,
   `components/AttemptCard.svelte`, `components/transcriptMeanings.svelte.ts`,
   `stores/languageData.ts`, `usage/monitor.ts`, `adapters/sync/google/oauth.ts`.
4. **Blueprint + ADRs.** Write:
   - `docs/architecture/hexagonal-blueprint.md` — the target tree, dependency
     rules and the phase map from the Master Prompt, updated with your
     P0 findings.
   - `docs/architecture/PORTS.md` — the port catalog table (fill the
     "verify in P0" column with what you found).
   - `docs/architecture/BRIDGE.md` — the command/event catalog skeletons
     (empty catalogs + conventions + versioning rules).
   - ADR-001: crate/naming layout (approve or adjust the Master Prompt §4
     proposal). ADR-002: the `VITE_CORE_BACKEND` toggle design (how stores
     pick legacy vs core, how the flag defaults, how it is removed in P8).
     ADR-003: golden-fixture format and directory layout.
5. **Workspace scaffold.** Create the cargo workspace per ADR-001 with the
   core crates as **empty but real** crates (lib.rs with SPDX header, README
   one-liner, `cargo test` passing, `serde`/`thiserror` only where the layer
   allows): `crates/onspot-domain`, `crates/onspot-ports`, `crates/onspot-app`,
   `crates/onspot-dsp`, plus placeholder `crates/adapters/*` and
   `bindings/onspot-bridge` (may be empty too). Register `src-tauri` as a
   workspace member without changing its build output. Confirm
   `cargo check` from root compiles all members including `src-tauri`, and
   that `bun run tauri dev` still starts (or `cargo check` in `src-tauri` if
   no display is available).
6. **Boundary guards.** Write `scripts/check-boundaries.mjs`:
   - Rust side: run `cargo tree -e normal --no-dedupe -p <crate>` for each
     core crate and fail if any of `tauri`, `wasm-bindgen`, `js-sys`,
     `web-sys`, `reqwest`, `tokio`, `svelte` appears.
   - TS side: add dependency-cruiser (or ESLint `no-restricted-imports`) with
     initial rules only (don't block anything yet): report (warn) when
     `src/lib/adapters/**` imports from `src/lib/components/**`, and when
     anything outside `src/lib/components|routes` imports a `*.svelte`
     component. Wire both into `bun run lint:boundaries` and into CI as a
     new job (`.github/workflows/architecture.yml`) so it runs on every PR.
7. **Golden-fixture harness.** Build `scripts/capture-golden.mjs`:
   - Runs current TS pure functions under `tsx` (or the repo's existing test
     runner — check `package.json` first; adopt its conventions) on synthetic
     inputs, writing `{ input, expected }` JSON pairs to
     `crates/<crate>/tests/golden/<module>/*.json` per ADR-003.
   - Ship initial captures for at least: `adapters/llm/jsonRepair.ts`
     (including truncated/malformed/`}`-in-string cases and the
     `closingBrace` string-awareness cases), `stores/practice.ts::capWords`
     (~240-word cap), `stores/practice.ts::isSilent` (synthesize PCM), 
     `utils/words.ts::sameWords`, `utils/textChunks.ts::sentenceChunks`.
   - Add a `bun run golden:capture` script and document that captures are
     refreshed only when the *legacy* TS behavior is deliberately changed
     (never during a port).
8. **Handoff.** Update `.agents/handoff/` per the working rules: record the
   audit corrections, the coupling matrix highlights, and P0 completion.

## Acceptance gates

- [ ] `docs/architecture/` contains blueprint, PORTS.md, BRIDGE.md,
      coupling-matrix.md and ADR-001..003; every "expected" file claim in
      this prompt is confirmed or corrected in PORTS.md.
- [ ] `cargo check` passes for the whole workspace from the repo root, and
      every crate has the SPDX header and a test that runs.
- [ ] `bun run lint:boundaries` runs green (warnings allowed, failures none).
- [ ] `bun run golden:capture` regenerates fixtures deterministically
      (two runs, zero git diff) and the listed modules are covered.
- [ ] CI: new `architecture.yml` job runs boundary checks on PRs;
      existing `android.yml`/`release.yml` untouched and valid.
- [ ] `bun run check` and `bun run build` still green; app behavior unchanged.
- [ ] `.agents/handoff/` updated.

## Out of scope

Any logic movement, any `#[tauri::command]` change, any wasm bindings, any
dependency bumps unrelated to the tooling above.
