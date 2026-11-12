# PHASE 2 — Storage foundation: schema, repositories, settings, secrets, history

Standing context: Master Strategy Prompt; Phases 0–1 merged (workspace,
bridge, `core-client`, toggle plumbing).

## Mission

Move the data layer to Rust behind the `SqlDriver` port: the schema and
migration chain, the repositories, then the first two consumers — settings
(+ secrets) and the history screen. This is the phase where data
compatibility (invariant I3) is won or lost.

## Tasks

1. **Schema and migrations**:
   - Port `src/lib/adapters/db/schema.ts` (verify current LOC; it holds the
     DDL and the migration chain) **verbatim** into
     `crates/adapters/repo-sql/src/schema/`: same table names, columns,
     indexes, same ordered migrations, same `PRAGMA user_version` (or
     equivalent) handling. Tests assert: fresh-install DDL matches the
     fixture expectations, and the checked-in synthetic v0.2.4 fixture
     database (P0 didn't create it — create it now using the current app
     build on either runtime, fill it with synthetic sessions/attempts
     covering every schema generation, check it in) opens, migrates forward
     and passes integrity checks **on both drivers**.
   - Do not "improve" types, collation or defaults. If a column has a wart
     the code relies on, reproduce the wart; note it in an ADR if grotesque.
2. **SqlDriver port + adapters**:
   - `onspot-ports::SqlDriver` mirrors today's TS interface
     (`adapters/db/types.ts`): `execute`, `select`, optional `batch`,
     `close` — async, object-safe. Keep the `batch` optionality and its
     documented reason (connection pooling semantics differ per driver).
   - Adapter A (native, desktop/Android): `rusqlite` (bundled feature)
     behind a small connection actor. Decide via ADR-004 whether
     `tauri-plugin-sql` stays registered during this phase (recommended:
     keep it until P8 so the legacy path keeps working).
   - Adapter B (web): a host-adapter shim — the bridge calls out to JS
     (`#[wasm_bindgen]` extern), JS delegates to the **existing**
     `sqlite.worker.ts` / `OpfsSqliteAdapter` machinery unchanged. SQL text
     and parameters originate in Rust; the engine stays the vendor wasm.
   - Contract tests: one suite exercised against both adapters (fixture db,
     migration, transaction/`batch` semantics, error mapping).
3. **Repositories** (`crates/adapters/repo-sql`):
   - Port the query logic of `SqlDatabaseAdapter.ts` (verify LOC, ~679) into
     typed repositories: `SettingsRepo`, `SessionsRepo`, `AttemptsRepo`,
     `GlossesRepo`, `TranslationsRepo`, `UsageRepo` (usage repo now, logic
     in P6). Methods 1:1 with what the TS call sites need today — check
     call sites with `rg "SqlDatabaseAdapter|db\." src/lib` and enumerate.
   - Every query that history/insights/usage later needs gets a golden test
     against the fixture db.
4. **Settings + secrets use cases**:
   - Port `stores/settings.ts` (verify LOC, ~376): defaults, load, merge
     semantics for fields a restored database lacks (the handoff decisions.md
     records a fixed bug about `initSettings()` overwriting fields on cold
     start — reproduce the *fixed* behavior, not the bug), and the
     Local/Cloud per-capability shape consumed by `stores/processing.ts`.
   - Port `stores/secrets.ts` behind the `SecretStore` port (host shim on
     web: browser storage; on desktop the same semantics — keys stay out of
     the database and out of exports, I3, add a regression test that
     `settings`/`export` paths never contain key material).
   - Bridge commands: `settings.get`, `settings.update`,
     `secrets.set`/`secrets.get`/`secrets.delete` (delete: values never
     returned in bulk), plus `settings.test_llm_connection` can stay legacy
     until P4 — do not port it here.
   - Event: `settings_changed` when the snapshot changes.
5. **History read path**:
   - Port what `src/routes/history/+page.svelte` (verify LOC, ~564) needs:
     grouped-by-day listing, search including the regex mode (find the
     exact search implementation it calls — likely a util; port it to
     `onspot-dsp` or a text module with golden fixtures from the TS),
     rename, delete, and the replay metadata lookup.
   - **Search-parity note**: JS `RegExp` vs Rust `regex` — capture tricky
     cases from the TS implementation into fixtures; document any
     intentional differences in an ADR and make the UI unaffected.
6. **Rewire with the toggle** (I7):
   - Settings page and History page read/write through `core-client` when
     `VITE_CORE_BACKEND=core`; legacy TS path stays default until gates
     pass, then flip the default for these two features in the same phase.
   - The Svelte stores keep their public API so components don't change
     (the store becomes a thin adapter over the bridge subscription).
7. **Handoff + docs**: PORTS.md status column, BRIDGE.md command list,
   decisions.md entries (rusqlite choice, batch semantics, regex notes).

## Acceptance gates

- [ ] Fixture v0.2.4 db migrates and passes repository tests on `rusqlite`
      and on the web shim (run the shim suite in a browser context via the
      repo's chosen test runner — if no browser test infra exists, add a
      minimal Playwright or Vitest+happy-dom harness and say so in BRIDGE.md).
- [ ] Golden parity: settings defaults/merge and history search fixtures
      pass in Rust.
- [ ] Manual smoke (web + desktop): change a setting → restart → persists;
      secrets survive restart and are absent from `settings.get` and from a
      whole-db export taken via the legacy path; history lists, searches
      (incl. one regex), renames, deletes, replays.
- [ ] Toggle flip: with `VITE_CORE_BACKEND=core`, settings+history use only
      the bridge (verify: break the legacy path deliberately in a scratch
      build and confirm the screens still work, then revert).
- [ ] All standard gates green (I1) including `cargo test --workspace` with
      the new contract + fixture suites; boundary check green.
- [ ] `bun run tauri build` (or CI desktop job) succeeds; `android.yml`
      unaffected.
- [ ] `.agents/handoff/` updated.

## Out of scope

Attempts/insights/usage *logic* (repos only), export/import, sync, LLM
anything, practice-loop rewiring, deleting `tauri-plugin-sql`.
