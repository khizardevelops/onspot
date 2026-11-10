# Known Issues

Foundational technology limits that require replacement or architectural change to resolve.

## iOS PWA Limits (foundation built, device-verify pending)

The installable layer is in the web build but has not run on an Apple device. The user has no
iPhone/iPad; only a macOS VM on an external drive. Treat these as **verify on device** until the
brief's Phase 0 walk-through is done (`docs/prompts/ios-focused-pwa.md`).

- **No Apple hardware.** Real Safari/WebKit, iOS memory limits, launch images, status bar, silent
  switch and the home-screen install flow are unverified. Chromium iPhone/iPad emulation is not
  evidence for WebKit.
- **Storage can disappear.** Safari may delete script-writable storage after about seven days
  without use; a home-screen app is treated separately, and its storage is separate from Safari's.
  The install guide tells learners to install first and to export/restore.
- **No background work or Web Push.** iOS suspends the app when it leaves the screen, so model
  downloads, timers and recordings stop; reminders are in-app only. There is no server and no
  system notification for a closed app. The download-finished toast is the iOS signal.
  `notificationsSupported()` deliberately returns false on Apple touch devices, so Reminder
  Settings uses the in-app copy and does not request a system permission.
- **Local Whisper is probably too heavy.** Transformers.js `whisper-small` holds about 2 GB and is
  likely killed. Local Piper is much smaller. Keep the local download option but warn honestly; do
  not offer a 299 MB model that cannot run on the device.
- **No cross-origin isolation on Cloudflare.** `_headers` uses COOP
  `same-origin-allow-popups` (for the Google Identity Services popup) and COEP
  `credentialless`, so `crossOriginIsolated` is false and local WASM is single-threaded. Moving to
  `same-origin` needs a live Drive test; do not claim multi-threaded local inference.
- **Audio.** The Ring/Silent switch may mute playback; `navigator.audioSession.type`
  (`play-and-record` while recording, `playback` for read-back) needs a device check. WebKit's
  `MediaRecorder` containers, Opus playback, WebCodecs Opus encode/decode, autoplay after an async
  feedback request, and interruption/lock behaviour are all unverified.
- **Microphone permission** may be asked again on each launch of a home-screen app; if so,
  `PermissionsPrompt` copy must say it rather than looking broken.
- **Service worker updates cannot be tested with `bun run preview`.** A rebuild deletes
  `.svelte-kit/output` and Vite preview exits. Use a static server over `build/` for the update
  flow (the 2026-11-06 check did). This is a tooling limit, not a product defect.
- **Interaction details to check:** `scrollend` support in the card stack; ProMotion's default
  60 Hz script cap; `display-mode: standalone`/`navigator.standalone` detection on iPadOS (Mac UA
  + `maxTouchPoints`); safe areas in landscape/notch; keyboard covering fields; selection/callout
  for hover meanings; sheet/card gestures versus edge/home swipes; Back inside the installed app.
- **Cloudflare deployment and headers are live** at
  `https://onspot.khizardevelops.workers.dev` (root/`/history/` 200, manifest, service worker,
  `_headers`, offline). **Google Drive popup in the installed app, WebDAV CORS, Screen Wake Lock,
  Web Share files, export to Files and the splash/status-bar appearance** have not been run.
- **Workers asset cap:** the 26.5 MiB WebGPU-only ORT binary exceeds the 25 MiB per-file limit and
  is omitted by `scripts/cf-deploy.sh`; the 23.5 MiB WASM runtime is included. Local WebGPU is
  unavailable on this host; default local WASM is unchanged.
- **`cf` deployment shape:** `cf pages deploy` is disabled and `cf deploy` refuses SvelteKit. The
  live site is a Workers static-assets Worker (`cf deploy --prebuilt`), not the empty legacy Pages
  project `onspot-4k1.pages.dev`. The Pages-only `_redirects`/`wrangler.toml` were removed.

## Voice loudness: what leveling does not cover (2026-11-08)

- **Stored copies lose a little in Opus (32 kbps):** most voices 0.2–0.8 dB; Piper Tom 2 dB, because
  almost half his weighted loudness is treble that Opus at this rate keeps a third of. The first
  play (WAV) is exact; the stored replay is slightly quieter and duller. 64 kbps would keep it,
  at twice the size (`SPEECH_BITRATE`, `speech/audioFormat.ts`); not changed without the user.
- **Cloud clips are not leveled:** a streamed clip plays before it can be measured.
- **The Settings preview's limiter is the browser's compressor**, not a hard ceiling (it plays
  live); stored clips use the look-ahead limiter in `utils/peakLimiter.ts`.

## Languages offered without review (2026-11-08)

- 32 study languages (and Japanese) are offered at the user's request with nothing measured:
  Whisper small on learner speech, the default voices, and the on-device LLM's writing in them.
  Low-resource ones (Estonian, Latvian, Lithuanian, Slovenian) are the likeliest to disappoint.
- The support notices only know the providers' published lists (checked 2026-11-08) and nothing
  about a custom OpenAI-compatible server.
- Scripts other than Latin and Arabic use the device's fonts (Devanagari, Bengali, Hangul,
  Greek, Cyrillic, CJK); the UI faces bundle only their Latin subsets, so Latin-extended letters
  (Czech ř, Vietnamese tones) also come from a system face. Not checked on iOS or Android.
- The model can write a field in the wrong language when the two languages share a script.
  `couldBeWrittenIn` (`languages/textLanguage.ts`) catches what letters prove (wrong script;
  Urdu-only letters in Persian/Arabic; kana in Chinese; Ukrainian/Russian-only letters) and the
  follow-up is dropped then. Same-letter pairs (Spanish/Portuguese) are not caught. Takes stored
  before 2026-11-08 keep their follow-up as it was.

## Persian (cloud recognition) and RTL

- Persian recognition and correction have **no on-device stack** (`local: { stt: false, tts: true,
  correction: false }`); read-back can use Piper's Persian voices. A learner without a Groq key
  cannot record in Persian; the Processing rows say so. ElevenLabs does not speak Persian.
- Groq Whisper's Persian accuracy on learner speech is **not measured**. The first real take should
  be reviewed before claiming quality; the registry's approval line says this is cloud-only
  support, not a model-quality approval.
- Direction is decided per text (`directionForText`), so mixed content (an English sample under a
  Persian target, or a Persian word inside an English explanation) depends on correct `dir`
  attributes at each site. New target-language text should set `dir="auto"` or use `Transcript`.
- **One font per Arabic-script word:** letters from two fonts do not join. Noto Naskh Arabic is
  bundled (Arabic subset, no Latin) and backs every UI stack, so any Arabic-script text is drawn
  by it; `--font-arabic-script` (the same face) is for target words set on their own, with
  `dir`. Never put a face that lacks some Urdu letters (Vazirmatn was one candidate) ahead of it:
  Urdu explanations drew کہا as ک + o + ا when the system font lacked ہ and ے (2026-11-08).
- Bidi punctuation around inline chips (e.g. a Latin "or" page marker inside an RTL note) was not
  audited beyond the sample.

## Interface Scale and CSS `zoom`

- **floating-ui does not know CSS `zoom`** (1.8.0): it measures the reference and the window in
  zoomed px but the floating element's size in CSS px, and the `left`/`top` it returns are
  zoomed again. `utils/floatingZoom.ts` corrects this: `WordGloss` through `zoomedPlatform`, neo's
  menus, selects and tooltips through the `placedUnderZoom` middleware (`neo.ts` presets).
  **A neo floating surface must be portaled** (`portal: true`) for it to be right: inside a card,
  floating-ui reads the zoom as a scale on the offset parent and the correction applies it twice.
- **Off 100 %, neo's floating surfaces land on fractional device pixels** (`useFloating` rounds to whole
  CSS px, the zoom then scales them: 311 px is 388.75 at 125 %). Harmless in every measurement so far,
  but it is the one difference from 100 %, and Firefox is the user's browser: test there, not only Chromium.
- **Anything measuring with `getBoundingClientRect` and setting CSS lengths must divide by the
  zoom, and a binary search over px must use whole numbers:** `narrowestWidth.ts` looped forever
  on a fractional width (the page froze at 90 %).

- The global interface scale uses CSS `zoom` on `:root`. Chromium and WebKit support it; Firefox
  126+ does too, but older Firefox ignores it and the control would appear inert. Real Safari,
  Android WebView and the Tauri webviews are not device-tested.
- `zoom` scales `100vw`/`100dvh` themselves. Any new fixed overlay must use
  `--ui-vw`/`--ui-vh` (not raw viewport units) or it will overflow above 100%.
- `html` and `main` use `--ui-vh`; `main.under-window-bar` subtracts `--window-bar-height` after
  the division. The Tauri window bar path has not been run at 125–150%.
- Media queries still use the physical viewport, so the layout breakpoints do not switch the way
  browser zoom would; the app scales as an OS fractional-scale display, which is the requested
  behaviour.
- At 150% on a 390 px phone the first-visit iOS install card is capped and scrolls its body;
  other dialogs were not all exercised at that scale.

## Supertonic in the Browser (prebuilt sherpa-onnx WASM)

- **Escaped C++ exceptions are bare numbers.** The prebuilt uses JavaScript exception handling, so
  a failure inside onnxruntime/sherpa throws a pointer (e.g. `19949696`). `readableRuntimeError`
  (`supertonic/sherpaRuntime.ts`) turns it into a learner message and logs the C++ type; the
  exception's own message cannot be read reliably. A truncated model file produces
  `N3Ort9ExceptionE`; files are now checksum-verified on load.
- **One thread only.** The prebuilt runtime has no threads and the web build is not
  cross-origin isolated, so Supertonic at Supertone's reference 8 steps runs at rtf ~1.6 per sentence
  (unloaded), and an explanation, spoken in many short pieces, takes far longer than its audio (42 s
  for a six-piece one under memory pressure). 3–4 steps leave audible noise (the user: "under water");
  5 vs 8 is an open listening decision. Explanation latency is the cost to watch. Phones are slower; not measured on a device. Faster needs threads
  (cross-origin isolation, which fights the Google Drive popup, plus a threaded build) or the
  native sherpa-onnx engine in the Tauri apps (sherpa-onnx's Rust API has a Supertonic example).
- **Memory only goes back when the worker ends.** The prebuilt reserves a 512 MiB heap (mostly
  untouched pages) and `free()` never shrinks it. Two Supertonic voices measured ~262 MB of worker
  memory; a pair with a Piper voice is 300–490 MB. The proxy's 90 s idle shutdown is the release.
- **The Tauri apps use the same WASM path in their webview** until a native TTS engine exists.
  Untested in WebKitGTK, WKWebView and Android WebView.
- **No hosted samples.** Supertonic voices cannot be auditioned before the 145 MB download (the
  explanation-voice "Play sample" button only shows for Piper voices).
- **Licence:** Supertone's weights are OpenRAIL-M (use restrictions, attribution); the sherpa-onnx
  runtime is Apache-2.0 (its LICENSE is copied next to the served files).

## French TTS in the Browser: G2P Is the Bottleneck

Everything below was verified in headful Chrome before being accepted or rejected.

### The core problem: French grapheme-to-phoneme

`phonemizer` (the package kokoro-js depends on) ships an **English-only** eSpeak build:

```
Invalid language identifier: "fr". Should be one of:
en, en-029, en-gb, en-gb-scotland, en-us, en-us-nyc, gmw/en...
```

This single limitation is why Kokoro is English-only in the browser, and it blocked Piper too.
**`@diffusionstudio/piper-wasm`** carries the full espeak-ng-data (18MB, every language) and is
the only French G2P that works client-side here. Its assets are copied into
`static/piper-wasm/` (gitignored; restore with `npm i` + the copy step).

Call it with the input as a JSON **array** — a bare object aborts the module with an opaque
emscripten exception pointer and no stderr:

```js
mod.callMain(['-l', 'fr', '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])
```

It returns `phoneme_ids` already mapped through the voice vocabulary, so the `phoneme_id_map`
in each Piper config does not need to be applied by hand.

### Rejected: Kokoro-82M

Loads fine (92.4MB q8, no ORT conflict), but `kokoro-js` ships a **frozen, English-only voice
registry** — 28 voices, all `en-us`/`en-gb`. `ff_siwis` exists in the HF repo and downloads
(522,240 bytes) but assigning it into `tts.voices` silently fails. Its own VOICES.md grades
French **B- on <11 hours**, a single voice, warning of "weak G2P and/or lack of training data".
Also note `kokoro-js` bundles transformers 3.8.1, which predates the `q8f16` dtype, so the
86MB build is unreachable through it.

### Rejected: Matcha-TTS

**No French model is published anywhere.** k2-fsa has 25 repos and zero French TTS; the
sherpa-onnx maintainer's French models are all `vits-piper-fr_FR-*`. sherpa-onnx's French
option *is* Piper.

### Do not share one ONNX Runtime between Piper and Transformers.js

Registering ORT as `globalThis[Symbol.for('onnxruntime')]` makes Transformers.js adopt it, but
that branch never populates its internal `supportedDevices`, so every model load then fails:

```
Unsupported device: "wasm". Should be one of: .
```

Piper uses its own `onnxruntime-web` import (`src/lib/ort.ts`) and Transformers.js keeps its
own. Verified that both coexist in one page with no console errors.

### WASM quantization is a download-size lever, never a speed one

Browser WASM has no INT8 SIMD path (no VNNI / ARM dot-product), so ORT-Web dequantizes back to
float on every matmul. The 8-bit build is ~5x slower for a third of the download. Measurements:
[`docs/benchmarks/runtime.md`](../../../docs/benchmarks/runtime.md#quantization-is-a-bandwidth-lever-never-a-speed-one).
Use fp32 on WASM, fp16 only on WebGPU.

## Whisper Quantization: q4 Works, int8 Does Not

The full q4/int8 WASM-vs-WebGPU matrix is in
[`docs/benchmarks/stt.md`](../../../docs/benchmarks/stt.md#quantization-matrix-set1-only) and
[`docs/benchmarks/runtime.md`](../../../docs/benchmarks/runtime.md#precision-support-matrix).
Summary: q4 builds and is usable on WASM; int8/uint8/q8 will not build; WebGPU builds but returns
nonsense.

### Why int8 fails

```
qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale:
model.decoder.embed_tokens.weight_merged_0_scale
for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear
```

The 8-bit exports carry a **4-bit** `embed_tokens` whose scale tensor is missing from the
merged decoder graph, so ONNX Runtime Web cannot build the session. `_int8`, `_uint8` and
`_quantized` are all exactly 53.7MB for whisper-base — the same broken export under three
names — and the newer `-ONNX` re-export fails identically despite being 182MB. Counter to
intuition, `_q4` is *genuinely* 4-bit with correct scales and loads fine.

Not fixable from this side: Transformers.js v4 hardcodes `decoder_model_merged` for
speech-seq2seq (`sessions: () => ({ model: "encoder_model", decoder_model_merged: ... })`),
so the non-merged `decoder_model_int8.onnx` + `decoder_with_past_model_int8.onnx` pair — which
would sidestep the merge artefact — cannot be selected through the public API.

**Re-test trigger**: a new Whisper export from onnx-community, or a Transformers.js release
that exposes the session map. Do it in a browser with a cold cache.

### Why WebGPU stays off

WebGPU is available on this machine and builds sessions for both quantized precisions, but its
numerics are wrong for quantized weights (see
[`docs/benchmarks/runtime.md`](../../../docs/benchmarks/runtime.md#device-wasm-not-webgpu)).
`DEFAULT_DEVICE` therefore stays WASM; `VITE_STT_DEVICE=webgpu` is available for re-testing on
other hardware. Because every run is scored against `eval/set1`, a regression like this shows up
as a WER number rather than as a plausible-looking transcript.

## Moonshine Tiny FR Quality
- **Issue**: `onnx-community/moonshine-tiny-fr-ONNX` (27M params) produces very poor transcriptions on real-world microphone audio. The model card states it is a "proof of concept" with WER of 21.8% on clean audiobook data, but real-world performance is far worse.
- **Impact**: Not usable for actual speech recognition; only useful as a benchmark baseline.
- **Resolution**: Use Whisper models or wait for improved Moonshine fine-tunes.

## WebGPU Browser Support
- **Issue**: WebGPU is only fully supported in Chrome 113+. Firefox and Safari have limited or experimental support, and Chrome disables it after a GPU process crash.
- **Impact**: Previously fatal — adapters hardcoded `device: 'webgpu'` and Transformers.js throws `Unsupported device` when `navigator.gpu` is absent. Now handled: `engine.ts` probes for a real adapter and falls back to WASM.
- **Also**: ORT-Web's WebGPU numerics vary by driver, so WebGPU is opt-in (`VITE_STT_DEVICE=webgpu`) rather than the default. An evaluation tool should not silently change backends under the models it is scoring.

## Whisper 30-Second Context Window
- **Issue**: Whisper models have a fixed 30-second attention window. Audio longer than 30s requires chunked processing with overlap.
- **Impact**: Chunked ASR can introduce artifacts at chunk boundaries. The `stride_length_s: 5` overlap mitigates but doesn't eliminate this.
- **Resolution**: Inherent Whisper architecture limit. Consider using models with longer context windows (e.g., Distil-Whisper) for very long audio.

## Web: one tab at a time (OPFS SAH pool)
- sqlite-wasm's `opfs-sahpool` VFS holds exclusive OPFS access handles, so a second onspot tab
  (or a page whose predecessor is still unloading) gets `NoModificationAllowedError`.
- Mitigation (2026-10-03): `adapters/db/index.ts` retries a lock for ~3.5s, then throws
  "onspot is already open in another tab or window…"; the layout toasts it and Practice keeps it
  in its error box. Firefox-verified with two tabs; closing the other tab + reload recovers.
- A real fix is a takeover (BroadcastChannel asks the holder to `pauseVfs()`) — not built.

## Dev server can serve stale modules on the synced mount
- **Issue**: `.agents`/the project live under `/mnt/data/synced/...`. Vite's watcher can miss
  writes there, so a long-running `bun run dev` keeps serving the **old** module after an edit.
  Observed 2026-10-25: the `.svelte` file on disk had the new class, `svelte-check` passed, but the
  served module still had the old markup — which produced a false failing browser assertion.
- **Detection**: compare what the server has with the file, e.g.
  `curl -s http://localhost:5173/src/lib/components/settings/VoicePicker.svelte | grep -c <new-symbol>`
  against the file. Also check that port 5173 is not still held by an earlier instance
  (`ss -ltnp 'sport = :5173'`) before starting another.
- **Resolution**: restart the dev server after layout/markup edits and re-run the browser check
  before believing a failure. Never diagnose a UI bug from a single dev-server run.

## Browsers cannot read provider rate-limit headers
- **Issue**: Groq and OpenAI send `x-ratelimit-*` on every response but do not list them in
  `access-control-expose-headers` (checked 2026-10-30), so `fetch` in the browser build sees none of
  them. Groq never sends tokens/day or audio limits in headers at all.
- **Impact**: the web build's usage monitor counts this device's calls against Groq's published
  limits (labelled as such) and cannot see use from other devices or apps. The Tauri apps read the
  headers through the HTTP plugin.
- **Resolution**: provider-side only (exposing the headers), or routing calls through Tauri/a proxy.

- **Tauri plugin versions must match across npm and Rust (major.minor).** The Tauri CLI refuses to
  build otherwise. `@tauri-apps/plugin-http` and `@tauri-apps/plugin-opener` are pinned to the
  published Rust crates (2.7 / 2.5) in package.json (2026-10-31); bump both sides together.
