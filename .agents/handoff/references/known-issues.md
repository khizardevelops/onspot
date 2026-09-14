# Known Issues

Foundational technology limits that require replacement or architectural change to resolve.

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
