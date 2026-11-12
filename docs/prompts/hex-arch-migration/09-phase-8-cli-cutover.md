# PHASE 8 — CLI driver, legacy cutover, final boundary audit

Standing context: Master Strategy Prompt; P0–P7 merged (every feature runs
on the core by default).

## Mission

Prove portability with a second driver written in pure Rust (the CLI),
remove the strangler scaffolding, delete every legacy TS business module,
re-run the coupling audit, and publish the driver guide that makes future
drivers — including Rune — a documentation exercise.

## Tasks

1. **`drivers/cli` (`onspot-cli`)**:
   - A real driver over the same `onspot-app` use cases, no Svelte, no
     Tauri: `clap`-based subcommands at minimum:
     `settings get/set`, `sessions list`, `sessions show <id>`,
     `evaluate --transcript <file> [--mode exam|casual]` (uses the P4
     pipeline with a Groq/DeepSeek key from env or a keyfile via a
     `SecretStore` CLI adapter — file-based, documented, never the DB),
     `insights`, `export session <id> --format md`,
     `export database --out <file>`.
   - STT/TTS/capture are *absent* by design (ports-first decision): the CLI
     documents that engines are driver concerns and shows the port
     implementations a full-CLI driver would inject. Do not add native
     engine builds in this phase.
   - Events print as structured lines (`tracing-subscriber`); cancellation
     via ctrl-c maps to `CancelToken`.
2. **Delete the scaffolding**:
   - Remove `VITE_CORE_BACKEND` and every legacy branch it guarded
     (ADR-002 removal note).
   - Delete the TS business modules now dead: `stores/practice.ts` logic
     (keep the thin event-subscriber store), `adapters/llm/*` domain parts
     (keep any still-used pure view helpers only if genuinely
     view-related), `usage/*`, `insights.ts`, `adapters/db/*` (schema,
     adapters, worker wiring — the web sqlite worker shim remains only as
     the host side of the `SqlDriver` port, now minimal), `adapters/sync/*`
     logic (keep host shims only), `lib/onboarding.ts` logic,
     `stores/languageData.ts` logic, `stores/settings.ts`/`secrets.ts`
     logic, `stores/reminders.ts` logic, and the dead parts of
     `utils/*` (`corrections.ts`, `correctedPassages.ts`, `export.ts`,
     `sessionTranscript.ts`, ... — verify each: if a component still calls
     it, either it is view logic (move it next to the component) or the
     rewiring missed a call site).
   - After deletion, `bun run check` must pass with **zero** references to
     deleted modules; fix every dangling import by rewiring to
     `core-client`, not by re-adding code.
3. **Final audits**:
   - Re-run `scripts/coupling-audit.mjs`; write the before/after table into
     `docs/architecture/coupling-matrix.md` (P0 numbers vs final numbers).
   - `scripts/check-boundaries.mjs`: extend TS rules from warn to **error**
     — nothing under `src/lib` may import `svelte/store` except
     view-state stores and `core-client`; nothing may import
     `@tauri-apps/*` or `plugin:speech` outside the `core-client`
     transport and platform shims; `crates/**` framework-free (I2).
   - Run the full I1 gate set plus: `bun run tauri build` on one desktop
     target, the Android APK build (or CI), and a fresh-clone
     `bun install && bun run build` to prove no hidden state.
4. **Documentation**:
   - `docs/architecture/DRIVER-GUIDE.md`: step-by-step "add a driver in a
     day" — init_core, HostAdapters, command dispatch, event subscription,
     type generation; includes a **Rune driver design note** (pre-release,
     pin a `dev` rev, headless PNG/element-tree verification, no code in
     this repo yet) and a c-abi/FFI note for non-Rust non-web languages.
   - Update `README.md` "Under the hood" and `docs/architecture/*` to
     describe the new architecture; update `.agents/handoff/references/`
     overview accordingly.
5. **Release**: bump version per repo convention, write release notes from
   `docs/releases/` conventions, tag to exercise `release.yml` and
   `android.yml` end-to-end.

## Acceptance gates

- [ ] `onspot-cli` performs the full listed command set against the same
      core; `evaluate` on a fixture transcript matches the GUI's core output
      for the same input (one golden cross-driver test).
- [ ] Legacy deletion complete: `rg -l "VITE_CORE_BACKEND" src` is empty;
      the deleted-module list above has no survivors except documented
      view helpers; check passes.
- [ ] Boundary audit: TS rules now error-level and green; Rust boundary
      check green; coupling matrix shows the target separation achieved.
- [ ] Fresh-clone build + desktop installer + Android APK + web build all
      succeed; manual practice smoke on web + desktop one final time.
- [ ] DRIVER-GUIDE.md + README + handoff updated; release tagged and
      workflows green.

## Out of scope

Rune code, native Rust speech engines (future decision per ADR-005),
iOS-native anything, new user-facing features.
