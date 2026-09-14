# Approved / Rejected tech

The verdicts on every model and library considered for onspot's STT and TTS labs, with the
evidence behind each one. Check here **before** spending time on a candidate — if it's on the
Rejected list, stop; if it's on Approved, the numbers below are what to beat.

For *how* to vet something new, see [`plan.md`](./plan.md).

---

## Approved — verified loading and producing real output in a browser

STT numbers are aggregate WER over `eval/set1 + eval2 + eval3` (345 words), on WASM.
TTS models are confirmed non-silent (checked peak amplitude, not just buffer length).

### Speech-to-Text

| model | dtype · download | evidence |
|---|---|---|
| **`onnx-community/whisper-small`** | q4 · 299 MB | **The pick.** 5.5% aggregate (5.6/6.8/4.5% per clip), rtf 1.48. Best and most stable of everything tested. |
| `onnx-community/whisper-base` | fp32 · 291 MB | 9.9% aggregate (4.8/12.5/12.9%), rtf 0.51. Fastest of the three; use if download size doesn't matter and speed does. |
| `onnx-community/whisper-base` | q4 · 142 MB | 11.0% aggregate (7.2/13.6/12.9%), rtf 0.42. Half the bytes of base fp32 for ~1 point of WER. |
| `onnx-community/whisper-tiny` | fp32 · 152 MB | 21.6% WER — measured on set1 only, before eval2/eval3 existed. Re-run against the full set before trusting this number. |
| `onnx-community/moonshine-tiny-fr-ONNX` | fp32 · 109 MB | 64.8% WER on set1 only. Loads and runs correctly — the model itself is just weak. Its own card calls it a proof of concept. |

### Text-to-Speech

**Decided by a human listening test (2026-09-13)**, not by rtf or round-trip WER alone —
those measure speed and intelligibility, not how a voice actually sounds. Ranked:

| rank | voice | notes |
|---|---|---|
| 1 | **Piper Tom (M, medium)** | Winner. Probably needs an EQ boost in the high end and a loudness increase. |
| 2 | Piper UPMC — jessica (#0) | |
| 3 | Piper Siwis (F, medium) | |
| 4 | Piper UPMC — pierre (#1) | |

| model | download · sample rate | evidence |
|---|---|---|
| **Piper Tom (M, medium)** | 64 MB · **44 kHz** | **Winner of the listening test.** Only male voice in the set; highest fidelity. rtf/peak not individually isolated before the listening test picked it — same proven adapter code path as Siwis/UPMC. |
| Piper UPMC (medium, 2 speakers) | 77 MB · 22 kHz | Both speakers (jessica #0, pierre #1) ranked #2 and #4. Confirmed non-silent (rtf 0.355, peak 0.34). Multi-speaker Piper voices need an extra `feeds.sid` tensor (speaker id) — omitting it fails with `input 'sid' is missing in 'feeds'`. Fixed by checking `session.inputNames.includes('sid')` before adding it, since single-speaker graphs reject the extra feed. |
| Piper Siwis (F, medium) | 63 MB · 22 kHz | Ranked #3. rtf 0.35 (measured 3 times, 0.35-0.355), peak 0.48-0.55 — the fastest voice measured, just not the preferred sound. |
| Piper MLS (medium, 125 speakers) | 77 MB · 22 kHz | **Kept, not ranked.** 125 speakers in one checkpoint; deliberately held back to audition individually later rather than being judged as one entry. |

Everything else that was in the lab lost the listening test or a technical gate and was
**removed from the app** (not just unranked): `Piper Siwis (F, low)`, MMS-TTS French
(fp32/q8/fp16), Audio8 TTS 0.6B (remote), Web Speech API. Their evidence, for the record —
useful if TTS candidates are ever revisited:

| model | download · sample rate | why it lost |
|---|---|---|
| Piper Siwis (F, low) | 28 MB · 16 kHz | Not in the top 4; smallest/lowest-fidelity Piper option. |
| MMS-TTS French (fp32) | 114 MB · 16 kHz | rtf 0.90 in the full app (0.53 isolated). Lost the listening test to Piper, which is smaller and faster. |
| MMS-TTS French (q8) | 38 MB · 16 kHz | Loads and runs, but rtf 2.68 — ~5x slower than fp32 on WASM (no INT8 SIMD path). |
| Audio8 TTS 0.6B (remote, 0 MB) | 44 kHz | rtf 2.94 with a token; fails outright without one (ZeroGPU anonymous quota). Third-party Gradio Space, not the official (paused) one — can disappear. Best raw fidelity measured, worst reliability, and not chosen. |
| Web Speech API (0 MB) | native | Returns no audio buffer — cannot be scored, replayed, or exported. |

---

## Rejected — do not retry without new evidence

| model / tech | why | exact failure |
|---|---|---|
| **whisper-small-cv11-french** (and French fine-tunes generally) | Best on one clip, catastrophic overall | 2.4% WER on set1, **21.7% aggregate**. Truncates 24 of 88 words, emits filler dots, "Montpellier" → "mon pilier". Fine-tuned on Common Voice read speech; collapses on multi-speaker conversation. |
| **Any int8 / uint8 / q8 Whisper** | The published exports are broken | `TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`. Confirmed on `whisper-base`, `whisper-base-ONNX`, `whisper-small`. The three filenames are one artifact. **Not a "legacy, since-patched" issue** — checked `onnx-community/whisper-small`'s commit history: the broken decoder is from the initial 2024-05-24 upload, and the only commit since (2025-06-19) only *added* an fp16 file. There is no newer, fixed version to fall back to. |
| **fp16, on WASM** | No float16 path in ORT-Web | `Type (tensor(float16)) of output arg (/duration_predictor/RandomNormalLike_output_0) does not match expected type (tensor(float))`. |
| **Kokoro-82M for French** | English-only in practice | kokoro-js ships a **frozen** 28-voice registry, all `en-us`/`en-gb`. `ff_siwis` downloads (522,240 bytes) but cannot be registered. Its own VOICES.md grades French **B- on <11 hours**, one voice. |
| **Matcha-TTS for French** | No French model exists | k2-fsa has 25 repos, zero French TTS. sherpa-onnx's French offering *is* Piper. |
| **whisper-large-v3-turbo / distilled large** | Cannot fit a browser budget | Distillation shrinks the **decoder**. Turbo is **759 MB at q4**; its encoder alone is 425 MB. |
| **bofenghuang French distils** | No ONNX at all | `-distil-dec2/4/8/16` ship PyTorch only. Community forks are CTranslate2 / GGML — Transformers.js loads neither. |
| **`Xenova/*` mirrors of MMS/Whisper** | Missing files, and the files that do exist fail anyway | `encoder_model_int8.onnx` returns **404** on `Xenova/whisper-base`/`whisper-small` (only `_uint8` ships). The `uint8` pair that *does* exist (both files present, 249MB total on whisper-small) still fails in-browser with the identical `TransposeDQWeightsForMatMulNBits` error as onnx-community — despite being a separately-exported, byte-different file (different SHA256, confirmed via each repo's LFS pointer). A per-file dtype override (`{encoder_model:'uint8', decoder_model_merged:'int8'}`) does not route around it; the defect is in the decoder file itself. Use `onnx-community/*` and `dtype:'q4'`. |
| **OpenVINO exports** (e.g. `OpenVINO/whisper-small.en-int8-ov`) | Wrong runtime, wrong language | Ships `.xml`/`.bin` OpenVINO IR, not ONNX — no browser runtime loads it. This specific repo is also English-only (`vocab_size: 51864`), so it's a double rejection independent of format. |
| **`optimum-cli export onnx --quantize q4`** | Not a real flag | Checked against the current documented flags for `optimum-cli export onnx` (`--model`, `--task`, `--opset`, `--device`, `--dtype`, `--optimize`, `--framework`, `--library`, `--trust-remote-code`, `--monolith`, `--variant`, plus shape flags) — there is no `--quantize` option on that subcommand. Quantization is a separate step; a working replacement command has not been verified here. |
| **`piper-tts-web`, `kokoro-js` as runtime deps** | Dependency collision | Each pins its own onnxruntime-web and Transformers. Three Transformers copies and two ORT versions in one page. |
| **Sharing one ONNX Runtime** between Piper and Transformers.js | Breaks every model load | Registering `globalThis[Symbol.for('onnxruntime')]` makes Transformers.js take a branch that never populates `supportedDevices` → `Unsupported device: "wasm". Should be one of: .` |

---

## A pattern worth naming: plausible-sounding explanations aren't evidence

Twice this project, a confident, technical-sounding explanation for *why* something failed
turned out to be wrong in a checkable way:

- "Use `onnx-community` instead of `Xenova`, it's patched" — checked the commit history;
  `onnx-community`'s broken files are the same 2024 vintage, never updated.
- "`optimum-cli export onnx --quantize q4` re-exports it correctly" — checked the documented
  CLI flags; `--quantize` doesn't exist on that subcommand.

Both explanations *sounded* right and cited real, correct background facts (native ORT
tolerating malformed scales where ORT-Web doesn't, is a real and correct mechanism). The
specific fix each one prescribed just hadn't been checked. Treat a plausible root cause the
same as a plausible model: verify it before repeating it.

---

## Where this comes from

Every row above was produced by the methodology in [`plan.md`](./plan.md): the 60-second vet,
then a real browser load with a cold cache — never a Node test, never the repo's own README.
