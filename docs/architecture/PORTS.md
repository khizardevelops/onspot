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
| `LlmProvider` / `HttpClient` | `adapters/llm/client.ts` + `providers.ts` | 379 + 167 | `llm-openai` (P4 **implemented**) | host `fetch` / Tauri HTTP plugin | Groq, DeepSeek, OpenAI-compatible, local servers. The core builds prompts, repairs/parses JSON and paces a token bucket; the host adds the API key and performs HTTP (ADR-010). P3's evaluation host shim is retired. Provider catalogs and DeepSeek balance remain driver-side (P6/P7). |
| `SttEngine` | `speech/stt/service.ts`, `localEngine.ts`, `transformers/`, `cloud/`, native plugin | ~2,000 | `native-stt` (P3, desktop/Android) | Transformers.js worker, permanent | **P3 declared** (`practice.rs`). Groq call is a `SttEngine` adapter too (P4 shares the HTTP client). |
| `TtsEngine` | `speech/tts/service.ts`, `local/`, `piper/`, `supertonic/`, `cloud/` | ~4,500 | — (ports first; native voices are a later decision) | Piper/Supertonic worker, permanent; cloud TTS uses `HttpClient` | **P3 declared.** Clip loudness leveling stays in the worker/host: it is asset processing, not policy. |
| `AudioCapture` | `utils/recorder.ts` | 361 | — | `getUserMedia` shim, permanent | **P3 declared.** Web Audio is the only implementation on every runtime; Tauri uses the webview. |
| `AudioPlayback` | `speech/tts/streamingPlayback.ts`, `stores/audio.ts`, `utils/audioEffects.ts` | 341 + | — | Web Audio shim, permanent | **P3 declared.** Playback state becomes events; EQ stays a view/host concern. |
| `SqlDriver` | `adapters/db/{OpfsSqliteAdapter,TauriSqlAdapter,index}.ts` | 108 each | `repo-sql` over `rusqlite` and the wasm host shim (P2 **done**) | sqlite-wasm worker, permanent | Schema text and migration chain move verbatim. ADR-005 pins rusqlite 0.32 to share `libsqlite3-sys` with plugin-sql; ADR-007 records the JS-promise host and per-target `Send` split. |
| `SecretStore` | `stores/secrets.ts` → `core-client/secrets.ts` | 57 | driver-side host store, **not** a Rust port (P2) | `localStorage`, permanent | Keys never enter SQLite, settings, exports or fixtures (I3); ADR-007 explains why no bridge command. |
| `HttpClient` | `adapters/sync/http.ts`, direct `fetch` | 136 | `reqwest` (P7) | `fetch` shim | One place decides CORS vs Tauri HTTP plugin vs native. |
| `OAuthBroker` | `adapters/sync/google/oauth.ts` + `src-tauri/src/oauth.rs` | 424 + Rust | reuse loopback (P7) | Google Identity Services shim | Loopback capture already exists in Rust; the token exchange policy moves. |
| `BlobStore` | OPFS paths, `tauri-plugin-fs`, model cache | ~300 | `tauri-plugin-fs` (P7) | OPFS shim, permanent | Covers recordings, cached clips and downloaded models. |
| `Clock` | `Date.now` | — | std (P3) | injected | **P3 declared.** Tests never sleep. |
| `IdGen` | `newId()`/`crypto.randomUUID` | — | std/ulid (P2) | injected | Deterministic in fixtures. |
| `NotificationScheduler` | `platform/notifications.ts`, `stores/reminders.ts` | 199 + | Tauri notification (P7) | Notification API shim, permanent | On Apple touch devices the capability is absent by design. |
| `EventSink` | implicit: store mutations and callbacks | — | bridge transports (P1) | JS callback | The only way core state reaches a driver. |
| Repositories `Sessions` | `SqlDatabaseAdapter.ts` | 792 total | `repo-sql` (P2 **done**) | same, over `SqlDriver` | List/rename/delete; attempts by cascade. |
| `Attempts` | same | | `repo-sql` (P2 **done**) | same | Full attempt row plus JSON translations/follow-up/glosses; history previews remain a narrower read. |
| `Prompts` | same + `practice/prompts.ts`, `promptCatalogue.ts` | 1,757 in practice | `repo-sql` (P2 **done**) | same | Catalogue seeding is a use case (P5). |
| `Glosses` | same + `transcriptMeanings.svelte.ts` | 374 | `repo-sql` (P2 **read/write done**) | same | Stored in `attempts.word_glosses`, parsed with the legacy tolerance; UI move is P5. |
| `Translations` | same + `adapters/llm/translate.ts` | 159 | `repo-sql` (P2 **read/write done**) | same | Stored in `attempts.translations`; set version stays as stored. UI move is P5. |
| `Usage` | same + `usage/ledger.ts` | 251 | device-local store (P6) | `localStorage`, permanent | Not a SQL table: the ledger is per-device and never synced. Ledger maths pinned by fixtures. |
| `Settings` | same + `stores/settings.ts` | 485 | `repo-sql` (P2 **rows done**) | same | Key/value rows; typed defaults/merge wait for P7 with the language/voice catalogs (ADR-008). Secret-prefixed keys never surface. |
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
- **Settings:** the Svelte store still owns the typed defaults/merge and
  language/voice normalisation. It reads and writes rows through the bridge
  when core is selected. Porting that document waits for P7 with the
  language/voice catalogs (ADR-008).

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
