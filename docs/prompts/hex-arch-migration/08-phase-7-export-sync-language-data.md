# PHASE 7 — Portability ring: export/import, sync, language data, reminders, onboarding

Standing context: Master Strategy Prompt; P0–P6 merged.

## Mission

Port the features that touch the outside world and the feature gates:
whole-database export/restore and session export, Google Drive + WebDAV
snapshot sync, the language catalog + download planning, practice prompt
catalog, reminders and onboarding state. Network, OAuth and filesystem
access all go through ports.

## Tasks

1. **Export / restore** (`utils/export.ts` ~428 + related):
   - `onspot-app::export`: whole-database export (same `.sqlite`
     byte-compatibility, I3 — restore a fixture export produced by the
     current release in a test) and per-session Markdown export (port the
     document assembly exactly: correct version, tag-stripped
     `speakableExplanation`, follow-up — the handoff decisions.md records
     the exact format from 2026-11-06; golden-test it).
   - Ports: `FileSystemSink` (native: `tauri-plugin-dialog` +
     `tauri-plugin-fs` via thin pass-through commands; web: browser
     download), and restore via file pick. **Secrets exclusion test** is
     mandatory (I3).
2. **Sync** (`adapters/sync/` — `service.ts`, `http.ts`, `webdav.ts` ~429,
   `google/{oauth.ts ~424, drive.ts}`):
   - Port the *policy* to `onspot-app::sync`: snapshot comparison, diff
     decisions, the "never replaces a device without asking" conflict model
     (the README's promise — encode it as typed outcomes:
     `UpToDate`, `LocalAhead`, `RemoteAhead`, `Diverged { details }`), and
     the manual-sync UX contract.
   - Adapters: `sync-webdav` (HTTP via `HttpClient`), `sync-drive` (Drive
     REST via `HttpClient`; app-private folder semantics preserved). OAuth:
     `OAuthBroker` port — desktop keeps the existing `src-tauri/src/oauth.rs`
     loopback flow (reuse it from Rust directly, no new IPC), web uses the
     existing browser redirect flow via host shim. `VITE_GOOGLE_CLIENT_ID_*`
     config plumbing moves into `CoreConfig`.
   - Goldens: diff/conflict decisions on synthetic snapshot pairs. Manual
     smoke: a real WebDAV round-trip (local server is acceptable) on web +
     desktop; Drive smoke optional if credentials are unavailable — record
     what was tested in the handoff.
3. **Language catalog + download planning** (`languages/index.ts` ~582,
   `stores/languageData.ts` ~400, `stores/processing.ts` consumers):
   - Port the catalog as static data in the core (keep the JSON/struct
     layout as close to the TS as practical; a build test asserts the Rust
     catalog matches a checked-in JSON export of the TS catalog).
   - Port planning logic: what is missing, total download size, what runs
     where (STT/TTS local vs cloud), per-language download orchestration via
     `BlobStore` + progress events (`download_progress` — the UI bars
     already consume this shape).
   - Move `lib/practice/prompts.ts` here per ADR-005 (it is language data).
4. **Reminders + onboarding**: port `stores/reminders.ts` decision logic
   (schedules, due state) with a `NotificationScheduler` port (host shim on
   web: Notifications API; desktop: keep the current mechanism — verify what
   it uses today and reuse). Port `lib/onboarding.ts` state machine. Text
   size and theme stay view-layer (Svelte), untouched.
5. **Rewire** (I7): Settings' Data/Sync/Reminders/Setup sections and the
   welcome/onboarding flow switch behind the toggle; flip defaults after
   gates. `platform/{pwa,notifications,backButton}.ts` stay driver-side.

## Acceptance gates

- [ ] Export goldens pass; a release-built export restores in core and
      vice versa; secrets never present in exports (automated test).
- [ ] Sync goldens pass; WebDAV round-trip smoke recorded; conflict flow
      verified manually (force divergence with two fixture dbs).
- [ ] Language planner parity: same "missing/size/what-leaves-device"
      answers as legacy on the fixture db; download progress events reach
      the existing UI bars unchanged.
- [ ] Manual smoke (web + desktop, `core` backend): export → wipe → restore
      → practice history intact; sync setup; reminder fires (or schedules);
      onboarding completes for a fresh db.
- [ ] All I1 gates green; `android.yml` + `release.yml` still valid (oauth/
      fs plugins untouched); `.agents/handoff/` updated.

## Out of scope

Any new sync features, iOS-native work, changing client IDs or scopes,
Rune.
