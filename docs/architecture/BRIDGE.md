# Bridge contract

The bridge is the only contract between the Rust core and any driver: the
Svelte web SPA, the Tauri desktop/Android webview, a future CLI, or anything
built over FFI. It is defined in `bindings/onspot-bridge` and documented here.

Status: P1 built the spine, P2 added settings/history, and P3 adds the practice
loop. `core.ping`, `history.*`, `settings.*` and `practice.*` are implemented
and typed; `UiEvent` flows through a wasm callback and a Tauri channel. Desktop
storage is backed by `repo-sql`/rusqlite; the browser is backed by a host SQL
shim over the existing sqlite-wasm worker (ADR-007), checked in real Chrome by
`bun run test:storage`. Practice media, speech engines and the legacy LLM
evaluation cross as `host_request`/`core.host_reply` pairs, so the same loop
runs on both transports. The command surface is async; the Tauri command and
both wasm exports return promises. Settings, history and practice are the
default core features; the remaining catalog is filled in phase by phase.

## Envelope

Request:

```json
{ "cmd": "practice.stop_and_analyze", "v": 1, "payload": { } }
```

Response:

```json
{ "ok": true, "data": { } }
```

```json
{ "ok": false, "error": { "code": "practice.no_speech", "message": "…", "details": { } } }
```

- Commands are request/response only. Nothing in the catalog may stay open; a
  stream is a subscription plus events.
- `payload` is always an object (`{}` when the command takes no arguments).
- `error.code` is stable and language-neutral. `error.message` is a diagnostic
  for logs and tests, **never** shown to a learner: the driver maps the code to
  the copy that exists today in the TypeScript catch blocks (invariant I6).
- `error.details` is JSON, optional and command-specific.

## Commands (catalog skeleton; filled per phase)

Naming is `area.verb_object` in snake_case. Every command below is a placeholder
until its phase declares the payload in the bridge and generates the type.

| Command | Phase | Purpose |
|---|---|---|
| `core.ping` | P1 **implemented** | Round-trip proof: returns `{ appVersion, bridgeVersion, sequence, note }` and emits `Pong`. `note` is echoed unchanged. |
| `system.snapshot` | P1 (next) | Current view snapshot, so a fresh driver can paint before events arrive. |
| `practice.configure` | P3 **implemented** | `{ config }` → the initial snapshot. Creates the session; call before any other practice command. |
| `practice.snapshot` | P3 **implemented** | The current view snapshot. |
| `practice.new_session` | P3 **implemented** | Close the current session and start a draft. |
| `practice.set_prompt` | P3 **implemented** | `{ prompt }` → snapshot; the driver has already picked or stored it. |
| `practice.next_prompt` | P3 **implemented** | `{ candidates, englishFallback }`; tries the driver model, then picks a stored candidate. |
| `practice.start_recording` | P3 **implemented** | Start capture for a new take. |
| `practice.tick` | P3 **implemented** | Advance the 60 s clock; the driver calls it every 250 ms while recording. |
| `practice.stop_and_analyze` | P3 **implemented** | Stop capture, reject silence, transcribe, evaluate, persist. |
| `practice.cancel_recording` | P3 **implemented** | Abandon the take in progress. |
| `practice.audio_level` / `practice.stt_progress` | P3 **implemented** | Host progress fed back into the snapshot. |
| `practice.set_active_attempt` / `practice.clear_error` | P3 **implemented** | View commands. |
| `practice.resume_last_session` / `practice.open_session` | P3 **implemented** | Hydrate the newest or a chosen stored session. |
| `practice.rename_session` / `practice.delete_session` | P3 **implemented** | Session writes; emit `history_changed`. |
| `practice.speak_track` / `practice.play_segment` / `practice.speak_text` / `practice.play_recording` | P3 **implemented** | Driver playback intents. |
| `practice.set_attempt_voice` | P3 **implemented** | Persist a take's read-back voice. |
| `core.host_reply` | P3 **implemented** | Internal reply to one `host_request`; drivers only. |
| `evaluation.test_connection` | P4 **implemented** | `{ endpoint }` → `{ reply }`; the Settings connection test on the Rust path. |
| `history.list` | P2 **implemented** | Sessions with their take previews, newest first. |
| `history.search` | P2 **implemented** | `{ query, regex, caseSensitive }` → the same shape; invalid patterns return `history.invalid_regex`. Empty query returns every session. |
| `history.rename` | P2 **implemented** | `{ sessionId, title }` → `{ changed }`; emits `history_changed` when a row changed. |
| `history.delete` | P2 **implemented** | `{ sessionId }` → `{ changed }`; cascade deletes takes; emits `history_changed`. |
| `settings.list` | P2 **implemented** | Every key/value row; a restored file's `onspot.key.*` rows are filtered out. |
| `settings.get` | P2 **implemented** | `{ key }` → `{ value }`; secret-prefixed keys return `null`. |
| `settings.set` | P2 **implemented** | `{ key, value }` → `{ changed }`; emits `settings_changed`. |
| `usage.summary` | P6 | Ledger totals for the monitor. |
| `insights.summary` | P5 | Aggregated corrections and patterns. |
| `export.session_markdown` | P7 | Assemble a session transcript document. |
| `sync.status` / `sync.run` / `sync.resolve_conflict` | P7 | Drive sync and the conflict decision. |
| `language.data_status` / `language.download` | P7 | Plan and run model downloads. |
| `secrets.set` / `secrets.clear` | driver-local (ADR-007) | BYOK keys are read/written by the driver's `SecretStore` (`core-client/secrets.ts`, `localStorage` on both runtimes). They are deliberately not commands: keys never cross the bridge, enter SQLite, settings or exports. |

## Boot handshake

Both transports start the same way and return the same shape
(`InitResponse`): `{ appVersion, bridgeVersion, sequence }`.

1. The driver registers its event sink: the wasm export takes a JS callback,
   the Tauri command takes a `Channel<Value>`.
2. The core emits its boot event `{ "event": "pong", "seq": <sequence> }`.
3. The driver now sends commands. Calling `core.ping` emits another `Pong`, so
   a driver can prove that commands and events both cross the boundary.

Web: `await module.init_core_wasm({ appVersion }, (event) => …, sqlHost)`; the
third argument is optional (storage commands then answer `bridge.unavailable`).
Desktop/Android: `await invoke('core_init', { events: channel })`, then
`await invoke('core_command', { cmd: 'core.ping', payload: { note } })`.

## Events (`UiEvent`, serde-tagged on `event`)

The enum lives in `onspot-app` and is re-exported by the bridge (ADR-004), so a
use case can emit without knowing a driver exists.

| Event | Phase | Payload |
|---|---|---|
| `pong` | P1 **implemented** | `{ seq }` — the core is alive; `seq` increases with every event. |
| `error` | P1 **implemented** | `{ code, message }` — recoverable failure for the driver to map to copy. |
| `settings_changed` | P2 **implemented** | `{ seq }` — a settings row was written; drivers re-read the snapshot. |
| `history_changed` | P2 **implemented** | `{ seq }` — a session was renamed or deleted; drivers reload the list. |
| `practice_state_changed` | P3 **implemented** | `{ snapshot }` — the whole view the practice screen renders. |
| `audio_level` | P3 **implemented** | `{ level }` — live microphone level. |
| `transcription_progress` | P3 **implemented** | `{ progress, status }`. |
| `evaluation_started` | P3 **implemented** | `{}`. |
| `evaluation_finished` | P4 **implemented** | `{ ok }` — the judge returned; errors are in the snapshot. |
| `attempt_persisted` | P3 **implemented** | `{ attemptId }`. |
| `take_silent` | P3 **implemented** | `{}` — the snapshot carries the stable error code. |
| `speak_track` / `play_segment` / `speak_text` / `play_recording` | P3 **implemented** | The driver performs playback; the core decides what and in which order. |
| `host_request` | P3 **implemented** | `{ id, method, payload }` — an internal request to the driver, answered with `core.host_reply`. P4 adds the `http.request` method for LLM transport. |
| `download_progress` | P7 | `{ target, loadedBytes, totalBytes, label }`. |
| `usage_warning` | P6 | `{ provider, window, remaining }`. |
| `sync_changed` | P7 | `{ state, remoteModifiedAt }`. |
| `error` | P1 **implemented** | `{ code, message }` — recoverable; the driver maps the code to learner copy. |

Events are additive. A driver that does not know an event must be able to
ignore it; the runtime decodes by `event` and logs unknown names.

## Versioning

- Each command has `v`, starting at 1. A breaking payload change bumps `v`.
- Adding an optional field is not breaking; removing or renaming one is.
- The bridge supports one version per command at a time. No version lives past
  the phase that replaces it, except a version the shipping app still sends;
  P8 removes all of them together with `VITE_CORE_BACKEND`.
- An event payload change follows the same rule: a new field is additive, a
  renamed one is a new event.

## Transports

| Driver | Commands | Events |
|---|---|---|
| Web (wasm) | async `#[wasm_bindgen]` exports, `serde-wasm-bindgen` marshaling; storage runs over the host SQL object passed to `init_core_wasm` (ADR-007) | JS callback passed to `init_core_wasm` |
| Desktop / Android | one thin `#[tauri::command]` per command, forwarding to the same dispatcher | `tauri::ipc::Channel` (the pattern the speech plugin already uses) |
| CLI | direct Rust calls; the JSON catalog is for documentation and scripted tests | in-process sink printing/quiet |

Rules for driver authors:

1. Call `system.init` once, before any command.
2. Keep the returned snapshot as the fallback view state and update it from
   events; do not re-request state after each command.
3. Do the copy mapping (`error.code` → text, event → UI state) in the driver.
4. No driver imports core internals or names a crate other than the bridge.

## Type generation

`ts-rs` derives a `.ts` file per type from the Rust definitions. Because the
catalog is split between `onspot-app` (events, config) and the bridge (commands,
errors), the exports are assembled in a fixed order:

```sh
bun run bridge:types
# = cargo test -q -p onspot-app -p onspot-bridge export_bindings
#   && node scripts/bridge-types.mjs
```

The assembler writes `src/lib/core-client/types.gen.ts` with a generated
header; the per-type files stay in `src/lib/core-client/bindings/`. Both are
committed, so a TypeScript-only change does not need a Rust build. CI runs the
same command and fails on any diff, so a changed Rust type cannot leave a stale
driver type behind.

`src/lib/core-client/` also holds `transport.ts` (the `CoreClient` interface with
`WasmCoreClient` and `TauriCoreClient`, selected by `isTauri()`), `backend.ts`
(ADR-002's toggle) and `CoreBridgeProbe.svelte` (dev-only readout, dropped from
production builds).
