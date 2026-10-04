# Speech-to-Text (STT) benchmarks

Whisper-family and Moonshine results, measured in a real browser on WASM unless stated
otherwise. See [`runtime.md`](./runtime.md) for the device/precision matrix behind these
numbers, and [`../research/model-vetting.md`](../research/model-vetting.md) for the method.

## Eval sets

| set | content | words |
|---|---|---|
| `eval/set1` | 63s French conversation (the original clip) | — |
| `eval/set2`, `eval3` | added later, same method | — |
| **aggregate** | `set1 + set2 + set3` | **345** |

At 345 words, one word is ~0.29% WER, so small differences are noise. Aggregate WER is
total-errors / total-words, never a mean of per-clip rates.

## Decision table (aggregate, 345 words)

| model | dtype · download | aggregate WER | per-clip (set1 / set2 / set3) | rtf | verdict |
|---|---|---|---|---|---|
| **`onnx-community/whisper-small`** | q4 · 299 MB | **5.5%** | 5.6 / 6.8 / 4.5% | 1.48 | **The pick.** Best and most stable; slower than real time, accepted for transcript quality. |
| `onnx-community/whisper-base` | fp32 · 291 MB | 9.9% | 4.8 / 12.5 / 12.9% | 0.51 | Fastest; use only if download size does not matter and speed does. |
| `onnx-community/whisper-base` | q4 · 142 MB | 11.0% | 7.2 / 13.6 / 12.9% | 0.42 | Half the bytes of base fp32 for ~1 point of WER. |
| `onnx-community/whisper-tiny` | fp32 · 152 MB | 21.6% | measured on `set1` only | — | Weak; re-run on the full set before trusting the figure. |
| `onnx-community/moonshine-tiny-fr-ONNX` | fp32 · 109 MB | 64.8% | measured on `set1` only | — | Loads and runs correctly, but the model itself is weak (its own card calls it a proof of concept). |

## Quantization matrix (set1 only)

Measured in headful Chrome against `eval/set1`, on an Intel gen-12lp adapter with `shader-f16`,
cold cache. fp32 baseline on this run: **7.2% WER / 2.4% CER / rtf 0.21**.

| repo | dtype | device | result |
|---|---|---|---|
| `onnx-community/whisper-base` | q4 | wasm | **9.6% WER, 4.6% CER, rtf 0.387, 142 MB — usable** |
| `onnx-community/whisper-base` | q4 | webgpu | loads, **92.0% WER — nonsense** |
| `onnx-community/whisper-base` | int8 | wasm | will not build a session |
| `onnx-community/whisper-base` | int8 | webgpu | loads, **68.8% WER, rtf 2.675 — wrong *and* 12x slower** |
| `onnx-community/whisper-base-ONNX` | int8 | wasm | will not build a session (identical error) |
| `onnx-community/whisper-small` | q4 | wasm | **8.0% WER, 2.9% CER, rtf 1.769, 299 MB — usable but slower than real time** |

The exact int8/fp16 build errors and why they are unfixable from this side are in
[`runtime.md`](./runtime.md) and `.agents/handoff/references/known-issues.md`.

## Long-form decoding

Transformers.js' own chunking dropped audio; sequential windows fixed it.

| method | WER on `set1` | notes |
|---|---|---|
| `chunk_length_s: 30` + `stride_length_s: 5` (overlap merge) | 32.8% | lost the first ~25s of a 63s clip; the merge picks a wrong alignment and drops a whole chunk. Adding timestamps gave 21.6% but duplicated the overlap. |
| same, stride swept ±2s | 8.0%–63.2% | the score swings wildly with a 2-second stride change. `stride >= chunk/2` never terminates. |
| **sequential 30s windows seeking to the last emitted timestamp** | **7.2%** | no overlap, no stride, ~2x faster. **Current implementation.** |

## One-clip trap

| model | `set1` only | across 3 clips |
|---|---|---|
| whisper-base fp32 | 4.8% | **9.9%** |
| whisper-small-cv11-french | **2.4%** (best single clip) | **21.7%** (worst aggregate) |

The "best" model on one clip was the worst overall. This is why no ranking is recorded from a
single clip.

## Rejected STT candidates

| candidate | why | exact failure / evidence |
|---|---|---|
| `whisper-small-cv11-french` and French fine-tunes generally | best on one clip, catastrophic overall | 2.4% on `set1`, **21.7% aggregate**; truncates 24 of 88 words, emits filler dots, "Montpellier" → "mon pilier". Fine-tuned on Common Voice read speech; collapses on multi-speaker conversation. |
| `whisper-large-v3-turbo` / distilled large | cannot fit a browser budget | distillation shrinks the **decoder**; turbo is **759 MB at q4**, its encoder alone 425 MB. |
| `bofenghuang` French distils | no ONNX at all | `-distil-dec2/4/8/16` ship PyTorch only; community forks are CTranslate2 / GGML, which Transformers.js cannot load. |
| `Xenova/*` mirrors of MMS/Whisper | missing files, and the present ones fail | `encoder_model_int8.onnx` returns **404**; the `uint8` pair that exists fails with the identical `TransposeDQWeightsForMatMulNBits` error (separate export, different SHA256). Use `onnx-community/*` + `dtype: 'q4'`. |
| OpenVINO exports (e.g. `whisper-small.en-int8-ov`) | wrong runtime, wrong language | ships `.xml`/`.bin` OpenVINO IR, not ONNX; that repo is also English-only (`vocab_size: 51864`). |
| `optimum-cli export onnx --quantize q4` | not a real flag | no `--quantize` on that subcommand; quantization is a separate step. |

## Provenance note

The two STT runs disagree on `set1`: the aggregate run records whisper-base q4 at 7.2% and
whisper-small q4 at 5.6% on `set1`, while the older single-clip quantization matrix records
9.6% and 8.0%. They are different dates/decoders, not a transcription error. The **three-clip
aggregate is the decision basis**; the single-clip matrix is retained only for the q4/int8
diagnostic. Re-run both in a browser with a cold cache before treating either as current.

## whisper.cpp vs Transformers.js (2026-09-30) — rejected

Asked because Transformers.js/ONNX was suspected of doubling RAM/disk versus GGUF-style formats.
(`@wllama/wllama` was ruled out first: it is llama.cpp and runs GGUF *LLMs* only — not Whisper,
not Piper — and onspot has no local LLM.) whisper.cpp ran in the browser through
`@transcribe/shout` 1.0.7 (MIT, SIMD + pthreads, Dec 2025 build), fed 16 kHz PCM directly,
`lang: 'fr'`, 2 threads (the same budget ORT gets). Harness: `/stt-bench/` driven by headless
Chromium 1243, one engine per fresh browser, summed PSS of the browser process tree sampled every
200 ms. Machine was under load (an Android emulator was running, swap in use), so rtf is worse
than the table above for every engine — compare the columns, not against older runs.

| engine | download | WER eval2 (88 w) | aggregate WER (345 w) | rtf eval2 | browser PSS while loaded |
|---|---|---|---|---|---|
| **Transformers.js whisper-small q4** (current) | 299 MB | 6.8% | **5.5%** (reproduced) | **1.81** | ~2.3–2.5 GB |
| whisper.cpp `ggml-small-q5_1` | 190 MB | 9.1% | not finished | 14.6 | ~0.6 GB |
| whisper.cpp `ggml-small-q8_0` | 264 MB | 6.8% | not run (probe) | 22.7 | ~0.6 GB after load |

**Verdict: keep Transformers.js.** whisper.cpp does use far less RAM and a smaller download, and
q8_0 matches accuracy, but in WASM it is 8–12x slower: a 60 s answer would take 15–20 minutes.
Both threads were confirmed at ~100% CPU, so it was not a threading misconfiguration. It also
needs `SharedArrayBuffer`, which the Android WebView never gets (not cross-origin isolated).
The PSS figures are approximate (swap was in use, and PSS excludes swapped pages); the load-time
whisper.cpp peak (~1.5 GB) is inflated by the harness holding the fetched blob.

## whisper.cpp + ggml WebGPU vs Transformers.js (2026-10-04) — desktop pass, Android blocked

Branch `spike/whisper-webgpu`. whisper.cpp (master `60c0be6`) built with Emscripten 6.0.11,
`-DGGML_WEBGPU=ON` (Dawn `emdawnwebgpu`, JSPI) via `tools/whisper-webgpu/build.sh`; model
`ggml-small-q5_1.bin` streamed tensor-by-tensor into WebGPU buffers. Measured in `/model-lab/`
by a headless Chromium 1243 driver (Intel gen-12lp iGPU, Vulkan), one engine per fresh browser,
2 CPU threads each. Memory = PSS + SwapPss of the whole browser tree **plus** i915 GPU memory
(`drm-total-*`), relative to the idle page.

| | Transformers.js whisper-small q4 | **whisper.cpp WebGPU small q5_1** |
|---|---|---|
| download | 299 MB | **190 MB** |
| RAM, model loaded | +1.90 GB | **+0.57 GB** |
| RAM, peak while transcribing | +2.12 GB | **+1.01 GB** |
| rtf (eval2 / eval3 / set1) | 1.98 / 1.74 / 2.16 | **0.21 / 0.18 / 0.24** |
| WER (eval2 / eval3 / set1) | 6.8 / 4.5 / 5.6% | 9.1 / 6.1 / 3.2% |
| aggregate WER (345 words) | 5.5% (19 errors) | 5.8% (20 errors) |

**Desktop verdict: passes every gate** (WER ≤ 6.5%, faster, less RAM, smaller download).
**Android: not usable through the browser.** On a Galaxy S24 FE (Exynos 2400e, Samsung Xclipse
940, Chrome 154 / WebView 153) Dawn lists both adapters as *"Blocklisted – crbug.com/40643150:
Limited support / testing currently available on Android"*; `requestAdapter()` returns null, so
it would fall back to the CPU path (rtf 15–22). The Android WebView is also not cross-origin
isolated, which this pthreads build needs. Android needs a different path (native whisper.cpp in
Tauri) or Transformers.js as the fallback.

## Native whisper.cpp in the desktop and Android apps (2026-10-04) — adopted

`src-tauri/plugins/speech` (whisper-rs 0.16, CPU) running `ggml-small-q5_1.bin` (190 MB).
Same three clips, same scoring. Desktop numbers come from `examples/bench.rs` (the plugin's own
`Engine`) on an i7-1165G7 under heavy unrelated load (load average 11–12 on 8 threads), so they
are pessimistic. Phone numbers come from the debug app on a Galaxy S24 FE (Exynos 2400e), calling
the plugin's `transcribe` command directly.

| | desktop (CPU, 4 threads) | phone (CPU) | Transformers.js q4 (webview, same laptop) |
|---|---|---|---|
| aggregate WER (345 words) | **5.8%** (20) | **5.8%** (20) | 5.5% (19) |
| rtf eval2 / eval3 / set1 | 0.92 / 0.81 / 0.94 | 0.65 / 0.74 / 0.84 | 1.98 / 1.74 / 2.16 |
| memory | 569–613 MB peak RSS, whole process | ~600 MB PSS, **whole app** incl. WebView | +1.9–2.1 GB over the browser |
| model load | 0.26 s | 0.27 s | seconds |
| download | 190 MB | 190 MB | 299 MB |

Whisper decodes a full 30 s window even for short audio, so an 8 s take costs about one
window (~16 s on the busy laptop). The phone's mic → native transcription → LLM feedback path
was verified through the real practice screen: a 44 s take played from the laptop's speakers was
transcribed and evaluated (Groq, 9 feedback items) 35 s after Stop, with the app at ~950 MB PSS at
peak (WebView, Piper TTS worker and whisper together). Over-the-air audio adds errors the clean
file does not ("mon collier" for Montpellier). GPU (Vulkan) is not enabled yet; the desktop WebGPU
spike (rtf ~0.2) shows the headroom.
