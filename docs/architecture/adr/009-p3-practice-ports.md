# ADR-009 — P3 practice ports: bytes at the boundary, secrets stay in the driver

- Status: accepted
- Date: 2026-11-12 (P3)
- Deciders: migration lead

## Context

P3 defines the speech side of the practice loop (`AudioCapture`, `SttEngine`,
`TtsEngine`, `AudioPlayback`, `Clock`) and the two calls the loop needs while
the LLM stays in TypeScript: `EvaluationPort` (P4 replaces the shim) and
`PromptSource` (the catalogue stays in TypeScript until P7). The port catalog
already requires async, object-safe traits that take domain types and a
`CancelToken`, and return a stable `CoreError`.

Two boundaries needed a decision:

1. How audio crosses into the core.
2. How BYOK settings and secrets reach an engine.

## Decision

1. **Audio crosses as bytes plus a MIME type.** `AudioFrame` carries 16 kHz
   `f32` PCM, the recorded container bytes (`BlobHandle`), its sample rate and
   duration. `AudioClip` carries synthesized bytes and a MIME type. The core
   never sees a `Blob`, an `AudioBuffer`, an object URL or an `<audio>` element.
2. **The driver resolves endpoints and secrets.** A request names
   `EngineMode::Local|Cloud`, a language and a voice; it never carries an API
   key, base URL or model. The host shim reads them from the existing driver
   settings/secrets. This keeps I3 true even for a core use case and keeps the
   request shapes free of provider fields.
3. **`EvaluationPort` is a shim in P3.** The web and Tauri hosts call today's
   TS `evaluateAttempt`; P4 replaces the body, not the port. Its request and
   result use domain types (`EvaluationRequest`/`EvaluationResult`).
4. **`PromptSource` is a port, not a moved catalogue.** The core decides when a
   prompt is needed and how stored/English fallbacks behave; the host writes a
   generated topic through the LLM it already has. Catalogue data stays in
   TypeScript until P7.
5. **Callbacks are sinks, not streams.** `AudioLevelSink` and
   `SttProgressSink` are synchronous, object-safe sinks. A host calls them as
   data arrives; the core coalesces them into events. No channel type appears in
   a signature.
6. **`Clock` is the only time source.** It provides monotonic milliseconds and
   a cancellable sleep. The 60 s deadline and the 250 ms tick use it; tests never
   sleep in real time. The driver owns the interval and calls `practice.tick`,
   so the core names no async runtime.
7. **Driver capabilities cross as one request/response envelope.** On both
   transports the bridge emits `host_request { id, method, payload }` and the
   driver answers with `core.host_reply`. This lets the same Rust ports call
   capture, STT, evaluation and prompt writing on wasm and Tauri without
   pretending a Tauri command can call the webview synchronously.
8. **Playback is an intent, not a byte round trip.** The core emits
   `speak_track`, `play_segment`, `speak_text` and `play_recording`; the driver
   uses its existing audio/TTS cache. A future native player can subscribe to
   the same events.

## Consequences

- The core has no JS or audio type in its public surface; adapters convert.
- Cloud engines cannot leak a key into core view state, logs or persistence.
- A future native voice engine implements the same trait without changing the
  loop.
- Two ports (`EvaluationPort`, `PromptSource`) exist before their Rust
  adapters; their P3 bodies are host shims. P4 replaces `EvaluationPort` and
  the generated-prompt half of `PromptSource`.
- The timer is driven by the driver through `practice.tick`, preserving the
  rule that core crates name no async runtime.
- Host requests can be large only for the captured frame; the driver caches it
  after `capture.stop` instead of sending the PCM back for STT.

## Alternatives rejected

- **Pass object URLs or JS blobs through the port.** Ties the core to the
  webview and makes the CLI impossible.
- **Pass the whole typed settings document to every engine.** Widens the port,
  duplicates the P7 work, and risks secrets entering view state.
- **Use byte streams for TTS.** P3 blocks on a clip for parity with today's
  cached player; streaming can be additive later.
- **Move the prompt catalogue in P3.** It drags language/provider data that P7
  owns; a writer port keeps NextPrompt testable now.
