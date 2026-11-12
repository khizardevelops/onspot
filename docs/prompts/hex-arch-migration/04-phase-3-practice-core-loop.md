# PHASE 3 — The practice core loop: state machine, speech ports, events

Standing context: Master Strategy Prompt; P0–P2 merged (bridge, storage,
settings/secrets, history on the core path).

## Mission

This is the highest-risk phase: decompose the `src/lib/stores/practice.ts`
God store (verify LOC, ~1,453) into the `RunPracticeSession` application
layer in `onspot-app` with an event-driven view contract, and define the
speech/recording/playback ports. The Svelte practice screen becomes a pure
subscriber. Ship cadence and the toggle (I7) make this safe.

## Tasks

1. **Map the God store first.** Produce
   `docs/architecture/practice-loop-map.md`: every exported function in
   `practice.ts`, its callers (components/routes), what state it reads or
   writes, and its destination (use case / port / view store / deleted).
   Reconcile the `practice.ts` vs `practiceSession.ts` split flagged in P0.
   Get the phase re-approved against this map before writing Rust (post the
   map in the handoff and proceed unless the owner objects — note it).
2. **Ports** (`onspot-ports`), all object-safe + async + cancellation-aware:
   - `AudioCapture`: `start(opts)`, `stop() -> AudioFrame { pcm: Vec<f32>,
     sample_rate, blob: BlobHandle }`, `cancel()`, optional live
     level metering events. Implemented by the host shim on **both** runtimes
     for now (today the webview records via Web Audio even on desktop —
     verify in `utils/recorder.ts`).
   - `SttEngine`: `transcribe(frame, opts, progress_cb) -> Transcript`.
     Two adapters in this phase: desktop/Android native
     (`crates/adapters/native-stt` calling the whisper.cpp code already in
     `src-tauri/plugins/speech` in-process, reusing its model download/status
     commands as internal APIs — no new IPC) and the web host shim delegating
     to the existing Transformers.js worker. Cloud Groq STT: port with the
     LLM HTTP client in P4 or shim now — decide via ADR-005, document.
   - `TtsEngine` + `AudioPlayback`: host shims on both runtimes this phase
     (ports-first decision). The core decides *what* to speak and in which
     order (text pieces, tracks, explanation flow — port the logic of
     `speech/tts/textPieces.ts`, `speechPieces.ts`, `explanationSpeech.ts`
     into `onspot-app`/`onspot-dsp`), the host performs it. Voice selection
     and EQ settings are data (already in settings); the Web Audio graph
     stays in the driver.
3. **Use cases** (`onspot-app::practice`):
   - `StartSession`, `NextPrompt`, `StartRecording`, `CancelRecording`,
     `StopAndAnalyze`, `SetActiveAttempt`, `AbandonTake`, `ResumeLastSession`
     (hydrate), each mirroring today's exported functions and their
     preconditions (e.g. `stopAndAnalyze`'s synchronous claim so a double
     click or the 60s timer can't double-stop — reproduce with a state
     guard, test it).
   - Port exactly: the phase state machine (`idle → recording →
     transcribing → evaluating → idle/error`), run-token cancellation (the
     `run` counter + `AbortController` pattern becomes a
     `CancelToken`), the 60s timer (via `Clock`), `isSilent` →
     `onspot-dsp` (golden fixtures already exist), `capWords` →
     `onspot-dsp`, error taxonomy with stable codes for every string the TS
     sets today (map copy 1:1 in the driver, I6).
   - Persistence goes through the P2 repositories; `persistAttempt` logic
     (verify ~LOC 557–650) ports with its exact row writes.
   - Events replace state mutation: emit the `UiEvent` set
     (`state_changed` carrying the full view snapshot for the practice
     screen, `transcription_progress`, `evaluation_started`,
     `attempt_persisted`, `take_silent`, `error`, playback intents like
     `speak_track { attempt_id, kind }`). The **view snapshot** (what the
     screen needs to render, including derived flags like
     `explanationAudioAvailable`) is computed in `onspot-app` from
     settings + language data, so components stop deriving.
4. **Svelte rewiring**:
   - `stores/practice.ts` becomes a thin adapter: subscribes to bridge
     events, holds the latest snapshot, exposes the same function names the
     components already call (so `PracticeScreen.svelte` (~1,254),
     `AttemptStream.svelte`, `AttemptCard.svelte`, `FeedbackPanel.svelte`
     change minimally). When `VITE_CORE_BACKEND=legacy`, the old
     implementation is used unchanged.
   - The prompt catalog (`lib/practice/prompts.ts`) is data — leave in TS
     this phase, move in P7 with the language catalog (ADR-005 note).
5. **Fixtures + tests**:
   - Golden: silence detection, cap words, state-machine transitions
     (scripted input sequences asserting event streams — a mini
     scenario runner in `onspot-app` tests with mocked ports).
   - Contract tests: `SttEngine` against a canned-response fake for both
     adapters' glue; `AudioCapture` shim contract documented in BRIDGE.md.
   - Cancellation tests: stop during transcribe, stop during evaluate,
     new recording during evaluation, timer firing during click — the exact
     races the current comments describe.
6. **Manual smoke matrix** (record results in handoff): web + desktop ×
   (start, speak, silence, cancel, stop, 60s timeout, transcribe progress,
   evaluation arrives, tracks play, retake, resume last session after
   restart, offline path with local engines). Include an Android
   `cargo check --target aarch64-linux-android` and, if hardware is
   available, one on-device run.

## Acceptance gates

- [ ] With `VITE_CORE_BACKEND=core`, the full practice loop works on web and
      desktop with no perceptible latency or behavior regression (side-by-side
      compare against legacy on the smoke matrix).
- [ ] Event-stream tests cover every transition and the four race cases;
      `isSilent`/`capWords` golden parity green.
- [ ] No `svelte/store` import exists in `crates/**` (boundary check) and no
      bridge/`core-client` import exists inside components other than via the
      practice store adapter.
- [ ] `practice-loop-map.md` exists and matches the final wiring.
- [ ] All I1 standard gates green; `static/_headers`, PWA service worker
      behavior unchanged; `.agents/handoff/` updated.

## Out of scope

LLM evaluation internals (the `SttEngine`/LLM calls go through the *legacy*
host adapter or a trivial passthrough until P4 — `evaluateAttempt` stays TS
under the toggle), translations/glosses (P5), usage ledger (P6), prompts
catalog move (P7).
