# Prompt: native Supertonic voices in the desktop and Android apps

> Written 2026-11-10 for the agent that will finish this work. Give it this whole file.
>
> The measurement step is finished and passed. Nothing else has started: no app code, build script
> or workflow has changed for this. Repo facts were checked on 2026-11-09 and 2026-11-10; re-check
> any that the code may have moved on from. Supertonic itself was still uncommitted on those dates
> (`src/lib/speech/tts/supertonic/` untracked, not in v0.2.4), so no released user has the model
> cached and no migration is needed.

## Ask the user first

Stop here and get both answers before building anything.

1. **Do the native clips sound as good as the WASM ones?** Same voice and text, different random
   noise, so small differences are normal. The clips are in
   `/mnt/data/not_synced/dev-cache/native-bench/supertonic-gate/results/laptop/`, under `wav-native/`
   and `wav-wasm/`. Objectively they match (see below), but the user judges voices by ear.
2. **Is the higher memory acceptable?** Native peaks at about 350 MB on the laptop and 385 MB on the
   phone, over the user's earlier goal of 300 MB. The 262 MB WASM figure was measured differently
   (worker PSS after speaking), so the two are not directly comparable. Memory is released after
   90 idle seconds. The recommendation is to accept it for a 4–5× speed gain.

## Your task

Run Supertonic (one 145 MB model, 31 languages) on native sherpa-onnx in the Tauri apps, using
sherpa-onnx's official 2.0.1 prebuilt libraries, the version the WASM build already pins. Today it
runs as single-thread WASM in a Web Worker, even inside the Tauri webview.

**Out of scope:** the web build and iPhone (a PWA) keep the WASM path unchanged. Piper and piper-plus
stay on WASM, because rhasspy's files do not load on sherpa-onnx without re-export; that is a separate
ticket. Audio settings do not change (8 steps, speed 1.05).

## Before you start

Read `.agents/handoff/` as `AGENTS.md` requires. The rules that bite hardest here:

- Use upstream prebuilt artifacts. Never compile sherpa-onnx from source.
- Keep the change narrow; adjacent work becomes a separate ticket.
- Never trade audio quality for speed.
- Any language pair must work: verify more than French and English, and a non-English instruction
  language.
- Every Playwright or Chromium launch uses `--mute-audio`. Never start a second dev server on port
  5173; reuse the running one.
- Commit only when the user asks.
- **Never uninstall `app.onspot.desktop` from the user's phone: that deletes its data.** A build
  signed with a different key cannot update it, so see the verification section.

## Measured results (2026-11-10)

Laptop: i7-1165G7, 11 GB RAM, heavy swap in use. Phone: Galaxy S24 FE (SM-S721B), Android 17. Fifteen
clips (a word, a sentence and a 250-character text in fr, en, ko, ja and ar), voice M1, 8 steps, speed
1.05. WASM ran the same prebuilt runtime on one thread in Chromium on the laptop and Chrome on the
phone.

Seconds of computing per second of speech, over all fifteen clips:

| Engine | Laptop | Phone |
|---|---|---|
| WASM, 1 thread | 1.68 | 1.87 |
| Native, 1 thread | 0.40 | 0.54 |
| **Native, 2 threads** | **0.33** | **0.51** |
| Native, 4 threads | 0.38 | 0.66 |
| Native, 6 threads | not run | 0.71 |
| Native, 8 threads | 0.55 | not run |

By clip length, WASM against native at 2 threads:

| Clip | Laptop | Phone |
|---|---|---|
| Word | 2.27 → 0.57 | 2.63 → 0.66 |
| Sentence | 1.56 → 0.35 | 1.93 → 0.53 |
| 250 characters | 1.67 → 0.31 | 1.80 → 0.49 |

The pass marks were laptop at or below 0.8, phone at or below 1.0 and at least twice as fast as phone
WASM. All passed (5× on the laptop, 3.7× on the phone). The phone was a few degrees warmer during its
WASM run (36–37 °C, against 29–37 °C across the native runs), which slightly favours native.

- **Model load:** 0.6–0.7 s native at 2 threads, on both devices, from local disk.
- **Peak memory (`VmHWM`):** laptop 347–352 MB, phone 380–385 MB. A single short clip on the phone
  peaked near 260 MB.
- **Hostile text:** no process death in 11 cases on the laptop or 10 on the phone (emoji only,
  punctuation, digits, mixed scripts, combining marks, wrong-language Latin, empty, spaces, a
  5,000-character word). The 5,000-character Japanese word ran on the laptop only.
- **Empty or spaces-only text:** generation returns nothing.
- **Emoji-only text:** a 1.3 s near-silent clip, peaking at up to 0.08 on the phone. That is above
  `SILENCE_PEAK` (0.001 in `tts/service.ts`), so a learner would get a faint clip instead of an error.
  Not compared against WASM. It is the same model, so it is probably not a regression.
- **Quality:** clip lengths match WASM to within 0.01 s. Energy above 5 kHz is 0.04–1.03 % native
  against 0.04–1.44 % WASM.
- **Size:** the statically linked Linux test binary was 36 MB, unstripped. On Android the two
  libraries add 26.6 MB uncompressed (`libonnxruntime.so` 22.2, `libsherpa-onnx-c-api.so` 4.3).

## What the measurements changed

- **Thread count is 2** on both devices. More threads were slower, so no per-device tuning is needed.
- **No text pre-filter is needed**, but a **length cap is**: the 5,000-character word peaked at 662 MB
  on the phone and took 264 s. Choose the cap from what `textPieces.ts` can actually produce.
- **The IPC probe was not run.** It needs a Tauri app on the phone, so it moved to the first APK below.

## Known traps (already investigated)

- **Crate.** `sherpa-onnx = "=2.0.1"` provides `OfflineTtsSupertonicModelConfig` and
  `generate_with_config`. Its build script downloads official archives with no checksum, and honours
  `SHERPA_ONNX_LIB_DIR` and `SHERPA_ONNX_ARCHIVE_DIR`.
- **Windows.** The crate picks `static-MT` archives, while Rust and whisper.cpp use the dynamic runtime,
  so linking is expected to fail. Official `static-MD-Release-lib` archives exist for x64 and ARM64.
  Not yet built: confirm the `.lib` names match the crate's list.
- **Android copy.** The crate copies its `.so` files only if the target directory's parent holds
  `tauri.conf.json`. `scripts/android.local.env` sets `CARGO_TARGET_DIR` outside the project, so here
  the copy is silently skipped and the APK would crash at launch.
- **Web Workers cannot call `invoke`,** so the native path cannot live in `tts.worker.ts` or the
  registry.
- **Android IPC.** Request bodies arrive as JSON number arrays. A raw response of 1 KB or more should
  arrive as an `ArrayBuffer`, because Tauri 2.11.5 lets its channel-fetch command use the custom
  protocol on Android (`scripts/ipc-protocol.js`, `src/ipc/channel.rs`). Read in source, not yet run.
- **Native failures kill the whole app, not a worker.** `SHERPA_ONNX_EXIT` is `_Exit`, the release
  profile is `panic = "abort"`, and the crate does `CString::new(text).unwrap()`, so a NUL in the text
  aborts.
- **The C++ needs the indexer path to end in `.bin`,** so keep upstream file names.
- **`DownloadCancel` is shared and resets per file.** Reusing it would let cancelling a voice stop
  Whisper and would lose a cancel that lands between files.
- **`Engine::transcribe` in `whisper.rs` takes its lock twice** and can race idle release. Do not copy
  that shape. Fixing Whisper is a separate ticket.
- **Clip cache keys do not include the engine,** so stored WASM clips replay after the switch. A/B
  tests need new sentences.
- **`adb shell` inside a `while read` loop swallows the list.** Use `adb shell -n`.

## Phase 1: build plumbing

New `scripts/sherpa-native-libs.sh <rust-triple>`, modelled on `scripts/sherpa-tts-assets.sh`, with
SHA-256s pinned from the GitHub release API (each asset has a `digest` field).

| Target | Archive | Wiring |
|---|---|---|
| Linux, macOS | `static-lib` | `SHERPA_ONNX_LIB_DIR` |
| Windows x64, ARM64 | `static-MD-Release-lib` | `SHERPA_ONNX_LIB_DIR` |
| Android | `android.tar.bz2` | `SHERPA_ONNX_ARCHIVE_DIR`, plus our own copy of only `libonnxruntime.so` and `libsherpa-onnx-c-api.so` into `jniLibs` |

- `scripts/android.sh` runs the script itself, because of the Android copy trap above.
- `scripts/android.sh` and `.github/workflows/android.yml` fail if `unzip -l` does not show both
  libraries in the APK. A missing one crashes the app at launch for everyone.
- `.github/workflows/release.yml`: add a triple per matrix entry, run the script, and run the bench on
  each runner with the model in a non-ASCII folder. Windows and macOS have no other evidence.
- Windows ARM64 is cross-built. If its bench cannot pass on a `windows-11-arm` runner, exclude the
  dependency by target and that one build keeps WASM.
- Local Linux desktop builds need no script: the crate's own download works there.

## Phase 2: Rust plugin (`src-tauri/plugins/speech`)

- `Cargo.toml`: `sherpa-onnx = "=2.0.1"` and tokio's `sync` feature.
- New `src/supertonic.rs`: an `Engine` holding `Mutex<Option<OfflineTts>>`, a use counter, its own
  download cancel flag and a download lock. `speak` holds one lock across load and generate, and
  touches the use counter at start and end, so idle release cannot free the model mid-run. Thread
  count is a named constant of 2, citing this measurement. Pass `None::<fn(&[f32], f32) -> bool>` as
  the callback.
- New `src/idle.rs`: moves `IDLE_RELEASE` and `schedule_idle_release` behind a small trait both engines
  implement.
- `src/models.rs`: allow the pinned Supertonic repository as a second source; a validated path under
  `models/supertonic-3/` keeping upstream file names; a `.part` suffix helper; cancel reset once per
  batch. Reuse `download` and `http_client`.
- `src/commands.rs`: `supertonic_status`, `supertonic_download` (all seven files, skips those present
  at exact size, combined progress over one `Channel`), `supertonic_cancel_download`, `supertonic_load`,
  `supertonic_speak`. File lists come from the caller, so `SUPERTONIC_MODEL_FILES` in
  `src/lib/languages/voices.ts` stays the only list.
- `supertonic_speak` returns `tauri::ipc::Response`: a little-endian `u32` sample rate, then `f32`
  samples. If the phone probe fails, switch to base64 in one function on each side.
- `src/error.rs`, `src/lib.rs`, `build.rs`, `permissions/default.toml`: register all of the above.
- New `examples/supertonic_bench.rs`, mirroring `examples/bench.rs` against the real engine.

**Crash safety:**

- Before FFI: strip NUL, validate language, style, speed and steps, and apply the length cap.
- Before `create`: every file must exist at its exact size. SHA-256 runs at download.
- A small counter file per app version is raised before native code and cleared after. Three
  unfinished runs in a row make `supertonic_status` report unusable and voices fall back to WASM,
  which stops a crash loop.

## Phase 3: TypeScript (`src/lib/speech/tts`)

The switch lives in the main-thread queue, which already owns ordering, listened-first selection and
the grace period.

- New `supertonic/native/nativeSupertonic.ts`, mirroring `stt/native/nativeEngine.ts`: `isUsable`,
  `missingFiles`, `prepare`, `cancelPrepare`, `speak`. Call `toWellFormed()` on the text, because a lone
  surrogate may leave an Android call unanswered and stall the queue (found by reading Tauri, not
  reproduced). Native only for `currentRuntime()` of `desktop` or `android`.
- Rename `local/LocalVoiceWorker.ts` to `local/LocalVoiceQueue.ts` (importers: `service.ts`, both
  model-lab pages, `speech/README.md`). One branch in `dispatchNext` after `this.inFlight = id`; native
  outcomes feed the existing `handle` as the same message types. `dispose()` also cancels a native
  download.
- `BaseTtsAdapter.ts`: export the duration and peak calculation. Move `limitPeak` from
  `SupertonicAdapter.ts` to `supertonic/peakLimit.ts`, so both paths process audio identically.
- New `local/installedVoiceAssets.ts`: `missingVoiceAssets(voice)` replaces the lookups in `isInstalled`
  (`stores/voiceLibrary.ts`) and `voiceCacheState` (`stores/languageData.ts`).

If phone memory peaks above about 1.2 GB with Whisper and Supertonic both loaded, make the two engines
exclusive on Android and skip `warmLocalVoices` there.

## Phase 4: docs and handoff

Move the measured numbers above into `docs/benchmarks/tts.md`. Update
`docs/architecture/platforms.md`, `docs/architecture/languages.md`,
`docs/architecture/supported-languages.md`, `README.md`, `src/lib/speech/README.md`, and the code
comments that describe WASM-only Supertonic. Update `.agents/handoff/rules/constraints.md`, the
Supertonic section of `references/known-issues.md`, and `memory/state.md`, `tasks.md`, `decisions.md`
and `last-session.md`.

## Verification

1. Rust unit tests for the validators and path rules; `supertonic_bench` matches the numbers above.
2. **First APK on the phone, before any TypeScript lands:** build with `scripts/android.sh build`, which
   signs with the release key and so updates the installed app in place. Confirm it launches with both
   libraries, and that a throwaway 1 MB `tauri::ipc::Response` arrives as an `ArrayBuffer`. Check the
   signature first. If an install would need the existing app removed, stop and ask.
3. `/model-lab/voices/` for all 31 languages inside the desktop and Android apps. If that page cannot
   be reached in a release-signed build, ask before installing anything that would replace the app.
4. Real practice flows, by ear. Use new sentences, because stored clips are not keyed by engine.

   | Instruction | Target | Proves |
   |---|---|---|
   | es | fr | non-English instruction |
   | ar | ja | right-to-left text, shorter pieces |
   | hi | ko | two non-Latin scripts |
   | es | fa | native and Piper mixed in one explanation |
   | en | zh | Piper target with a native explanation |

5. Ten-minute phone session with `dumpsys meminfo` and a thermal watch, with Whisper loaded too.
6. Failure cases: cancel between files, a truncated model file, and killing the app during speech three
   times to confirm the WASM fallback.
7. Web regression in muted Chromium, plus `bun run check` and `bun run build`. Check port 5173 first and
   reuse any running dev server (Tauri dev commands start one).
8. All CI runners green, with the bench on each.

## Costs and remaining risks

- The APK grows by about 27 MB, and desktop binaries grow by about 30 MB.
- Out-of-memory during native inference still kills the app; the counter only stops it repeating.
- Only one phone is available, so a 4 GB device stays untested.
- Windows and macOS get CI evidence only, never a real app run on this machine.

## Measuring kit

Not in the repo, and safe to delete once this ships. Everything is under
`/mnt/data/not_synced/dev-cache/native-bench/supertonic-gate/`: `kit/` (bench crate, test sentences,
hostile texts, the WASM baseline server), `web/` (the baseline page), `model/` (checksummed model) and
`results/` (raw numbers and clips). The numbers above are complete without it.
