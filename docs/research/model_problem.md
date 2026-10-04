# Model problem: local STT uses too much RAM

Status: **resolved for the desktop and Android apps** (2026-10-04): native whisper.cpp, see
[`benchmarks/stt.md`](../benchmarks/stt.md). The browser build still uses Transformers.js. Written
2026-10-01 to drive a manual search for alternatives.
The raw measurements live in [`benchmarks/stt.md`](../benchmarks/stt.md),
[`benchmarks/runtime.md`](../benchmarks/runtime.md) and [`benchmarks/tts.md`](../benchmarks/tts.md).

## The problem

The local speech-to-text model, `onnx-community/whisper-small` at q4, is a **299 MB download**.
Loaded through Transformers.js / ONNX Runtime Web (WASM), it makes the browser hold roughly
**2.3–2.5 GB** (summed PSS of the whole browser process tree). About 0.4–0.7 GB of that is the
browser itself. That leaves **~1.7–1.9 GB for one model**, 6× its file size. The speech-to-text
model this app runs on-device needs about 2 GB of RAM while it is loaded.

The one alternative measured so far fixes the RAM and breaks the speed:

| engine | download | RAM while loaded (browser PSS) | WER on eval2 | speed (rtf, lower is faster) |
|---|---|---|---|---|
| **Transformers.js whisper-small q4** (current) | 299 MB | **~2.3–2.5 GB** | 6.8% (5.5% on all 3 clips) | **1.81** |
| whisper.cpp `ggml-small-q5_1` (`@transcribe/shout`) | 190 MB | ~0.6 GB | 9.1% | 14.6 |
| whisper.cpp `ggml-small-q8_0` (`@transcribe/shout`) | 264 MB | ~0.6 GB | 6.8% | 22.7 |

Measured 2026-09-30 in headless Chromium through the dev route `/stt-bench/`, with 2 threads per
engine. The machine was under load (an Android emulator was running, swap in use), so treat the
RAM figures as approximate. They are directionally clear: whisper.cpp holds the same model family
in ~4× less memory but runs 8–12× slower in WASM. A 60 s answer would take 15–20 minutes.

### Why the Transformers.js footprint is large (known vs. suspected)

Known:
- **The q4 export is not really 4-bit.** q4 quantizes MatMul weights only. The decoder's
  `embed_tokens` table stays fp32: **159 MB, 53% of the download**. The encoder *is* properly
  4-bit (352.8 MB → 66.2 MB).
- **The only exports that quantize embeddings are broken.** int8/uint8/q8 fail to build a WASM
  session (`TransposeDQWeightsForMatMulNBits Missing required scale ... embed_tokens`). fp16 has
  no WASM path.
- **WASM memory never shrinks.** Once the WebAssembly heap has grown to its peak, the browser keeps
  it until the worker is terminated.
- **Both runtimes are separate.** Piper TTS runs on its own ORT instance, so STT and TTS each pay
  for an ORT runtime and heap (required, see `runtime.md` "ONNX Runtime isolation").

Suspected, **not verified**. Check these before building on them:
- The model's bytes are held more than once during load: the fetched ArrayBuffer and
  Transformers.js' Cache API copy in JS, plus the copy inside the WASM heap.
- ONNX Runtime's CPU memory arena and weight pre-packing allocate working buffers much larger
  than the weights. Decoder KV-cache and 30 s-window activations add to it.
- `decoder_model_merged` carries both the with-past and without-past branches.

Current mitigation: the STT and TTS workers release their sessions after **90 s idle**, which
terminates the memory only between answers. It does not lower the peak.

### What an acceptable replacement must satisfy

These are the gates any candidate has to pass. They come from the settled decisions in
`.agents/handoff/memory/decisions.md` and the rules in `.agents/handoff/rules/constraints.md`.

- **Accuracy:** aggregate WER within ~1 point of 5.5% across all three `eval/` clips (345 words),
  French. Japanese must also work, with the same multilingual weights if possible.
- **Speed:** rtf no worse than ~1.5× the current engine on the same machine. The target is near
  real time.
- **RAM:** clearly below ~1.9 GB attributable. The goal is under ~0.6 GB.
- **Runs in the browser and in the Tauri webviews:** desktop and **Android WebView, which is
  not cross-origin isolated**. No `SharedArrayBuffer` there, so single-threaded WASM, or
  WebGPU if it produces correct numerics (it did not for quantized Whisper here).
- **On-device, no data leaves the device.** Cloud STT (Groq) already exists as an opt-in; it is
  not the answer to this problem.
- Verified in a real browser with a cold cache. A Node run proves nothing (`onnxruntime-node`
  loads exports that ORT-Web refuses).

## Every model the app uses

### On-device (downloaded, runs in a Web Worker)

| purpose | model | runtime | format · precision | download | notes |
|---|---|---|---|---|---|
| **Speech-to-text**, French and Japanese | `onnx-community/whisper-small` | Transformers.js 4.2 + onnxruntime-web (WASM, 2 threads when isolated) | ONNX · q4 (MatMulNBits; embeddings fp32) | 299 MB | 244M params, 12+12 layers, d_model 768, 80 mel bins, 30 s window. Aggregate WER **5.5%** (5.6 / 6.8 / 4.5%), rtf 1.48 (idle machine). **~1.9 GB RAM loaded. This is the problem.** One download shared by both languages. |
| **Text-to-speech**, French (default) | Piper `fr_FR-tom-medium` | own onnxruntime-web instance | ONNX VITS · fp32 | ~64 MB · 44 kHz | Winner of the 2026-09-13 listening test; EQ/loudness profile applied. RAM not measured. |
| TTS, French | Piper `fr_FR-upmc-medium` | same | ONNX VITS · fp32 | ~77 MB · 22 kHz · 2 speakers | Ranked #2 (jessica) and #4 (pierre). rtf 0.355. |
| TTS, French | Piper `fr_FR-siwis-medium` | same | ONNX VITS · fp32 | ~63 MB · 22 kHz | Ranked #3. rtf 0.35, the fastest voice measured. |
| TTS, French | Piper `fr_FR-mls-medium` | same | ONNX VITS · fp32 | ~77 MB · 22 kHz · 125 speakers | Kept, unranked. |
| TTS, Japanese (candidate) | piper-plus CSS10 (`css10-ja-6lang-fp16`) | same ORT instance, piper-plus adapter | ONNX VITS · fp16 | ~40 MB | Listening test pending. |
| TTS, Japanese (candidate) | piper-plus Mera (`mera-multilingual`) | same | ONNX VITS | ~39 MB | Listening test pending. |
| TTS, Japanese (candidate) | piper-plus Tsukuyomi-chan (`tsukuyomi-chan-6lang-fp16`) | same | ONNX VITS · fp16 | ~40 MB | Listening test pending. |
| G2P (text → phonemes), French | eSpeak-ng via `@diffusionstudio/piper-wasm` | WASM | espeak-ng-data | 18 MB | Shared by every Piper voice. The only browser eSpeak build that carries French. |
| G2P, Japanese | OpenJTalk / jpreprocess via `piper-plus@0.7.0` | WASM | dictionary compiled into the wasm | 60 MB (~20 MB compressed) | Fetched from unpkg, SHA-256-verified. |

A French learner downloads **~381 MB** (Whisper 299 + Tom 64 + eSpeak G2P 18). A Japanese learner
downloads **~359 MB** (Whisper 299 + a ~40 MB voice + the 20 MB compressed dictionary).

### Cloud (bring-your-own-key, nothing downloaded)

| purpose | model | provider |
|---|---|---|
| Speech-to-text (opt-in) | `whisper-large-v3-turbo` | Groq |
| Evaluation / corrections / translation (LLM) | `openai/gpt-oss-120b` (default), `openai/gpt-oss-20b` | Groq |
| Same | `deepseek-flash`, `deepseek-v4-pro` | DeepSeek |
| Same | any OpenAI-compatible endpoint | custom |

There is **no local LLM**. That is why `@wllama/wllama` (llama.cpp, GGUF LLMs only) does not
apply: it cannot run Whisper or Piper.

## Spike result: whisper.cpp + WebGPU (2026-10-04)

On desktop it fixes the problem: **190 MB, +0.57 GB loaded / +1.0 GB peak, rtf ~0.2, 5.8% WER**
against Transformers.js' 299 MB, +1.9 / +2.1 GB, rtf ~1.9, 5.5%. On the Android test phone
(Samsung Xclipse GPU) Chrome blocklists WebGPU, so the browser path cannot serve Android. Full
numbers: [`benchmarks/stt.md`](../benchmarks/stt.md). Ratchet (HF Rust/WebGPU) was rejected
first: no code commits since 2024-11. Candle's official WASM build is CPU-only.

## Already tried and rejected

Full evidence in [`benchmarks/stt.md`](../benchmarks/stt.md) and [`benchmarks/tts.md`](../benchmarks/tts.md).

| candidate | result |
|---|---|
| whisper.cpp small q5_1 / q8_0 in WASM | ~4× less RAM, 8–12× slower (above). Needs SharedArrayBuffer (absent on Android). |
| `@wllama/wllama` | Not applicable: GGUF LLMs only. |
| whisper-base q4 (142 MB) / fp32 (291 MB) | 11.0% / 9.9% aggregate WER. Smaller and faster, ~2× the errors. RAM not measured. |
| whisper-tiny fp32 | 21.6% WER (one clip). |
| moonshine-tiny-fr | 64.8% WER (one clip). |
| whisper-small int8/uint8/q8 | Broken exports, will not build a WASM session. |
| whisper-small on WebGPU | Loads, returns 92% WER at q4. |
| whisper-small-cv11-french | 2.4% on one clip, 21.7% aggregate. |
| whisper-large-v3-turbo | 759 MB at q4. Too large. |
| French distil-whisper (`bofenghuang`) | No ONNX export; PyTorch / CTranslate2 / GGML only. |

## Research directions (unverified leads for the manual search)

- **Fix the export rather than the runtime:** a whisper-small ONNX export with *quantized*
  embeddings that ORT-Web can load (custom `optimum` + `onnxruntime.quantization` run,
  e.g. q4 MatMul + int8 `Gather` on `embed_tokens`), or a non-merged encoder/decoder pair.
- **ORT session options:** disable the CPU memory arena / memory pattern, check whether
  Transformers.js exposes them, and measure the difference.
- **Other browser Whisper runtimes:** sherpa-onnx WASM (ASR models, including Whisper and
  non-Whisper French/Japanese models), whisper-web / whisper-turbo on WebGPU, a newer
  whisper.cpp WASM build with better SIMD kernels, CTranslate2 (no browser build known).
- **Smaller or different ASR models with French + Japanese:** Moonshine successors, distil
  variants with ONNX exports, SenseVoice (multilingual incl. Japanese; check French), Parakeet /
  Canary (NVIDIA, check languages and web runtimes), Vosk (small, older accuracy).
- **Native path for the Tauri builds:** whisper.cpp or sherpa-onnx in Rust on desktop and
  Android, with the WASM engine kept only for the web build. Native whisper.cpp does not have
  the WASM slowdown.
- **Measure TTS RAM too.** Piper voices have never had their resident memory measured.

Any candidate goes through `/stt-bench/` (see `.agents/handoff/references/commands.md`) against
the gates above before it replaces anything.
