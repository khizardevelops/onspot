# PHASE 1 — Cargo core crates + bridge spine (first vertical slice)

Standing context: Master Strategy Prompt; Phase 0 outputs
(`docs/architecture/*`, boundary guards, fixture harness) are in force.

## Mission

Stand up the bridge so that **one trivial command round-trips through the
same core on both runtimes**: the web build (wasm-bindgen) and the Tauri
desktop build (`#[tauri::command]`). No business logic yet — this phase
proves the plumbing, the type generation, the event channel and the toggle
plumbing that every later phase reuses.

## Tasks

1. **Bridge skeleton** (`bindings/onspot-bridge`):
   - Define `UiEvent` (serde-tagged enum) with, for now:
     `Pong { seq: u64 }`, `Error { code: String, message: String }`.
   - Define the command dispatcher: `dispatch(cmd: &str, payload: serde_json::Value)
     -> Result<serde_json::Value, BridgeError>` with a registry the later
     phases extend. Version stamp: `bridge.v1`.
   - Expose `init_core(config, host_adapters)` where `HostAdapters` is a
     struct of `Arc<dyn ...>` port implementations, initially all optional.
   - Command(s) for this phase: `core.ping` (returns app version + bridge
     version) and `core.get_settings_probe` is NOT in scope — only `ping`.
   - `ts-rs` generates TS types for `UiEvent`, the ping request/response and
     the error shape into `src/lib/core-client/types.gen.ts` (wire the codegen
     into a `cargo test` export step or a `bun run bridge:types` script —
     pick one, document in BRIDGE.md, make it deterministic).
2. **Web transport** (wasm):
   - Feature `wasm` on `bindings/onspot-bridge` with `wasm-bindgen` exports:
     `init_core_wasm(config: JsValue, event_callback: js_sys::Function)` and
     `dispatch_wasm(cmd: &str, payload: JsValue) -> Result<JsValue, JsValue>`
     using `serde-wasm-bindgen`. Events flow by invoking the JS callback with
     a plain JS object.
   - Build target: `wasm32-unknown-unknown`. Add a `bun run bridge:wasm`
     build script producing the pkg into a gitignored dir consumed by Vite
     (configure Vite so the wasm glue is lazy-loaded client-side only —
     the app is a static SPA via `adapter-static`; respect the existing
     `browser`-guard patterns in `src/lib/platform/runtime.ts`).
3. **Desktop/Android transport** (Tauri):
   - In `src-tauri/src/lib.rs`, register two pass-through commands
     `core_init` and `core_command` (or one `core_command` + init in setup)
     that forward to the bridge dispatcher. Events go back over
     `tauri::ipc::Channel` (mirror the pattern in
     `src-tauri/plugins/speech/src/commands.rs::download_model`). Zero logic
     in the commands (invariant I8).
   - Keep the existing commands (`oauth_*`, speech plugin) untouched.
4. **Svelte client**:
   - Create `src/lib/core-client/`: `types.gen.ts` (generated), `transport.ts`
     with two implementations behind one `CoreClient` interface —
     `WasmCoreClient` (lazy dynamic import, guarded by `browser`) and
     `TauriCoreClient` (invoke + channel subscription) — selected at runtime
     using `src/lib/platform/runtime.ts` (`isTauri()`).
   - Add the `VITE_CORE_BACKEND` plumbing (ADR-002): an env- and
     localStorage-overridable flag that later phases consult per feature.
     For now only a dev-only readout uses it.
5. **Smoke surface**: add a hidden dev route or debug line in the existing
   layout (dev-only, not in production UI) that prints `core.ping` result and
   the last 3 events, using `CoreClient`. It must work identically on web and
   desktop and prove the event channel (register a listener, emit one
   `Pong`-adjacent event from the core on init).
6. **CI**: extend `architecture.yml` with a wasm job
   (`cargo build -p onspot-bridge --target wasm32-unknown-unknown --features wasm`
   + typegen diff check: regenerated types must produce zero git diff).
   Confirm `android.yml` still applies cleanly (the new `core_command` must
   compile for Android — no desktop-only deps in the bridge's tauri feature).

## Acceptance gates

- [ ] `bun run dev` (web): the dev readout shows the ping response produced
      by the wasm core, and one event received through the JS callback.
- [ ] `bun run tauri dev` (desktop): the same readout shows the same response
      through `invoke`, and the event through the Channel.
- [ ] `cargo tree -e normal -p onspot-domain/-ports/-app/-dsp` shows none of
      the forbidden crates (I2) — `scripts/check-boundaries.mjs` green.
- [ ] `ts-rs` regeneration produces zero diff (CI-enforced).
- [ ] `bun run check`, `bun run build`, `cargo clippy --workspace --all-targets
      -- -D warnings`, `cargo test --workspace` all green.
- [ ] Production build contains no dev readout; `static/_headers` unchanged.
- [ ] `.agents/handoff/` updated; BRIDGE.md records the ping command and
      event subscription contract.

## Out of scope

Any settings/storage/practice logic; touching `adapters/` or `stores/`
beyond the new `core-client/`; changing the speech plugin; Rune.
