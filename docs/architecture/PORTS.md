# Port catalog

Verified against the working tree on 2026-11-12 (P0). "Today" is the
implementation a first adapter wraps; "First Rust adapter" is the phase that
introduces it. The trait names are proposals until the phase declares them in
`onspot-ports`; a wider surface needs an ADR.

Every port is `async` and object-safe, takes a `CancelToken` for cancellable
work, uses domain types (never driver types) and returns `CoreError` with a
stable code (see `BRIDGE.md`).

## Outward capabilities

| Port | Today (verified) | Size | First Rust adapter | Web host adapter | Notes |
|---|---|---|---|---|---|
| `LlmProvider` / `HttpClient` | `adapters/llm/client.ts` + `providers.ts` | 379 + 167 | `llm-openai` (P4 **implemented**); provider catalog in `onspot-app` (P7 closeout) | host `fetch` / Tauri HTTP plugin | Groq, DeepSeek, OpenAI-compatible, local servers. The core builds prompts, repairs/parses JSON and paces a token bucket; the host adds the API key and performs HTTP (ADR-010). P3's evaluation host shim is retired, and P8 also moved prompt-topic writing here (`prompt_topic.rs`), so the core calls the model directly instead of the retired `prompt.write` host shim. The provider/model catalog, Automatic-model policy and `isChatModel`/label/name helpers now live in `crates/onspot-app/src/providers.rs`; `assets/providers.json` is generated from the TypeScript registry and checked in CI. `providers.ts` remains the Settings view catalog. DeepSeek balance stays driver-side (P6). |
| `SttEngine` | `speech/stt/service.ts`, `localEngine.ts`, `transformers/`, `cloud/`, native plugin | ~2,000 | host shim on every runtime; desktop/Android run whisper.cpp in Rust inside `tauri-plugin-speech` (ADR-013) | Transformers.js worker, permanent | **P3 declared** (`practice.rs`). Groq call is a `SttEngine` adapter too (P4 shares the HTTP client). |
| `TtsEngine` | `speech/tts/service.ts`, `local/`, `piper/`, `supertonic/`, `cloud/` | ~4,500 | — (ports first; native voices are a later decision) | Piper/Supertonic worker, permanent; cloud TTS uses `HttpClient` | **P3 declared.** Clip loudness leveling stays in the worker/host: it is asset processing, not policy. |
| `AudioCapture` | `utils/recorder.ts` | 361 | — | `getUserMedia` shim, permanent | **P3 declared.** Web Audio is the only implementation on every runtime; Tauri uses the webview. |
| `AudioPlayback` | `speech/tts/streamingPlayback.ts`, `stores/audio.ts`, `utils/audioEffects.ts` | 341 + | — | Web Audio shim, permanent | **P3 declared.** Playback state becomes events; EQ stays a view/host concern. |
| `SqlDriver` | `adapters/db/*Adapter.ts` (archived) | — | `repo-sql` over `rusqlite`, the only connection on desktop/Android (ADR-012) | sqlite-wasm worker (`browserDatabase.ts`), permanent; the core migrates at boot and after a host import | Schema text and migration chain moved verbatim. ADR-007 records the JS-promise host and per-target `Send` split. |
| `SecretStore` | `stores/secrets.ts` → `core-client/secrets.ts` | 57 | driver-side host store, **not** a Rust port (P2) | `localStorage`, permanent | Keys never enter SQLite, settings, exports or fixtures (I3); ADR-007 explains why no bridge command. |
| `HttpClient` | `adapters/sync/http.ts`, direct `fetch` | 136 | host fetch / Tauri HTTP plugin (P7 **implemented**) | `fetch` shim | One place decides CORS vs Tauri HTTP plugin vs native. No `reqwest` in the workspace. |
| `OAuthBroker` | `adapters/sync/google/oauth.ts` + `src-tauri/src/oauth.rs` | 424 + Rust | driver loopback + web shim (P7 **implemented**) | Google Identity Services shim | Loopback capture and token exchange stay driver-side; the core sees only access tokens through the port. |
| `BlobStore` | OPFS paths, `tauri-plugin-fs`, model cache | ~300 | host fetch/cache (P7 **implemented** through `LanguageDataInstaller`) | OPFS shim, permanent | Covers recordings, cached clips and downloaded models. No separate Rust trait. |
| `LanguageDataInstaller` | `stores/languageData.ts` + STT/TTS services | 443 + workers | host worker calls (P7 **implemented**) | Transformers.js / Piper workers, permanent | The core plans, sequences and folds progress; the driver fetches and caches. Progress returns as `language.download_progress`; Cancel reaches the worker through `language.cancel`. |
| `FileSystemSink` / `DatabaseFile` | `utils/export.ts`, `adapters/db/*` | 433 | host dialogs + `repo-sql` backup (P7 **implemented**) | `browser-fs-access` + sqlite-wasm, permanent | Whole-database export/restore. The core owns the file name and pre-restore format checks; bytes cross as base64 host calls. Native import uses SQLite's online backup, so open connections are not pointed at a replaced file. |
| `Clock` | `Date.now` | — | std (P3) | injected | **P3 declared.** Tests never sleep. |
| `IdGen` | `newId()`/`crypto.randomUUID` | — | std/ulid (P2) | injected | Deterministic in fixtures. |
| `NotificationScheduler` | `platform/notifications.ts`, `stores/reminders.ts` | 199 + | driver scheduler (P7 **implemented**); no core trait | Notification API shim, permanent | The core owns due state; the driver schedules and shows. On Apple touch devices the capability is absent by design. |
| `EventSink` | implicit: store mutations and callbacks | — | bridge transports (P1) | JS callback | The only way core state reaches a driver. |
| Repositories `Sessions` | `SqlDatabaseAdapter.ts` | 792 total | `repo-sql` (P2 **done**) | same, over `SqlDriver` | List/rename/delete; attempts by cascade. |
| `Attempts` | same | | `repo-sql` (P2 **done**) | same | Full attempt row plus JSON translations/follow-up/glosses; history previews remain a narrower read. |
| `Prompts` | same + `practice/prompts.ts`, `promptCatalogue.ts` | 1,757 in practice | `repo-sql` (P2 **done**) | same | Catalogue seeding is a use case (P5). |
| `Glosses` | same + `transcriptMeanings.svelte.ts` | 374 | `repo-sql` (P2 **read/write done**) | same | Stored in `attempts.word_glosses`, parsed with the legacy tolerance; UI move is P5. |
| `Translations` | same + `adapters/llm/translate.ts` | 159 | `repo-sql` (P2 **read/write done**) | same | Stored in `attempts.translations`; set version stays as stored. UI move is P5. |
| `Usage` | `usage/ledger.ts` (archived) | 251 | `onspot-app::usage_ledger::UsageLedger` over the `DeviceStore` port (**implemented**, ADR-011) | `device.read`/`device.write` → `localStorage` (`onspot.usage.v1`), permanent | Not a SQL table: the ledger is per-device and never synced. The core records every LLM call itself; driver-side speech engines report through `usage.record_call`/`usage.record_refusal` with a key hash. |
| `DeviceStore` | — | — | port in `onspot-ports::device` (ADR-011) | webview `localStorage`; CLI JSON file | Device-local values that must never enter the database. |
| `Settings` | same + `stores/settings.ts` | 485 | `repo-sql` (P2 rows; P7 closeout typed document) | same | Key/value rows, typed `AppSettings`, defaults, merge and normalisation live in `crates/onspot-app/src/settings.rs`; `settings.load`/`settings.patch` are the bridge commands (ADR-008). The Svelte store is now an optimistic driver view. Secret-prefixed keys never surface. |
| `PromptSubmissions` | same + `practice/promptSubmissions.ts` | 208 | `repo-sql` (P2 **done**) | same | Opt-out; payload stays prompt-only. Sending/backoff stays P5. |

## P2 status (2026-11-12)

- **Implemented:** `SqlDriver`, `HistoryStore`, `SettingsStore` in
  `onspot-ports`; `RusqliteDriver` (native, bundled SQLite), the verbatim
  schema 1–12 chain and its transactional runner, and the settings/history
  stores in `onspot-adapter-repo-sql`. The v9 fixture proves the I3 path on the
  native driver.
- **Web:** the host SQL shim over the existing `sqlite.worker.ts` is wired and
  checked in real Chrome (`bun run test:storage`): migration, settings
  persistence across reload, history list/rename/delete, the secret-leak
  regression, and the checked-in schema-9 fixture opened in an in-memory
  sqlite-wasm host so the Rust runner migrates it to schema 12.
- **Records:** `RecordsStore` covers prompts, full sessions/attempts, the
  gloss/translation JSON columns, corrections, audio, prompt submissions and
  sync metadata, with round-trip and fixture-read tests. `Usage` is not a SQL
  table; its port arrives with the P6 device-local ledger.
- **Settings:** the typed document moved to `crates/onspot-app/src/settings.rs`
  in the P7 closeout. `settings.load` returns the normalised document and the
  rows it was built from; `settings.patch` applies JSON-encoded field changes,
  writes only rows that changed, and returns the normalised document. The
  Svelte store keeps the optimistic UI and secret store; it is no longer a
  cutover blocker. Its tests pin malformed rows, legacy language names,
  cloud-only modes, voice memories, retired voices and the Automatic-model
  migration.

## Ports with no Rust adapter planned

These are deliberately host-side for the web build and are documented as the
web implementation of the port, not as temporary shims: `AudioCapture`,
`AudioPlayback`, the Transformers.js and Piper/Supertonic workers, sqlite-wasm,
`localStorage` secrets, the Notification API and the browser `fetch` path. A
desktop or CLI driver supplies its own implementation of the same trait.

## Rules

1. A port owns one capability. If two adapters need different request shapes,
   the difference belongs in the adapter, not in a wider trait.
2. A port method takes domain types and a cancellation token and returns
   `Result<_, CoreError>`. No `serde_json::Value` in a signature.
3. Adding a method or changing a signature needs an ADR; the bridge's command
   version alone does not pay for widening the port.
4. Every port ships a contract test suite that runs against every adapter that
   exists in that phase: a shim that silently diverges fails CI.
5. Host adapters receive only what the port needs, never the whole app state.

## Verified gaps

- `vite.config.ts` sets COOP `same-origin` / COEP `credentialless` in dev and
  preview, but production (Cloudflare) uses `same-origin-allow-popups` from
  `static/_headers`, so production local WASM is single-threaded. The HTTP host
  shim must not assume `SharedArrayBuffer` exists.
- The browser SQL worker passes a cached `wasmBinary` itself because a
  dedicated worker's XHR is not intercepted offline by the service worker. The
  `SqlDriver` shim keeps that behaviour.
- Model files (Piper 18 MB phonemizer, sherpa-onnx 14 MB, Supertonic 262 MB)
  are gitignored and fetched by scripts; `BlobStore` only manages what is
  already on disk.
