# ADR-003 — Golden-fixture format and layout

- Status: accepted
- Date: 2026-11-12 (P0)
- Deciders: migration lead

## Context

Invariant I4 requires every ported behaviour to be guarded by fixtures captured
from today's TypeScript, and P0 must ship the harness. The fixtures are read by
Rust tests, produced by a JavaScript script and reviewed by humans, so the format
has to be stable, deterministic, diff-friendly and free of user data. There is no
test runner in the repository (no `tsx`, no Vitest): `package.json` is scripts
only, and the project rule is to adopt existing conventions rather than add a
framework for one job.

## Decision

1. **Location follows the code:** `crates/<crate>/tests/golden/<module>.json`,
   where `<crate>` is the crate that will own the ported behaviour. Current
   captures: `crates/onspot-dsp/tests/golden/{capWords,isSilent,sameWords,sentenceChunks}.json`
   and `crates/adapters/llm-openai/tests/golden/jsonRepair.json`. A module that
   later moves crate moves its file in the same commit.
2. **One file per source function**, not per crate. A Rust test loads the file,
   deserializes the cases and asserts `expected` for each `input`.
3. **Format:**

```json
{
	"capturedFrom": "v0.2.4 working tree, 2026-11-12 (P0)",
	"source": "src/lib/config.ts",
	"function": "capWords",
	"cases": [
		{ "name": "above the cap is cut", "input": { "text": "…", "maxWords": 240 }, "expected": "…" }
	]
}
```

   - `name` is a sentence, so a failing case reads as a claim, not an index.
   - `input` is an object of named arguments; a single-argument function keeps
     the argument under its real name (`text`, `first`, `pcm`).
   - `expected` is the exact return value, including `null`/`false` and span
     offsets. No prose and no tolerances: a float compared with an epsilon is
     not a golden fixture.
   - `capturedFrom` names the release or the working-tree date, so a fixture
     taken after a deliberate behaviour change is distinguishable.
4. **Deterministic generation.** `bun run golden:capture` uses fixed synthetic
   inputs (no clock, no randomness, no network, no user data), tab indentation
   and a trailing newline. Two runs must produce byte-identical files; CI
   regenerates and fails on a diff. Inputs are rounded where they are floats, and
   sample arrays stay small (a lowered sample rate, not 48 kHz of silence).
5. **Refresh policy.** A fixture changes only when the *legacy TypeScript*
   behaviour is deliberately changed, in a commit that says why. During a port a
   fixture diff is a failure signal, never a reason to regenerate. The capture
   script's header repeats this rule.
6. **`isSilent` is extracted, not imported.** The function is private to
   `stores/practice.ts`, which imports the Svelte runtime, workers and the
   database and therefore cannot load under Bun. The capture script reads the
   function's source, strips its TypeScript annotations with Bun's transpiler and
   evaluates it. The extraction fails loudly if the function is renamed or moved;
   when P3 moves it into `onspot-dsp` the capture becomes an ordinary import and
   the extractor is deleted in that commit. This is the only such exception; new
   fixtures must import the function.
7. **Script runner:** `scripts/capture-golden.mjs` runs under Bun
   (`bun run golden:capture`) because it imports `.ts` directly. No test framework
   is added for P0. Rust-side tests read the JSON with `serde_json` as a
   dev-dependency.

## Consequences

- Git diffs of a fixture are readable: one JSON object per behaviour, one line
  per changed value in a review tool.
- Fixtures are committed, so a Rust port needs no Node to run its parity tests.
- The `crates/**/tests/golden/` files are test data, not application assets;
  they are excluded from any future bundling and contain no real learner text.
- A function that is not pure or needs a browser cannot be captured this way; it
  belongs in a driver contract test instead, and the phase records why in its
  handoff entry.
- Once a module's Rust replacement passes its fixtures, the fixtures stay and
  guard the Rust path. Deleting the TypeScript function does not delete its
  fixture file.

## Alternatives rejected

- **Snapshot tests inside the TypeScript app** (Vitest inline snapshots). Adds a
  test framework, ties the fixture to TS formatting and cannot be read by Rust.
- **A shared CSV/TOML table.** Loses nested inputs (PCM arrays, argument
  objects) and needs a custom parser on both sides.
- **Capture at test time from the TS source.** The TypeScript module is deleted
  at the end of its phase; the fixture must outlive it.
