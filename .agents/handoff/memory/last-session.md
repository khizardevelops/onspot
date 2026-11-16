# Last Session

## 2026-11-16 (later): merged to main, first CI and release runs

- Pushed over SSH (`git@github.com:khizardevelops/onspot.git`; the HTTPS remote cannot prompt
  here), fast-forwarded `main`, tagged previews. First real CI runs surfaced five issues, all fixed:
  release bundles path (`target/`), architecture CI (coupling audit on tracked files, wasm build,
  DB fixture), GitHub Pages prerender of `/about/`, and a fresh-install crash from the plugin-sql
  removal (config folder never created). A macOS Intel job failed once on corrupted `bun install`
  downloads and passed on re-run.
- Result: `v0.2.4-rust.3` pre-release with 15 installers; `main` green; live web app on the core.
- Learned: the desktop checks and phone test reused existing app data, so they could not catch a
  first-run failure; the AppImage smoke test (fresh profile) did. Keep a fresh-profile run in mind
  for any change to startup or storage.

## 2026-11-16: migration completed after an independent review

- **Review first.** Verified the agents' claims (tests/clippy/check all green) and found what they
  missed: core LLM calls uncounted and unpaced (fresh client per request), dropped temperatures/JSON
  mode/token budgets, no long-take splitting, the pacing notice gone, a local LLM server sent the
  custom provider's key, desktop opening `onspot.db` twice, `native-stt` unused, `golden:capture`
  broken, unmuted test browsers, dev harnesses in the product layout, and a **sync data-loss path**
  (the "device changed" revision was only bumped by TS writes).
- **Fixed, in three commits:** `a8ad303` (P8 as the agents left it), `71dd15c` (ledger + pacing +
  client parity, ADR-011), `8b895e3` (one database connection, core-owned revision, enrichment and
  prompt seeding in the core, `native-stt` removed, ADR-012/013), then this closeout (allowlists,
  docs, handoff). Details in `state.md` and `bugs.md`.
- **Verification:** 308 Rust tests; all four browser checks (practice now asserts the ledger); both
  desktop checks against a fresh release build; boundaries/SPDX/coupling/endpoint parity; golden
  capture reproduces every fixture.
- **Phone test (after the learner reconnected it):** Samsung SM-S721B, Android 17. The arm64 debug
  APK installs as `app.onspot.desktop.debug` (`adb install -r --user 0`; the shell cannot reach the
  phone's other user profiles). Android WebViews expose no browser-level CDP endpoint, so drive
  the page socket directly (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`,
  then `Runtime.evaluate` on `/json`'s `webSocketDebuggerUrl`). 24/24 checks passed, including real
  Groq calls (prompt topic, translation, glosses) with the key the debug app already stored; the
  Usage screen showed the core's LLM tokens and Groq's live headers. Observation: the connection
  test returns an empty reply with GPT-OSS at its 16-token budget (reasoning uses it up); the TS
  client had the same budget, so this is unchanged behaviour, and the UI already says "Connected,
  but the model returned an empty reply."
- **Disk:** `/mnt/data` filled to 100% once (target/ grew to 44 GB). Cleared `target/debug`
  (regenerable); the Android cache lives in `/mnt/data/not_synced/dev-cache/onspot-target`.
- **Maintainer's decision kept:** legacy TS is archived under `deprecated/`, never deleted.

## 2026-11-16: P8 acceptance gates actually closed

- **Audit against `09-phase-8-cli-cutover.md`.** The 2026-11-15 pass was "structurally green" but
  four acceptance boxes were still unticked. This session closed the two that could be closed on
  this host and documented the rest with evidence.
- **Cross-driver golden test (gate 1).** `drivers/cli/tests/cross_driver_endpoint.rs` builds the
  endpoint the GUI practice path would send and the endpoint `onspot_cli::evaluation::build_request`
  sends, from the same `AppSettings`: groq Automatic, custom local server, and ja/fa (the
  less-resourced language must decide). Also pins the wire key set (`baseUrl/fallbackModels/model/
  provider`). To make the GUI side real, the CLI's `build_request` no longer carries its own
  base-URL/Automatic-model duplication; it calls `providers::resolve_endpoint`. `EndpointSettings`
  now takes the target and instruction language ids and computes the level, so GUI and CLI cannot
  differ on "high vs medium".
- **Fresh-clone bug found and fixed (gate 4).** `crates/adapters/repo-sql/tests/fixtures/
  onspot-v0.2.4.sqlite` is gitignored (`*.sqlite`) but the migration/snapshot/repository tests
  hard-require it. A clean `git clone` therefore failed `cargo test` with `fixture copy: No such
  file`. Fix: `tests/fixtures/ensure.rs` (included by the three test binaries) rebuilds the binary
  from the tracked `v9.sql` with rusqlite, using a lock file + atomic rename so parallel test
  binaries do not race; `rusqlite` is now a dev-dependency of the adapter. `scripts/make-fixture.sh` is
  not needed manually. Verified: logical `.dump` of the rebuilt file matches `sqlite3 < v9.sql`
  byte-for-content, and a clean clone with no `.sqlite` passes all four repo-sql binaries.
- **Android actually built and run (gate 4).** Installed rustup + `aarch64`/`x86_64` Android
  targets locally (distro rustc could not add them), used the machine's JDK 21 and NDK 28.2,
  built the **x86_64 debug APK** and installed it on the `dev_api36` emulator. The activity
  resumed, WebView devtools showed `http://tauri.localhost/welcome/` "Set up onspot", and the DOM
  had 16 stylesheets / 9 buttons — the real Svelte UI, not a blank or error page. (arm64 release
  APK left to CI: same pipeline, no local arm64 device.)
- **Desktop installer built and smoked (gate 4).** Release build produced `.deb` (32M) and
  `.rpm` (32M) plus a 42M binary; the binary launches under Xvfb and stays running (only a benign
  GTK titlebar warning). **AppImage did not build locally**: `linuxdeploy` fails on CachyOS/Arch;
  `.github/workflows/release.yml` builds it on Ubuntu, so this is a host limitation, not a
  regression — recorded rather than papered over.
- **Fresh-clone checks.** `bun install --frozen-lockfile` and `bun run build` succeed in a
  clean clone. Full `cargo test --workspace` in the clone compiled every crate and then hit the
  112 GB filesystem limit at the final link (35 GB debug target); the repo-tree run is the
  evidence there: **281 passed, 0 failed**.
- **Version left alone.** I bumped to 0.2.5 and drafted `docs/releases/v0.2.5.md`, then the
  maintainer said they do the version by hand. Both are reverted; `package.json`,
  `tauri.conf.json` and `src-tauri/Cargo.toml` are 0.2.4 again and no release-notes file is
  staged. No tag was pushed.
- **Gates 3/5 (boundaries, release) remain as before:** TS rules error-level and green, Rust
  boundary green, coupling `--check` current (308 files) with the P0-vs-final table in
  `coupling-matrix.md`; the UI is not yet wired to the Rust endpoint resolver because the web
  driver needs the BYOK key synchronously — `stores/llm.ts` is documented as the permanent
  `SecretStore` adapter and the cross-driver test pins its rule to Rust (see `decisions.md`).
- **Not verified here:** Windows/macOS runtime, real arm64 phone, live Groq/DeepSeek keys,
  real Google Drive, AppImage locally. No secrets were read or written; `.mntsyncd/` untouched.
- **Commit:** not made (the maintainer did not ask). Working tree on
  `refactor/hex-arch-p0` at `9a08523` + these uncommitted changes.

## 2026-11-16: live Groq, arm64 APK, endpoint parity

- **Endpoint policy is now one rule with two callers and a shared golden.**
  `providers::resolve_endpoint` takes the target/instruction language ids and computes the
  Automatic-model level itself (it used to trust a precomputed level, which hid a GUI/CLI
  divergence). `stores/llm.ts` now delegates URL/model choice to
  `providers.ts::resolveLlmEndpointPolicy` and only adds the BYOK key. New
  `scripts/check-endpoint-parity.mjs` (`bun run endpoint:capture|check`) writes/replays
  `crates/onspot-app/tests/fixtures/request-endpoints.json`; the Rust test `endpoint_fixture`
  replays the same cases through `resolve_endpoint`. It immediately caught a real bug: the
  hand-rolled TS copy read `llmModel` for the custom provider instead of `customModel`, so the
  web driver and the core disagreed on the custom endpoint. Fixed; both sides now pass on all six
  cases (groq Automatic, fa instruction, pinned model, deepseek, custom, local server). The check
  is in `architecture.yml`.
- **Live Groq verified (real key, never logged or committed).** `onspot-cli evaluate` on
  "Bonjour je vais au marche ce matin" hit `openai/gpt-oss-120b`, HTTP 200, and the Rust parser
  returned a valid `EvaluationResult`. The exact prompt-topic body the Rust core renders was
  posted to Groq (`200`, finish `stop`, content), and the Rust `parse_prompt_topic` /
  `validate_prompt_topic` accepted the model's reply as a `GeneratedPrompt`. Both live checks ran
  from throwaway test files that were deleted afterward, so CI never calls the network.
- **Android arm64 release APK built:** `--apk --target aarch64`, 52 MB, arm64-v8a only,
  `zipalign -c` passes delim, signed with the release keystore (APK Signature Scheme v2 finalize,
  `CN=onspot`). This is the artifact `android.yml` publishes. The x86_64 debug APK was already
  installed and rendered the Svelte UI in the `dev_api36` emulator.
- **AppImage left to CI** (decided with the maintainer). Local bundling fails because linuxdeploy's
  GTK plugin resolves `/usr/lib/openshot/libgobject-2.0.so.0` (an unrelated app's copy) and that
  needs `libffi.so.7`; this host has `libffi.so.8`. It is a CachyOS filesystem collision, not a
  packaging defect — `release.yml` builds the AppImage on Ubuntu. `.deb` and `.rpm` build and the
  release binary runs under Xvfb here.
- **Google Drive left to the user** (decided): the in-memory WebDAV round-trip already proves the
  sync protocol; a real Drive test needs an OAuth client + account and stays out of CI.
- **Verified after these changes:** workspace fmt/clippy/test **282 passed**, `check` 0 errors,
  `build`, `bridge:wasm`, `test:practice`, `test:storage`, boundaries, SPDX 423, catalog/provider
  and the new `endpoint:check`, coupling current. No key, token or account id is in the tree.

## 2026-11-15: Rust/TS parity follow-up

- **Prompt generation moved into Rust.** Added `llm-openai::prompt_topic` and a `PromptSource`
  implementation in the bridge over the LLM adapter, so evaluation and prompt writing share the
  same transport, pacing, JSON repair and cancellation. The core renders/validates the title and
  task, caps title/text/word length, checks the instruction language's scripts from the exported
  language catalog, and refuses recent topics. Host `prompt.write` and the unused
  `evaluation.evaluate` case are gone. `PracticeConfig.llmConfigured` (driver-computed)
  stops a doomed request when no key is configured and still falls back to catalogue prompts.
- **Language catalog carries `scripts`** (fr Latin, ja Han/Hiragana/Katakana, fa Arabic, ...), so
  `couldBeWrittenIn` is now Rust (`onspot-dsp::text_language`) with tests for wrong scripts,
  Urdu-only letters, Ukrainian/Russian markers and kana-free Japanese.
- **Legacy JSON import moved into Rust.** `onspot-app::legacy_import` is a merge-only port of
  `importLegacyJsonBackup`, invoked as `restore.legacy_json`; it keeps unrelated rows, imports
  sessions/prompts/attempts/corrections/recordings and `onspot.setting.*`, skips orphans and bad
  enums, and accepts sessions without setup. Tests cover the merge counts/flags and a
  foreign/unreadable file. The TS function now reads the file, calls the command, and only
  reloads settings when one was imported. A bridge-level dispatch test also proves
  `restore.legacy_json` reaches the repositories through the real command table.
- **Dead TS archived:** `evaluate.ts`, `prompt.ts`, `languageGuidance.ts`, `promptTopic.ts` are
  under mirrored `deprecated/`; `capture-golden.mjs` imports them from there so fixture
  regeneration still works. `jsonRepair.ts`/`pacing.ts` stay live because `client.ts` still uses
  them for model listing and the connection test.
- **Prompt-submission outbox moved.** `onspot-app::prompt_submissions` owns the batch size (20),
  oldest-first due order, the 30 s → 1 h exponential backoff and the `{consent, prompts}` wire body;
  bridge `prompts.flush_submissions` runs it over `RecordsStore` + `HttpClient` + `Clock`.
  `practice/promptSubmissions.ts` now only decides *when* to ask (start, online, visible) and maps
  the result count, keeping consent/connection checks driver-side.
- **Session setup moved.** `onspot-app::session_setup` ports `setup_from_settings`,
  `same_setup`, `parse_session_setup` (language/pace validation), `usable_setup` (voice repair,
  cloud-only read-back) and `infer_session_setup` (voice language, script guesses, translation
  language). Bridge `sessions.infer_setup` / `sessions.parse_setup` / `sessions.usable_setup`.
  `inferSessionSetup` is now async in the TS store; `languages/textLanguage.ts` is archived, so
  `couldBeWrittenIn` exists only in Rust.
- **LLM endpoint policy now exists in Rust too.** `providers::resolve_endpoint` / `models_for` /
  `is_configured` / `provider_id_for` own Automatic-model choice, local-server mode and the
  cloud-key gate (`EndpointSettings` + `ResolvedEndpoint`), with tests. Not yet wired into the UI:
  `stores/llm.ts` still resolves synchronously from the settings view + secret store, and the key
  never crosses into the core. The CLI now calls it; the web driver keeps its synchronous copy only for the BYOK key (see the 2026-11-16 entry).
- **P5 completion:** added `the_fixture_translations_and_glosses_interoperate_with_the_core`
  to repo-sql tests: reads `a-1`'s stored v3 English translation, sees null glosses, rewrites
  glosses through the core store, and checks the persisted JSON shape.
- **Verified:** check 0 errors/9 warnings; build; `test:storage`, `test:practice`, `test:sync`,
  `test:portability`; boundaries; SPDX 418; catalogs/providers; coupling 307 files current;
  workspace fmt/clippy/test (277 passing); bridge types 53; wasm rebuilt. Practice initially caught
  a real regression: with no key the core still asked Groq and the check saw a 401, fixed by
  `llmConfigured` plus catalogue fallback.
- **Left:** direct `adapters/db` view shims and the device-local usage ledger *persistence* remain
  (documented as storage adapters); packaging and commit still open.

## 2026-11-15: P8 closeout verification

- **Sync pruning finished:** `SyncProvider` now only carries `id`/`label`/`getAccount`/`connect`/
  `disconnect`; WebDAV and Drive are account providers, while whole-database transfer stays in
  Rust `sync.now`. Removed `getRemote`/`download`/`upload` from the interface and confirmed the
  live `sync/http.ts` is only the OAuth host transport.
- **Archive cleanup:** archived the pre-edit `utils/export.ts` (449 lines, including the removed
  Tauri wrappers) at `deprecated/src/lib/utils/export.ts` so no TypeScript was deleted outright.
  `sessionTranscript.ts` uses `platform/saveDocument.ts`; dead sync decisions stay removed.
- **Docs:** refreshed handoff `commands.md` (toggle references removed, CLI driver section added)
  and corrected `state.md`/`tasks.md` to the actual remaining work.
- **Verified:** svelte-check 0 errors/9 warnings, production build, storage/practice/sync/
  portability browser checks, boundaries, SPDX 412, catalog/provider checks, coupling regenerated
  and current, and offline workspace fmt/clippy/test.
- **Left:** final packaging gates (fresh clone, desktop installer, Android APK, release tag) and
  the P8 commit. Android/live-key/Drive/device smokes are still blocked; P5 gloss fixture remains.

## 2026-11-14: P0-P7 audit before P8

- **Verdict:** P0-P7 are behaviourally green, but P7 is not fully closed against its own deferred
  promises. Do not start P8 cutover yet.
- **Found:** `c11ca8c` shipped a stale coupling matrix (`--check` failed); regenerated it, so the
  architecture job is green again. ADR-008's typed `AppSettings` defaults/merge/normalise still
  live in `stores/settings.ts` (520 lines) and ADR-010's provider/model catalog + automatic-model
  policy still live in `adapters/llm/providers.ts` (167 lines). P8 deletes both. P5's phrase task
  was stale; its real gap is a legacy-written gloss/translation fixture assertion. Gloss job
  coalescing is still driver-side in `stores/practice.ts` (unrecorded deviation, behaviour fine).
- **Docs fixed:** PORTS.md statuses for HttpClient/OAuthBroker/BlobStore/NotificationScheduler/
  Settings and the provider-catalog note; BRIDGE.md command names (`usage.snapshot`,
  `insights.build`, `sync.connect/account/disconnect/now`), `usage_warning` implemented, removed
  the nonexistent `sync_changed` row and duplicate `error` row.
- **Verified now:** `test:storage`, `test:sync`, `check` (0 errors), boundaries (0 warnings), SPDX
  (383), catalog, typegen (no diff), coupling `--check`. Earlier session already ran workspace
  tests/clippy/fmt and all P7 desktop/browser smokes.
- **Blocked:** Android (SDK/NDK present, no rustup Android targets), live keys, real downloads,
  Drive, physical devices.

## 2026-11-14: P7 desktop sync smoke unblocked; driver host centralized

- **Real bug found and fixed:** `getCoreClient` did not install the driver host. Only
  `stores/practice.ts` wired `createCoreHost` and answered `host_request`, so sync, database
  export/restore and language downloads hung on any screen that had not booted Practice (for
  example a fresh install opening Settings → Sync). `core-client/client.ts` now creates one host
  per core client, subscribes to `host_request`, replies through `core.host_reply`, and exports
  `getCoreHost()`; the practice store uses that shared host instead of installing its own.
- **Desktop boot:** the Tauri/Android layout now boots `getCoreClient()` at startup (web stays
  lazy), so the host answers before the first feature screen and raw bridge use.
- **Desktop smoke:** `bun run test:sync:desktop` now passes. Fixed the script's `mkdtempSync`
  misuse (it created random dirs instead of `config`/`data`/`cache`), the missing
  `config/app.onspot.desktop` directory (the app panicked opening `onspot.db`), the driver flag
  form (`--port=` not `--port N`), the W3C script timeout, `core.ping`'s `appVersion` field, error
  serialization, and the foreign-remote message match. It also waits for the first app screen so
  settings hydration (and the host install) has finished. Result: connect, native export, upload,
  no-op, conflict, rusqlite restore, foreign remote refused.
- **Portability/first-run check:** new `bun run test:portability` writes a session, exports
  through `export.database` (captured browser download), closes the context (a real wipe), and
  restores in a fresh context through `restore.pick`/`restore.confirm` (file chooser), then reads
  history and session Markdown back through the core. It also skips the fresh-database setup guide
  and proves the redirect stops, and makes a reminder due and proves a system notification is
  constructed.
- **Diverged conflict:** `test:sync` now writes a local session after the untouched upload and
  rewrites the remote, so both sides changed; the explicit download discards the local edit.
- **Desktop Restore button fixed:** the default Tauri capability granted `dialog:allow-save` but
  not `dialog:allow-open`, so the restore picker was rejected and the button appeared dead. Added
  `dialog:allow-open`; the dialog's dynamic scope then satisfies `fs:allow-read-file` for the
  chosen path. New `bun run test:portability:desktop` drives the release app under Xvfb, clicks the
  real Settings → Data buttons, answers the GTK Save/Open dialogs with xdotool (a bare Xvfb has no
  WM, so `windowfocus` is required, not `windowactivate`), confirms the replace, and proves a
  setting written before export and changed before restore comes back.
- **Asset-level language planning:** `voiceAssets`/`voiceModelUrl` moved into
  `languages/voices.ts` (`assets.ts` deleted), the exported catalog now carries each voice's asset
  list, and `plan_language_data` sums it, counts shared URLs once (Supertonic model, Japanese
  dictionary) and keeps `transfer` distinct from `storage` for the compressed Japanese G2P. Added
  `catalog:export`/`catalog:check` so the checked-in JSON cannot drift from the TypeScript
  registry. Rebuilt the wasm bridge and the desktop binary for the catalog change.
- **Planner partial-cache parity:** `LanguagePlanInput` now takes `cachedAssets` (the URLs the
  driver's cache check found); `missing_assets` skips cached URLs as well as URLs an earlier part
  already counted. The driver passes them from `voiceCacheState`, so switching to a shared-model
  Supertonic style no longer re-prices a model that is already on disk. Rust unit test added;
  regenerated bindings/wasm and rebuilt the desktop binary.
- **Committed:** P7 is `c11ca8c` (`P7: port export, sync and language-data features to the core`).
- **Verified:** `bun run test:sync`, `bun run test:sync:desktop`, `bun run test:portability`,
  `bun run test:portability:desktop`, `bun run test:practice`, `bun run test:storage`,
  `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`, svelte-check 0 errors,
  `bun run build`, `bun run bridge:types`, `bun run catalog:check`, boundaries, SPDX.
- **Not done:** the Drive smoke (needs real Google credentials; explicitly skipped). The desktop
  checks rebuild the release binary, so run `bunx tauri build --no-bundle` after frontend,
  capability or Rust changes.

## 2026-11-13: P7 sync adapters, bridge and browser smoke

- **Built:** `onspot-ports::sync` (`RemoteSnapshot`, `SyncAccount`, `SyncProvider` native/wasm,
  `OAuthBroker`, `SyncStore`); binary `HttpClient::send_bytes`; `onspot-app::sync::run_sync`;
  full `sync-webdav` and `sync-drive` adapters; bridge `sync.connect/account/disconnect/now` with
  `http.sync`, `oauth.*` host shims and a `RecordsStore`-backed `SyncStore`; TS
  `core-client/sync.ts` commands; `syncNow` plus WebDAV/Drive connect/disconnect branch on
  `useCore('sync')`.
- **Goldens:** `crates/onspot-app/tests/golden/syncDecisions.json` (9 synthetic snapshot pairs,
  including both explicit choices) read by `tests/sync_golden.rs`.
- **Smoke:** new `bun run test:sync` starts an in-memory WebDAV server with CORS, boots the wasm
  bridge in Chrome and drives the app's own service: connect, upload, no-op, touched remote →
  needs-choice, explicit download restores, corrupt remote rejected with the database intact.
  Rebuilt `static/core-bridge` first (wasm-bindgen 0.2.130 present).
- **Verified:** `cargo test --workspace`, clippy on the touched crates, `cargo fmt`, svelte-check 0
  errors, production build, boundaries, SPDX, and the new sync browser check.
- **Not run:** desktop WebDAV round-trip and the manual export/restore/reminder/onboarding
  walks (no display here); Drive smoke (no Google credentials). P7 source changes are uncommitted.

## 2026-11-12 (latest): P7 whole-database backup/restore

- **Built:** `FileSystemSink` + `DatabaseFile` ports; `onspot-app::portability` export/restore
  use cases with format checks and a staged two-step restore; bridge `export.database` and
  `restore.pick/confirm/cancel` over base64 host calls; native rusqlite `VACUUM INTO` export and
  online-backup import with migration; Svelte Data settings switched to the core path.
- **Fixed/verified:** 8 portability tests (secrets boundary, foreign files, staging), 3 snapshot
  tests including the v0.2.4 schema-9 fixture restoring to schema 12 and a core-to-core round
  trip, workspace tests/clippy, svelte-check 0 errors, production build, boundaries, SPDX.
- **Wasm fixed:** the distro Rust has no wasm target and no rustup, but `rust-src` is installed;
  `scripts/bridge-wasm.sh` now falls back to `RUSTC_BOOTSTRAP=1 ... -Z build-std=std,panic_abort`.
  Downloaded the matching prebuilt `wasm-bindgen` 0.2.130 CLI and rebuilt `static/core-bridge`.
- **Browser gates:** `bun run test:storage` and `bun run test:practice` pass against the new wasm.
- **Language data:** added `LanguageDataInstaller`, the core `RunLanguageDownload` sequence and
  the `download_progress` event; the driver fetches through `language.download_stt/voice` and
  reports via `language.download_progress`, Cancel through `language.cancel`. The store now takes
  pending/readiness from `language.plan`, and byte fields are `u32` to avoid JS `bigint`.
- **Not done:** browser/desktop export-restore manual smokes (the native snapshot tests cover the
  format path); WebDAV/Drive ports and the Sync UI rewire.
- **Disk:** removed stale `src-tauri/target` (14 GB) and `target/debug/incremental` after
  `/mnt/data` hit 100%.

## 2026-11-12: P7 foundations

- **Built:** core session Markdown export + bridge/UI route; backup guards; sync policy +
  `sync.decide`; language catalog and prompt catalogue as checked-in JSON + Rust lookup/seeding;
  pure reminder/onboarding helpers and the core reminder route.
- **Fixed:** chrono `wasmbind` for wasm clocks; the export command hung without it. Rebuilt wasm.
- **Verified:** workspace tests/clippy, svelte-check 0 errors, build, boundaries, SPDX, and
  `test:practice` (export + sync commands on the persisted take).
- **Not done:** whole-database export/restore API/FileSystemSink, sync adapters/conflict smoke,
  language planner/download events, core reminder/onboarding wiring, UI section rewires, desktop
  and export/restore manual smokes.
- **Disk:** removed 6.5 GB incremental build after `/mnt/data` hit 100%.



## 2026-11-14: P7 closeout — typed settings and provider catalog

- **Built:** `onspot-app::settings` (`AppSettings`, `VoiceTuning`, defaults/merge/normalise,
  Automatic-model migration, `load_document`/`patch_document`) and `onspot-app::providers`
  (catalog + policy over generated `assets/providers.json`); bridge `settings.load`/`settings.patch`;
  TS store delegates under `useCore('settings')`; generated ts-rs types; provider export/check
  scripts + CI step; compile-time store/core document coverage guard.
- **Verified:** `cargo test --workspace` (108 app tests), clippy `-D warnings`, `cargo fmt --check`,
  svelte-check 0 errors/9 warnings, `test:storage` (now includes load/patch round trip),
  `test:practice`, `test:sync`, `test:portability`, boundaries, SPDX (385), catalog/providers checks,
  coupling `--check`, wasm rebuild.
- **Not done:** commit; P5 gloss fixture assertion; Android/live-key/Drive/device smokes. P8 can
  start once the user confirms the closeout.

## 2026-11-14: P8 cutover — CLI, practice/settings collapse, boundary rules

- **CLI:** `drivers/cli` is complete for the phase's command set with 7 integration tests. It uses a
  manual parser (crates.io is unreachable and `clap`/`tracing-subscriber` are not cached), `libc`
  SIGINT → global `CancelToken`, env then keyfile secrets, and `reqwest::blocking` over rustls.
- **Cutover:** removed `VITE_CORE_BACKEND`; `stores/practice.ts` now always runs the core and lost
  its legacy recorder/transcriber/evaluator/prompt/persistence bodies (~900 lines removed).
  `stores/settings.ts` no longer has the `coreStorageBroken` fallback or legacy defaults/merge/
  normalisation; `initSettings()` is one `settings.load`, writes are one `settings.patch`.
  Pre-cutover TS is under `deprecated/` (mirrored paths, SPDX kept).
- **Boundaries:** `scripts/check-boundaries.mjs` now rejects live imports of `deprecated/`, limits
  `svelte/store` to view-state stores/host shims, and limits `@tauri-apps/*`/`plugin:speech` to the
  transport/platform/adapter shims. Error-level and green.
- **Archived after the collapse:** `adapters/llm/translate.ts`, `glossary.ts`, `translationPrompt.ts`
  and `lib/insights.ts` moved to `deprecated/`; pure gloss-intent helpers live in
  `components/transcriptGlosses.ts`; `/insights/` uses generated core types and `bigint` counts.
- **Verified:** `bun run check` 0 errors/9 warnings; `bun run build`; `test:storage`, `test:practice`,
  `test:sync`, `test:portability`; `lint:boundaries`; `spdx:check` (410 files); coupling `--check`.
  Rust CLI/workspace gates had passed earlier in the phase.
- **Not done:** remaining dead-TS audit/archive (`adapters/db` business methods still used by
  export/reminders/prompt submissions/read-back, `adapters/sync` send logic,
  `usage/ledger` + `usage/coreMonitor` host accounting, `utils/export.ts` legacy JSON import,
  `sessionTranscript.ts` Tauri save shim), fresh-clone/desktop/Android gates, release tag reused
  commit. P5 gloss fixture, live-key/Drive/device smokes still unavailable.
