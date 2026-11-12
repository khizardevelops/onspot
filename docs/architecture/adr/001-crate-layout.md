# ADR-001 — Crate and naming layout

- Status: accepted
- Date: 2026-11-12 (P0)
- Deciders: migration lead

## Context

The master prompt proposes a tree with `crates/onspot-*`, `crates/adapters/*`,
`bindings/onspot-bridge` and `drivers/*`, and asks P0 to approve or adjust the
names. The repository already has a Rust crate, `src-tauri`, that owns its own
`[workspace]` table (`plugins/speech`), a nested `Cargo.lock`, a release profile
and a `.cargo/config.toml` with a host linker pin. The workspace must include
that shell without changing what it builds.

## Decision

1. **Keep the proposed directory layout and names.** The four core crates are
   `onspot-domain`, `onspot-ports`, `onspot-app`, `onspot-dsp` (package names,
   directory names identical). Adapter packages take an `onspot-adapter-`
   prefix so a crate name is unambiguous in `cargo tree` and in error messages,
   while their directories keep the short capability names:
   `crates/adapters/llm-openai` → `onspot-adapter-llm-openai`,
   `repo-sql`, `sync-drive`, `sync-webdav`, `native-stt` likewise.
   The bridge package is `onspot-bridge` in `bindings/onspot-bridge`.
2. **`src-tauri` stays where Tauri expects it** and is joined to the root
   workspace. Its `[workspace]` table is removed, and `src-tauri/plugins/speech`
   is listed as a root member (its path dependency is unchanged). No other
   manifest field changes.
3. **`drivers/desktop` is not created.** `src-tauri/` is the desktop driver; a
   directory alias would give one crate two homes.
4. **Release profile moves to the root `Cargo.toml`.** Cargo ignores a
   `[profile.*]` table inside a workspace member; the values (`opt-level = "s"`,
   `lto`, `codegen-units = 1`, `panic = "abort"`, `strip`) are copied unchanged
   so desktop and Android release output stays the same size and behaviour.
5. **The host linker pin moves to `.cargo/config.toml` at the root.** Cargo reads
   the closest config walking up from the working directory, so the root file
   serves `cargo` at the repo root and inside `src-tauri/` alike. Keeping two
   copies would let them drift.
6. **The nested `src-tauri/Cargo.lock` is deleted.** A workspace has one lock
   file; leaving the old one in place would suggest builds use it. The root
   `Cargo.lock` is committed, as before.
7. **P0 crates are empty but real**: a `lib.rs` with the SPDX header and a
   module doc, a one-line README where the purpose is not obvious, one smoke
   test, and path dependencies that encode the allowed direction (ports →
   domain, app → domain/ports/dsp, adapters → ports/domain, bridge → app).
   `serde`/`thiserror`/`rusqlite`/`reqwest` are added by the phase that first
   needs them, not pre-declared.
8. **All Rust source files carry
   `// SPDX-License-Identifier: AGPL-3.0-or-later`**; README and manifest files
   carry the comment form where the tool accepts it.

## Consequences

- `cargo check --workspace` now compiles the core plus the Tauri shell; the
  workspace needs Tauri's Linux system libraries in CI (the new
  `architecture.yml` installs them).
- `bun run tauri dev` keeps working because Tauri resolves the app crate through
  its directory, which is now a member of the root workspace.
- A new adapter crate must be added to the root `members` list; the boundary
  guard only checks the declared core crates, so a new core-named crate must be
  added to `CORE_CRATES` in `scripts/check-boundaries.mjs` (and that is a
  deliberate decision, not a convenience).
- Joining the shell to the workspace made `cargo fmt --all` cover files that
  had never been rustfmt-formatted (two-space indentation in `src-tauri/src/`,
  long single lines in the speech plugin). P0 normalised them once: 10 files,
  wrapping and indentation only, no logic. Without it invariant I1's
  `cargo fmt --check` could not be green. A current clippy lint
  (`manual_checked_ops`) also failed on the plugin's download percentage; it is
  written with `checked_mul`/`checked_div` so behaviour (including overflow) is
  explicit rather than suppressed.
- `onspot-adapter-*` is longer to type in `cargo -p`; it buys unambiguous
  forbidden-dependency reporting.

## Alternatives rejected

- **Leave `src-tauri` on its own workspace** and give the core a second
  workspace. Two lock files, two dependency graphs and a bridge that cannot be
  a path dependency of both — rejected.
- **Move the Tauri shell under `drivers/desktop`.** Tauri v2 tooling, the
  Android project and the release workflow all assume `src-tauri/`; the move
  buys nothing the dependency rules do not already enforce.
- **Pre-declare serde/thiserror/rusqlite now.** It would make the first `cargo
  check` slow and the empty crates look designed; an unused dependency is also a
  claim about the architecture that P0 has not made yet.
