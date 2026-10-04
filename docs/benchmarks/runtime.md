# Runtime, precision and browser measurements

Device, precision, memory and dependency behaviour. These are the measurements behind the hard
rules in `.agents/handoff/rules/constraints.md`; the rules reference this file instead of
repeating the numbers.

## Device: WASM, not WebGPU

WebGPU is available on the test machine (Intel gen-12lp adapter with `shader-f16`) and builds
sessions for both quantized precisions, but its numerics are wrong for quantized weights and it
is slower for int8:

| weights | WASM | WebGPU |
|---|---|---|
| whisper-base q4 | **9.6% WER, rtf 0.387** | 92.0% WER |
| whisper-base int8 | will not build | 68.8% WER, rtf 2.675 |

`DEFAULT_DEVICE` stays WASM. `VITE_STT_DEVICE=webgpu` is available for re-testing on other
hardware. Re-test per machine; do not assume.

## Quantization is a bandwidth lever, never a speed one

Browser WASM has no INT8 SIMD path (no VNNI, no ARM dot-product), so ORT-Web dequantizes back to
float on every matmul. 8-bit is smaller and slower:

| model | fp32 | q8 |
|---|---|---|
| MMS-TTS French | **rtf 0.53** | rtf 2.68 |

Policy: **fp32 on WASM, fp16 only on WebGPU, 8-bit only to save bandwidth.**

## Precision support matrix

| precision | WASM | WebGPU | note |
|---|---|---|---|
| fp32 | ✅ | ✅ | baseline |
| q4 | ✅ | ⚠️ loads but wrong | the only quantized precision that works correctly |
| int8 / uint8 / q8 | ❌ will not build | ⚠️ loads but wrong | the published exports are one broken artifact under several names |
| fp16 | ❌ | ✅ | no float16 path on WASM |

### Exact int8 failure

```
qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale:
model.decoder.embed_tokens.weight_merged_0_scale
for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear
```

The 8-bit exports carry a **4-bit** `embed_tokens` whose scale tensor is missing from the merged
decoder graph. `_int8`, `_uint8` and `_quantized` are all exactly 53.7 MB for whisper-base — the
same broken export under three names — and the newer `-ONNX` re-export fails identically despite
being 182 MB. `_q4` is genuinely 4-bit with correct scales and loads fine. Transformers.js v4
hardcodes `decoder_model_merged`, so the non-merged int8 decoder pair that would sidestep the
merge artefact cannot be selected through the public API.

**Re-test trigger:** a new Whisper export from onnx-community, or a Transformers.js release that
exposes the session map. Do it in a browser with a cold cache.

### Exact fp16 failure

```
Type (tensor(float16)) of output arg (/duration_predictor/RandomNormalLike_output_0)
does not match expected type (tensor(float))
```

## Downloads are bigger than the spec sheet (q4 keeps embeddings in fp32)

`q4` quantizes MatMul weights and leaves `embed_tokens` alone.

| | whisper-base | whisper-small |
|---|---|---|
| `embed_tokens` at fp32 | 106 MB | **159 MB** |
| actual q4 total | 142 MB | 299 MB |
| what a "4-bit" table predicts | ~60–75 MB | ~180–220 MB |

For whisper-small, **53% of the download is one fp32 embedding table**. The encoder, which has no
embeddings, *is* properly 4-bit: 352.8 MB → 66.2 MB. The only export that quantizes embeddings is
int8 — the broken one.

## ONNX Runtime isolation

Piper and Transformers.js must keep **separate** ONNX Runtime instances. Registering one at
`globalThis[Symbol.for('onnxruntime')]` makes Transformers.js adopt it via a branch that never
populates `supportedDevices`, breaking every model load:

```
Unsupported device: "wasm". Should be one of: .
```

Avoid `piper-tts-web` and `kokoro-js` as runtime dependencies too: each pins its own
onnxruntime-web and Transformers copies, which would put three Transformers copies and two ORT
versions in one page.

## Browser and machine gotchas

- **A Node test proves nothing about the browser.** `onnxruntime-node` loads q8 Whisper happily
  and scores an identical 7.2% WER; ORT-Web refuses the same file. Only a browser run counts,
  headful, with a cold cache.
- **The browser Cache API is per-origin.** Two dev-server ports (`:5173` and `:5174`) keep
  separate model caches, so switching re-downloads everything. Use one port.
- **`/tmp` is tmpfs (RAM-backed) on this machine.** Test browser profiles holding model weights
  cost real memory — over a gigabyte, easily.
- **Model loading and inference used to run on the main thread** and freeze the tab, badly enough
  that a Playwright driver could not click during a load. This is fixed for local STT by
  `src/lib/speech/stt/transformers/stt.worker.ts`; keep any new heavy work off the UI thread.

## Memory: Transformers.js holds ~2 GB for whisper-small q4 (2026-09-30)

Measured with `/stt-bench/` (summed PSS of the headless Chromium process tree): the browser sits
at ~0.4–0.7 GB before the model loads and ~2.3–2.5 GB while whisper-small q4 is loaded and
transcribing, i.e. roughly 1.7–1.9 GB attributable to a 299 MB download. whisper.cpp held the
same model family in ~0.2 GB but was rejected for speed (`stt.md`). The existing mitigation is
the STT worker's 90 s idle release, which frees the session between answers.
