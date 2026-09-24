# Constraints

## Hard Rules

- **Verify in a browser before believing it.** `onnxruntime-node` loads quantized builds that
  ONNX Runtime Web refuses. A passing Node test is not evidence about the browser.
- **Never ship a model card that has not loaded and produced output in a browser.** A card that
  downloads 77-299 MB and then throws is worse than no card.
- **Never rank models on a single eval clip.** It has already reversed a ranking once. Aggregate
  WER is total-errors / total-words, never the mean of per-clip rates. Evidence:
  `docs/benchmarks/stt.md`.
- **One card per download.** Config on a card is only for choices that reuse the same weights.
- **No default model selection and no per-model favouritism in the UI.** The lab is a comparison
  tool; a pre-tick or a highlight biases the result before the user looks.
- **A clip is scored only if it has a real human transcript.** Synthetic audio is never scored.
- Changing the audio source clears the reference text rather than carrying the previous one.
- **Never instrument production code for a sandbox, demo or test.** Test-only props, `{#if}`
  branches, stores or handlers must not be added to `src/lib` or the product routes. Build a
  clone instead (`src/routes/ui-sandbox/components/Mock*.svelte`); if one was added by mistake,
  revert it immediately.

## Technical Limits

Numbers and the exact error strings live in `docs/benchmarks/runtime.md`; the standing rules are:

- **Quantization is a bandwidth lever, not a speed one.** fp32 on WASM, fp16 only on WebGPU,
  8-bit only to save bandwidth.
- **Only `q4` builds a working quantized session.** int8/uint8/q8 fail to build on WASM; fp16 has
  no WASM path.
- **WebGPU is available here but wrong for quantized weights.** Keep WASM the default.
- **Piper and Transformers.js must keep separate ONNX Runtime instances.**
- **Whisper sees 30s at a time.** Long audio uses sequential windows seeking to the last emitted
  timestamp; Transformers.js' own `chunk_length_s`/`stride_length_s` drops audio.
- **Keep heavy inference off the UI thread.** Local STT already runs in a Web Worker.
- **The browser Cache API is per-origin.** Two dev-server ports mean two caches.
- **`/tmp` is tmpfs (RAM-backed) on this machine.** Test browser profiles cost real memory.

## Security And Privacy

- The HuggingFace token lives only in `localStorage` (`onspot.key.hf`, see `stores/secrets.ts`).
  Never commit it, never bake it into a `VITE_` variable (those are embedded in the build), never
  paste it into a chat transcript.
- Text and audio leave the device only through a **BYOK cloud call** the user configured (Groq
  STT, OpenAI/Groq TTS, LLM evaluation), and the UI must say so. Local Whisper and Piper stay
  on-device. The lab's remote `Audio8` card was removed from the registry.

## Dependencies

- `@diffusionstudio/piper-wasm` supplies French G2P. The alternative, `phonemizer`, ships an
  **English-only** eSpeak build — the reason Kokoro is unusable for French.
- Its 18 MB assets are gitignored; restore them after a clone (see commands.md).
- Avoid `piper-tts-web` and `kokoro-js` as runtime dependencies: each pins its own
  onnxruntime-web and Transformers copies.
- UI components come from `@dvcol/neo-svelte` (pinned to the npm 1.2.0 line). It needs
  `sass-embedded`; its `.scss` build prints Sass `if()` deprecation warnings — harmless.
- Japanese TTS depends on `piper-plus` **0.7.0 exactly**: the vendored glue in
  `src/lib/adapters/tts/vendor/piper-plus-wasm/` and the pinned SHA-256 in `adapters/tts/assets.ts`
  must match the same release. Upgrading means re-vendoring the glue and updating the hash.
