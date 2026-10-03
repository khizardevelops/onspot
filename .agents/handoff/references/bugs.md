# Bugs

Active defects that can be fixed within the current foundational technology.

## Fixed

### Restoring A Non-onspot `.sqlite` File Wiped The Database (2026-10-03)
- **Cause**: the worker imported any SQLite image, then migrations produced an empty schema.
- **Fix**: `sqlite.worker.ts` `checkBackup` requires the onspot tables + `integrity_check` before
  replacing anything; the user gets "not an onspot backup, nothing was changed".
- **Proof**: Chromium: foreign file rejected with 6 sessions intact; export→import round trip kept all.

### Web SQLite Restore Failed With `Unknown write() failure.`
- **Symptom** (Zen/Firefox report): after choosing a `.sqlite` backup and confirming, the restore
  toast showed `Unknown write() failure.` and the data was not replaced.
- **Cause**: the web worker imported the backup with `SAH.pool.importDb('/onspot.db', bytes)`.
  That path writes the whole image with one large
  `FileSystemSyncAccessHandle.write()` (and never truncates); sqlite-wasm's SAH `xWrite` guard
  throws `Unknown write() failure.` when that write comes back short. Some Firefox-family builds
  short-write the large buffer even though ordinary page-sized SQLite writes succeed all day.
- **Fix**: write the backup through SQLite itself. The worker deserializes the image into the
  connection's in-memory main database (`sqlite3_deserialize`), `pool.unlink('/onspot.db')`,
  rewrites the file with `VACUUM INTO` (normal VFS write path), and reopens it. No large raw
  OPFS write remains; `init()` still migrates older backups because `VACUUM INTO` preserves
  `schema_migrations`.
- **Proof**: Playwright Firefox against the user's real backup — table-for-table parity
  (`5|11|14|14|16|14`), `pragma integrity_check` ok, no orphaned attempts, and a hand-built v5
  database imports then backfills `prompts.language='fr'` via migration v6.
- **Files**: `sqlite.worker.ts`

### The SQLite Restore Confirmation Trapped The User
- **Symptom** (Firefox report): picking a `.sqlite` file showed “Replace this device’s
  database?”, and the message would not go away — even after clicking **Replace database** — so
  the app had to be reloaded. After reloading, the backup had not been imported.
- **Cause**: bits-ui 2.19’s `AlertDialog.Action` deliberately does not close the dialog (only
  `Cancel` does). On the success path Settings navigated to History and hid the modal, but an
  error path (or the History empty-state flow) left it open forever. The user’s import had failed
  and the error toast was hidden behind the modal they could no longer dismiss.
- **Fix**: `RestoreDatabaseButton.restore()` closes its bound `confirmOpen` before running, and
  VoicePreview’s regenerate dialog closes `regenerateOpen` the same way. The dialog now always
  dismisses and the toast (success or failure) is visible.
- **Proof**: Playwright Firefox 155 with the user’s real backup — dialog closes on success and on
  a rejected file, 5 sessions restore, a failed import leaves the data intact (7/7); Chromium
  suites 19/19 and 8/8.
- **Files**: `RestoreDatabaseButton.svelte`, `VoicePreview.svelte`

### Refresh Showed An Empty Practice Screen Despite Persisted Sessions
- **Symptom**: sessions existed in SQLite and appeared in History, but reloading/restarting the
  app returned Practice to a blank draft; a silently incremented Vite port could also expose a
  genuinely fresh OPFS database with the same empty appearance.
- **Cause**: `initPractice()` only opened SQLite and seeded prompts. Its in-memory store was never
  rehydrated from `listSessions()`/`openSession()` on a new JavaScript context. Vite was not using
  `strictPort`, and History did not catch DB startup errors, so three different states looked empty.
- **Fix**: boot restores the newest saved session, Vite is pinned to strict ports, and History now
  separates Loading / load failure with Retry / truly empty storage with direct backup restore.
  Both restore surfaces hydrate Practice immediately. Removed eager `pagehide`
  worker termination, which could kill writes or leave a bfcache-restored singleton with a dead
  worker.
- **Proof**: a persisted 5-session/11-attempt profile restored the latest two-take session after
  reload and a full Chromium restart; History still listed all five sessions with no page errors.
- **Files**: `stores/practice.ts`, `adapters/db/index.ts`, `routes/history/+page.svelte`,
  `vite.config.ts`

### Writing In `docs/` Reloaded The Dev App
- **Symptom**: typing in `docs/*.md` triggered a full page reload of the running dev app, losing
  in-page state, even though `docs/` is never imported by app code.
- **Cause**: Tailwind v4's Vite plugin scans the whole project root for class candidates
  (including Markdown) and registers every scanned file as a build dependency of `app.css`.
  Vite then maps a change in that file to the CSS module, finds no HMR boundary, and sends a full
  reload (logged as `page reload docs/...`).
- **Fix**: exclude non-app content from Tailwind's scan in `src/app.css` with
  `@source not '../docs'` plus `.agents`, `eval` and `repomix`. App code (`src/`) is still
  scanned, so utility classes keep working. A dev server started before the fix keeps the stale
  watcher registrations and must be restarted once.
- **Files**: `src/app.css`

### Long Cards Flipped Away While Being Read
- **Symptom**: expanding the word breakdown on a long take and scrolling down through it made the
  card rotate/curve off-screen. The card expanded visually but the conveyor kept treating the
  card's exit progress as if it were short.
- **Cause**: the exit view timeline (`animation-range: exit 0% exit 100%`) is anchored to the
  card's box. For a card taller than the viewport, the exit range is already part-way through as
  soon as it is on screen, so ordinary scrolling inside it maps to heavy `rotateX`/fade.
- **Fix**: cards taller than `max(480px, 75% viewport)` get a JS-applied `tall` class that
  disables the conveyor animation (`.attempt-slot:global(.tall)`), so they scroll flat. Every
  slot is `ResizeObserver`-watched; the callback only re-evaluates the card whose size changed.
  The rAF fallback skips tall slots too.
- **Svelte trap**: a plain `.attempt-slot.tall` selector is pruned because the class is added at
  runtime; the selector must be `:global(.tall)` on the scoped parent.
- **Files**: `AttemptStream.svelte`

### Feedback Tabs And Mode Switch Looked Unselected
- **Symptom**: "all/errors/warnings/suggestions — all has the same colour when selected and
  unselected"; the Exam/Casual switch was equally bland.
- **Cause**: bits-ui's Tabs trigger exposes its state as `data-state="active|inactive"`, but the
  shadcn base classes and our custom classes targeted `data-active:`. That variant never matched,
  so the selected pill had a transparent background exactly like the unselected ones.
- **Fix**: selected styling now targets `[data-state=active]` (`data-[state=active]:` in markup).
  Each severity gets its own tint; `All` is a high-contrast neutral pill. Equal four-column grid
  with important utilities also fixed the `All` column being wider than the rest.
- **Files**: `FeedbackPanel.svelte`, `routes/+page.svelte`

### Piper Multi-Speaker Voices Failed With "input 'sid' is missing in 'feeds'"
- **Symptom**: `Piper UPMC (F, medium)` synthesized nothing: `[Failed: input 'sid' is missing in 'feeds'.]`
- **Cause**: French Piper voices are not structurally interchangeable. `siwis` and `tom` are single-speaker, but `upmc` has **2** speakers (jessica, pierre) and `mls` has **125** — those graphs declare an extra `sid` (speaker id) input. The adapter only ever fed `input`, `input_lengths` and `scales`.
- **Fix**: feed `sid` when `session.inputNames` contains it, taking the id from the card's speaker selector. Single-speaker graphs reject the extra feed, so it is conditional, not unconditional.
- **Files**: `PiperAdapter.ts`

### One Card Per Variant Instead Of Per Model
- **Symptom**: eight TTS cards, five of which were the same model at different voices, two the same model at different precision.
- **Fix**: one card per model; voice, speaker and quantization are a config section on the card. Changing any of them swaps weights, so the adapter disposes its session and returns to `Unloaded`. Sample rates also vary per voice (16/22/44 kHz), so `config.sampleRate` is refreshed on load rather than hardcoded.
- **Files**: `PiperAdapter.ts`, `MmsTtsAdapter.ts`, `WebSpeechTtsAdapter.ts`, `tts/registry.ts`, `TtsLab.svelte`, `types.ts`

### Every Model Froze At 95% While Preloading
- **Symptom**: "i try preloading all the models, each one gets stuck at 95%." Reproduced in headful Chrome: all three ONNX cards sat at `⏳ Loading... 95%` with the bar at 95% while the browser cache held only 107MB — whisper-base alone is 291MB, so nothing was close to finished.
- **Cause**: self-inflicted, in the first version of `createDownloadProgress`. Two mistakes compounding:
  1. The percentage counted **every** file. `config.json`, `tokenizer.json` and friends are a few KB and complete almost instantly, so `loaded / total` hit 1.0 before a single byte of the 209MB decoder had arrived.
  2. The ratio was then clamped monotonic to stop it running backwards. When the real weights started and the denominator grew, the clamp refused to let the figure fall — so it locked at the 95% cap and never moved again for the entire download.
- **Fix**: compute the percentage over weight files only (>= 1MB), and drop the monotonic clamp. Also suppress reporting entirely while any initiated file has neither a known size nor a completion — otherwise a cached encoder finishing before the decoder announced itself briefly showed `99% - Preparing inference session...`.
- **Second half of the symptom**: the card markup rendered only `{model.progress?.progress}%` and never `model.progress.status`, so every message the tracker produced was invisible. The card now shows `47% - Downloading 138 / 293 MB`, and the bar runs a compositor-driven shimmer past 95% so session creation does not look like a hang.
- **Files**: `engine.ts`, `ModelSelector.svelte`

### Progress Bar Ran Backwards During Model Download
- **Symptom**: "whisper base never preloads, the progress bar increases and decreases." The bar filled to 100%, snapped back to 0, filled again, then jumped backwards on each file completion.
- **Cause**: Every adapter forwarded `info.progress` straight to the UI. Transformers.js reports progress **per file**, and a Whisper repo is several files (encoder, merged decoder, tokenizer, config), so each one ran its own 0-100. The `status === 'done'` branch made it worse by hardcoding 80, and `status === 'download'` by hardcoding 25 -- both could drop the bar from a higher value.
- **Fix**: `createDownloadProgress()` in `engine.ts` accumulates bytes across all files and reports one figure, clamped monotonic (the denominator still grows when a new file announces its size). Shows `Downloading 124 / 291 MB`, then `Preparing inference session...` once bytes land, since session creation is not instant at this size.
- **Files**: `engine.ts`, all three ONNX adapters

### The UI Advertised 77MB While Downloading 291MB
- **Symptom**: whisper-base appeared to never finish loading.
- **Cause**: `quantizedSize` in the registry advertised "~77 MB" for whisper-base and "~41 MB" for whisper-tiny. Those are the **q8** sizes, but the adapters download **fp32** — encoder 82.5MB + merged decoder 208.5MB = **291MB**. The card had been describing a precision the code never fetched, so the load looked stuck when it was merely 3.8x bigger than promised.
- **Fix**: labels now state the real fp32 download (`~291 MB (fp32)`), and the progress bar reports actual MB.
- **Attempted and reverted**: defaulting to q8 to make the download match the old label. q8 loads in `onnxruntime-node` with an identical 7.2% WER, but ONNX Runtime **Web** rejects it with the same `TransposeDQWeightsForMatMulNBits` error as q4/bnb4 — see known-issues.md. The 291MB download stands until ORT-Web can load quantized weights.
- **Files**: `engine.ts`, `registry.ts`, `MoonshineTinyFrAdapter.ts`

### Model Cards Showed "Unloaded" After A Successful Benchmark
- **Symptom**: run a benchmark, get results, but every model card still reads `Unloaded` with a `Pre-load` button — even though the models are loaded and sitting in memory.
- **Cause**: `BenchmarkRunner` loads models through `sttRegistry.runTranscription()`, while `ModelSelector` only calls `refreshModels()` from its own handlers (mount, pre-load click, custom-model add/remove). Nothing told it the registry had changed.
- **Fix**: `ModelSelector` exports `refresh()`; `App.svelte` binds the component and calls it from `handleResultsReady`.
- **Why it mattered more after the q4 work**: the ready badge now carries the resolved backend and precision (`✓ Ready · wasm / q4`), which is how you tell whether an RTF number is comparable. Stale cards meant that badge never appeared in the normal flow.
- **Files**: `ModelSelector.svelte`, `App.svelte`

### Header Badges Were Biased And Factually Wrong
- **Symptom**: caught in a screenshot of the running app, not in code review.
- **Cause**: the header carried a hardcoded `Moonshine ONNX` badge (the same favouritism as the model cards, missed on the first pass), and a second badge reading `⚡ WebGPU Ready` whenever `'gpu' in navigator` — browser *capability*, not what runs. It claimed WebGPU while every model was executing on WASM.
- **Fix**: Moonshine badge removed; the backend badge now calls `detectDevice()` and shows the resolved device with the dtype, e.g. `⚙️ WebAssembly · fp32`. This matters beyond cosmetics — RTF is not comparable across backends, so the page has to say which one produced the numbers.
- **Files**: `Header.svelte`

### Moonshine Was Pre-Selected And Visually Favoured
- **Symptom**: "the moonshine tiny is preselected by default. do not select or bias any choice by default."
- **Cause**: `selectedModelIds` / `selectedIds` were seeded with `['moonshine-tiny-fr']`; `ModelSelector` gave that card a `featured` border and a "⭐ User Goal Model" ribbon; `ResultsDisplay` gave its result card a `highlighted` border and a "Moonshine Model" badge; `registry.ts` called it "Primary Model requested by user". `removeCustomModel` also force-selected `models[0]` whenever the selection emptied.
- **Why it matters**: this is a comparison tool. A default pick and a gold star put a thumb on the scale before the user chooses -- and it favoured the *worst* of the three models (64.8% WER vs whisper-base's 7.2%).
- **Fix**: selection starts empty, all per-model styling removed, registry comments neutralised, and an empty selection is now allowed to stay empty. The run button reads "Select a model to benchmark" at zero.
- **Files**: `App.svelte`, `ModelSelector.svelte`, `ResultsDisplay.svelte`, `BenchmarkRunner.svelte`, `registry.ts`

### Adding An Eval Set Required Editing Source
- **Symptom**: `eval/` is manually curated test data, but adding `eval/set2` meant copying a file into `public/samples/`, pasting its transcript into `audio.ts` as a string constant, and adding an array entry.
- **Cause**: Vite only serves `public/`, so the previous session copied the clip and inlined the transcript -- which also duplicated the transcript in two places that could drift.
- **Fix**: `import.meta.glob` with root-relative patterns discovers `/eval/*/*.{mp3,wav,...}` and `/eval/*/*.txt` at build time. Drop in a folder and it appears, scored. `public/samples/` deleted; `eval/set1/transcript.txt` is now the single source.
- **Files**: `audio.ts`

### Long Audio Lost Its First 25 Seconds
- **Symptom**: Transcripts of clips longer than 30s were missing large spans of speech. On `eval/set1` whisper-base scored 32.8% WER with the opening quarter of the conversation simply absent.
- **Cause**: `chunk_length_s: 30` + `stride_length_s: 5` without `return_timestamps`. Transformers.js then merges adjacent chunks by searching for the longest common token sequence in the overlap; on real speech it picks a wrong alignment and drops a whole chunk. Adding timestamps helped (21.6%) but duplicated the overlap, and the score swung between 8.0% and 63.2% across a two-second change in stride. `stride_length_s >= chunk_length_s / 2` gives a step size of 0 and loops forever.
- **Fix**: Replaced pipeline chunking with sequential long-form decoding (`whisperTranscribe` in `engine.ts`): decode a 30s window, seek to the end of the last segment Whisper emitted a timestamp for, decode again from there. No overlap, no stride to tune. 7.2% WER and roughly 2x faster.
- **Files**: `engine.ts`, `WhisperAdapter.ts`, `CustomHFAdapter.ts`

### Hardcoded WebGPU Device Crashed Non-WebGPU Browsers
- **Symptom**: `Error: Unsupported device: "webgpu". Should be one of: wasm.` before any model loaded.
- **Cause**: Every adapter passed `device: 'webgpu'` unconditionally. Transformers.js only registers the webgpu backend when `navigator.gpu` exists, and throws otherwise.
- **Fix**: `detectDevice()` probes for an actual GPU adapter and `createASRPipeline()` retries on WASM if the GPU backend fails to initialise. WASM is now the default because ORT-Web's WebGPU numerics vary by driver, which an evaluation tool should not trust silently; opt in with `VITE_STT_DEVICE=webgpu`.
- **Files**: `engine.ts`, all adapters

### Preset "French Samples" Were Sine Tones With Invented Transcripts
- **Symptom**: Benchmarks run straight after page load reported meaningless error rates.
- **Cause**: `generateSyntheticTestAudio` emits 220/440/880Hz harmonics, but each preset carried a French reference transcript. The app auto-selected one of these on mount.
- **Fix**: Presets are now the real `eval/set1` recording with its human transcript, plus an explicitly unscored tone entry for checking the pipeline end to end.
- **Files**: `audio.ts`, `AudioInputSection.svelte`

### Reference Text Followed The Wrong Audio
- **Symptom**: WER/CER and the word diff scored uploads and recordings against a previous clip's transcript.
- **Cause**: `processFile`/`stopRecording` re-dispatched the stale preset `referenceText`. Separately `referenceText` was passed to `BenchmarkRunner` unbound, so what the user typed never reached `ResultsDisplay`.
- **Fix**: Clear reference text when the audio source changes; `bind:referenceText` in `App.svelte`.
- **Files**: `AudioInputSection.svelte`, `App.svelte`

### WER Inflated By Typographic Apostrophes
- **Symptom**: Every French contraction counted as an error even when transcribed correctly.
- **Cause**: `normalizeFrenchText` kept `'` (U+0027) but replaced U+2019 with a space, so the reference "c’est" normalized to "c est" while the hypothesis "c'est" stayed one token.
- **Fix**: Fold U+2019/U+02BC/U+00B4/backtick to U+0027 before normalizing.
- **Files**: `metrics.ts`

### Resampling Had No Anti-Alias Filter
- **Symptom**: None measurable on `eval/set1` -- flagged as a correctness issue, not a cause of the bad transcripts.
- **Cause**: Audio was decoded at the hardware rate then replayed through an `AudioBufferSourceNode` into a 16kHz `OfflineAudioContext`. That node resamples by linear interpolation, folding everything above 8kHz back into the speech band.
- **Fix**: Decode directly into a 16kHz `OfflineAudioContext` so the browser's own resampler does the conversion; explicit channel downmix; windowed-sinc fallback for the `AudioBuffer` input path.
- **Files**: `audio.ts`

### Moonshine Ignored chunk_length_s
- **Symptom**: Moonshine returned a jumble of phrases for a 63s clip -- 91.2% WER.
- **Cause**: The pipeline's chunking applies to Whisper-family models. Passing `chunk_length_s` to Moonshine produces byte-identical output, so the whole 63s clip went in at once against a model trained on <= 30s.
- **Fix**: `windowedTranscribe` splits into fixed 30s windows in the adapter; token budget is now sized per window at Moonshine's documented 6.5 tokens/s. 91.2% -> 64.8% WER. Still a weak baseline.
- **Files**: `engine.ts`, `MoonshineTinyFrAdapter.ts`

### ONNX Quantization Incompatibility (TransposeDQWeightsForMatMulNBits)
- **Symptom**: `Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale`
- **Cause**: Transformers.js v3 auto-selected `q4`/`bnb4` quantized ONNX weights that ONNX Runtime Web doesn't support in browser.
- **Fix**: Explicitly set `dtype: 'fp32'` in the pipeline configuration for all adapters.
- **Files**: `MoonshineTinyFrAdapter.ts`, `WhisperAdapter.ts`

### Browser Freezing During Inference
- **Symptom**: UI completely locks up when running transcription, especially on Whisper Base (74M params).
- **Cause**: ONNX Runtime running on CPU (WASM) in the main thread.
- **Fix**: Set `device: 'webgpu'` to offload inference to GPU.
- **Files**: `MoonshineTinyFrAdapter.ts`, `WhisperAdapter.ts`
- **Superseded**: hardcoding webgpu broke every browser without it. WASM is the default again, now with `numThreads` set when the page is cross-origin isolated. The product fix is complete: local STT loading and inference run in `src/lib/workers/stt.worker.ts`.

### Long Audio Tokenization Crash
- **Symptom**: `Error: token_ids must be a non-empty array of integers.`
- **Cause**: Audio files longer than 30 seconds exceed Whisper's context window, producing empty/invalid token arrays.
- **Fix**: Added `chunk_length_s: 30` and `stride_length_s: 5` to Whisper transcription options for automatic chunked ASR.
- **Files**: `WhisperAdapter.ts`, `CustomHFAdapter.ts`
- **Superseded**: this fix stopped the crash but silently dropped audio. See "Long Audio Lost Its First 25 Seconds" above.

### ModelSelector Prevents Deselection
- **Symptom**: Cannot uncheck the last selected model; clicking it does nothing.
- **Cause**: Guard `if (selectedIds.length > 1)` prevented deselection when only one model was selected.
- **Fix**: Removed the guard to allow empty selections.
- **Files**: `ModelSelector.svelte`

### Inference And Model Loading Ran On The Main Thread
- **Symptom**: the tab is unresponsive while a model loads or a transcription runs. Severe enough that in a Playwright run against the real UI, the driver could not click the second "Pre-load" button — its actionability checks time out because the page never yields. Preloading several models makes it much worse.
- **Cause**: `createASRPipeline` ran in the page context. ORT-Web uses worker threads for compute kernels when cross-origin isolated, but the pipeline's own JS — feature extraction, the decode loop, and ONNX session construction — stayed on the main thread.
- **Fix (product)**: `src/lib/workers/stt.worker.ts` owns the pipeline, download progress and the decode loop; `src/lib/adapters/stt/WorkerWhisperAdapter.ts` is the main-thread proxy and moves PCM in by transfer. Browser-verified that the worker imports Transformers.js and relays real download progress (`31 / 302 MB`) with no console errors. See `state.md` and `tasks.md`.
- **Files**: `src/lib/workers/stt.worker.ts`, `src/lib/adapters/stt/WorkerWhisperAdapter.ts`, `src/lib/adapters/stt/service.ts`

## Fixed 2026-09-25: Firefox `.sqlite` restore "Unknown write() failure" + data loss on failure
- **Symptom**: restore works in Chrome, fails in Firefox/Zen with `Unknown write() failure.`.
- **Cause**: Firefox per-site (eTLD+1: all localhost ports) best-effort quota, sized from free disk;
  at the limit OPFS `write()` returns short. Worse, the old DB was unlinked before the write, so a
  failed restore emptied the database.
- **Fix**: in-memory rollback + rescue download in the worker; persist() requested from the confirm
  click; quota pre-check with an actionable `StorageFullError`. See last-session 2026-09-25.
