# Last Session

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
