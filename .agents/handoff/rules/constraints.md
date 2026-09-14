# Constraints

## Hard Rules

- **Verify in a browser before believing it.** `onnxruntime-node` loads quantized builds that
  ONNX Runtime Web refuses. A passing Node test is not evidence about the browser.
- **Never ship a model card that has not loaded and produced output in a browser.** A card that
  downloads 77-299 MB and then throws is worse than no card.
- **Never rank models on a single eval clip.** It has already reversed a ranking once: the
  French fine-tune is best on set1 (2.4%) and worst in aggregate (21.7%).
- **Aggregate WER is total-errors / total-words**, never the mean of per-clip rates.
- **One card per download.** Config on a card is only for choices that reuse the same weights.
- **No default model selection and no per-model favouritism in the UI.** This is a comparison
  tool; a pre-tick or a highlight biases the result before the user looks.
- **A clip is scored only if it has a real human transcript.** Synthetic audio is never scored.
- Changing the audio source clears the reference text rather than carrying the previous one.

## Technical Limits

- **Quantization is a bandwidth lever, not a speed one.** Browser WASM has no INT8 SIMD path;
  ORT-Web dequantizes on every matmul. fp32 on WASM, fp16 only on WebGPU.
- **fp16 cannot build a session on WASM** (no float16 path for `RandomNormalLike`).
- **int8/uint8/q8 Whisper builds cannot build a session at all** — a 4-bit `embed_tokens`
  missing its scale. q4 is the only quantized precision that works.
- **WebGPU is available here but wrong for quantized weights** (92% WER at q4 vs 9.6% on WASM).
- **Piper and Transformers.js must keep separate ONNX Runtime instances.** Registering one at
  `globalThis[Symbol.for('onnxruntime')]` makes Transformers.js adopt it via a branch that
  never populates `supportedDevices`, breaking every model load.
- **Whisper sees 30s at a time.** Long audio uses sequential windows seeking to the last
  emitted timestamp. Transformers.js' own `chunk_length_s`/`stride_length_s` drops audio.
- **Model loading and inference run on the main thread** and freeze the tab. A Web Worker is
  the outstanding fix.
- **The browser Cache API is per-origin.** Two dev server ports mean two caches.
- **`/tmp` is tmpfs (RAM-backed) on this machine.** Test browser profiles cost real memory.

## Security And Privacy

- The HuggingFace token lives only in `localStorage` (`onspot.hf_token`). Never commit it,
  never bake it into a `VITE_` variable (those are embedded in the build), never paste it into
  a chat transcript.
- The Audio8 card sends text to a **third-party Space**. It is labelled as such in the UI.
  Everything else runs locally.

## Dependencies

- `@diffusionstudio/piper-wasm` supplies French G2P. The alternative, `phonemizer`, ships an
  **English-only** eSpeak build — the reason Kokoro is unusable for French.
- Its 18 MB assets are gitignored; restore them after a clone (see commands.md).
- Avoid `piper-tts-web` and `kokoro-js` as runtime dependencies: each pins its own
  onnxruntime-web and Transformers copies.
