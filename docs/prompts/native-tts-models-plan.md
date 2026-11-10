# Native Supertonic voices in the desktop and Android apps

## Context

Supertonic (one 145 MB model, 31 languages) runs as single-thread WASM in a Web Worker, even inside
the Tauri apps: about 1.6 s of computing per second of speech on the laptop at 8 steps, and 42 s for
one explanation under memory pressure. Speech-to-text already went native through
`src-tauri/plugins/speech` and gained a lot. The goal is the same move for Supertonic, on desktop
and Android, using sherpa-onnx's official 2.0.1 prebuilt libraries (the version the WASM build
already pins).

Web and iPhone keep the WASM path unchanged. Piper and piper-plus stay on WASM too: rhasspy's files
do not load on sherpa-onnx without re-export, so they are a separate ticket. Audio settings do not
change (8 steps, speed 1.05).

Supertonic is not in v0.2.4 (`src/lib/speech/tts/supertonic/` is still untracked), so no released
user has the model cached and no migration is needed. This work builds on the uncommitted tree and
commits nothing unless asked.

## Before editing

Read the remaining `.agents/handoff/` files, as `AGENTS.md` requires.

## Step 1: measurement gate (no repo changes)

Build a scratch crate in the scratchpad on `sherpa-onnx = "=2.0.1"`. Run it on the laptop and on the
Galaxy S24 FE (`adb push` the binary, two `.so` files and the model). **The phone is not connected
right now and is needed for this step.**

- **Speed:** rtf at 8 steps and speed 1.05 with 1, 2, 4 and all threads, in fr, en, ko, ja and ar,
  on a word, a sentence and a 250-character text. Phone WASM baseline from `/model-lab/voices/`.
- **Cost:** cold-load time and peak memory (`VmHWM`).
- **Quality:** WAVs to compare by ear against WASM, plus the share of energy above 5 kHz
  (method in `docs/benchmarks/tts.md`).
- **Hostile text:** emoji only, punctuation only, mixed scripts, combining marks, a 5,000-character
  word. Any process death means pre-filtering is designed first.
- **IPC probe:** a throwaway 1 MB `tauri::ipc::Response` on the phone must arrive as an `ArrayBuffer`.

**Pass marks (proposed, yours to change):** laptop rtf at or below 0.8; phone rtf at or below 1.0
and at least twice as fast as phone WASM. **Stop and report the numbers either way.**

## Step 2: build plumbing

New `scripts/sherpa-native-libs.sh <rust-triple>`, modelled on `scripts/sherpa-tts-assets.sh`, with
SHA-256s pinned from the GitHub release API.

| Target | Archive | Wiring |
|---|---|---|
| Linux, macOS | `static-lib` | `SHERPA_ONNX_LIB_DIR` |
| Windows x64, ARM64 | `static-MD-Release-lib` (the crate's default is the MT runtime, which conflicts with Rust and whisper.cpp) | `SHERPA_ONNX_LIB_DIR` |
| Android | `android.tar.bz2` | `SHERPA_ONNX_ARCHIVE_DIR`, plus our own copy of only `libonnxruntime.so` and `libsherpa-onnx-c-api.so` into `jniLibs` |

- The crate silently skips its Android copy when `CARGO_TARGET_DIR` is outside the project, as it is
  on this machine, so `scripts/android.sh` runs the script itself.
- `scripts/android.sh` and `.github/workflows/android.yml` fail if `unzip -l` does not show both
  libraries in the APK. A missing one crashes the app at launch for everyone.
- `.github/workflows/release.yml`: add a triple per matrix entry, run the script, and run the bench
  on each runner with the model in a non-ASCII folder (Windows and macOS have no other evidence).
- Windows ARM64 is cross-built. If its bench cannot pass on a `windows-11-arm` runner, exclude the
  dependency by target and that one build keeps WASM.

Local Linux desktop builds need no script: the crate's own download works there.

## Step 3: Rust plugin (`src-tauri/plugins/speech`)

- `Cargo.toml`: `sherpa-onnx = "=2.0.1"` and tokio's `sync` feature.
- New `src/supertonic.rs`: an `Engine` holding `Mutex<Option<OfflineTts>>`, a use counter, its own
  download cancel flag and a download lock. `speak` holds one lock across load and generate, and
  touches the use counter at start and end so idle release cannot free the model mid-run. Thread
  count is a constant set from the gate.
- New `src/idle.rs`: moves `IDLE_RELEASE` and `schedule_idle_release` behind a small trait both
  engines implement.
- `src/models.rs`: allow the pinned Supertonic repository as a second source; a validated path under
  `models/supertonic-3/` keeping upstream file names (the C++ requires the indexer to end in `.bin`);
  a `.part` suffix helper; cancel reset once per batch. Reuse `download` and `http_client`.
- `src/commands.rs`: `supertonic_status`, `supertonic_download` (all seven files, skips those present
  at exact size, combined progress over one `Channel`), `supertonic_cancel_download`,
  `supertonic_load`, `supertonic_speak`. File lists come from the caller, so
  `SUPERTONIC_MODEL_FILES` in `src/lib/languages/voices.ts` stays the only list.
- `supertonic_speak` returns `tauri::ipc::Response`: little-endian `u32` sample rate, then `f32`
  samples.
- `src/error.rs`, `src/lib.rs`, `build.rs`, `permissions/default.toml`: register all of the above.
- New `examples/supertonic_bench.rs`, mirroring `examples/bench.rs` against the real engine.

**Crash safety.** Native failures kill the app rather than a worker: `SHERPA_ONNX_EXIT` is `_Exit`,
and the release profile is `panic = "abort"`.

- Before FFI: strip NUL (`CString::new(text).unwrap()` in the crate would abort on one), validate
  language, style, speed and steps, and cap length from the hostile-text results.
- Before `create`: every file must exist at its exact size. SHA-256 runs at download.
- A small counter file per app version is raised before native code and cleared after. Three
  unfinished runs in a row make `supertonic_status` report unusable and voices fall back to WASM,
  which stops a crash loop.

## Step 4: TypeScript (`src/lib/speech/tts`)

The plugin cannot be called from a Web Worker, so the switch lives in the main-thread queue, which
already owns ordering, listened-first selection and the grace period.

- New `supertonic/native/nativeSupertonic.ts`, mirroring `stt/native/nativeEngine.ts`: `isUsable`,
  `missingFiles`, `prepare`, `cancelPrepare`, `speak`. Calls `toWellFormed()` on text, because a lone
  surrogate can leave an Android call unanswered and stall the queue. Native only for
  `currentRuntime()` of `desktop` or `android`.
- Rename `local/LocalVoiceWorker.ts` to `local/LocalVoiceQueue.ts` (importers: `service.ts`, both
  model-lab pages, `speech/README.md`). One branch in `dispatchNext` after `this.inFlight = id`;
  native outcomes feed the existing `handle` as the same message types. `dispose()` also cancels a
  native download.
- `BaseTtsAdapter.ts`: export the duration and peak calculation. Move `limitPeak` from
  `SupertonicAdapter.ts` to `supertonic/peakLimit.ts`, so both paths process audio identically.
- New `local/installedVoiceAssets.ts`: `missingVoiceAssets(voice)` replaces the lookups in
  `isInstalled` (`stores/voiceLibrary.ts`) and `voiceCacheState` (`stores/languageData.ts`).

If phone memory peaks above about 1.2 GB with Whisper and Supertonic both loaded, make the two
engines exclusive on Android and skip `warmLocalVoices` there.

## Step 5: docs and handoff

Update `docs/benchmarks/tts.md` (native numbers), `docs/architecture/platforms.md`,
`docs/architecture/languages.md`, `docs/architecture/supported-languages.md`, `README.md`,
`src/lib/speech/README.md`, and the code comments that describe WASM-only Supertonic. Update
`.agents/handoff/rules/constraints.md`, the Supertonic section of `references/known-issues.md`, and
`memory/state.md`, `tasks.md`, `decisions.md` and `last-session.md`.

## Verification

1. Step 1 gate, then stop and report.
2. Rust unit tests for the validators and path rules; `supertonic_bench` matches the gate numbers.
3. A debug APK launches on the phone with both libraries, before any TypeScript lands.
4. `/model-lab/voices/` for all 31 languages inside the desktop and Android apps.
5. Real practice flows, by ear. Stored clips are not keyed by engine, so use new sentences:

   | Instruction | Target | Proves |
   |---|---|---|
   | es | fr | non-English instruction |
   | ar | ja | right-to-left text, shorter pieces |
   | hi | ko | two non-Latin scripts |
   | es | fa | native and Piper mixed in one explanation |
   | en | zh | Piper target with a native explanation |

6. Ten-minute phone session with `dumpsys meminfo` and a thermal watch.
7. Failure cases: cancel between files, a truncated model file, and killing the app during speech
   three times to confirm the WASM fallback.
8. Web regression in muted Chromium, plus `bun run check` and `bun run build`. Check port 5173 first
   and reuse any running dev server (Tauri dev commands start one).
9. All CI runners green, with the bench on each.

## Costs and remaining risks

- The APK grows by about 25 MB, and desktop binaries grow too (measured in Step 2).
- Out-of-memory during native inference still kills the app; the counter only stops it repeating.
- Only one phone is available, so a 4 GB device stays untested.
- Windows and macOS get CI evidence only, never a real app run on this machine.
- The phone gain may be small if ONNX Runtime's threads behave badly on mixed core types. The gate
  settles this before any repo change.