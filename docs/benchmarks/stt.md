# Speech-to-Text (STT) benchmarks

Whisper-family and Moonshine results, measured in a real browser on WASM unless stated
otherwise. See [`runtime.md`](./runtime.md) for the device/precision matrix behind these
numbers, and [`../plan.md`](../plan.md) for the method.

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
