# Assumptions

## Verified in a browser
- `@huggingface/transformers` v4 runs `automatic-speech-recognition` and `text-to-speech`
  client-side.
- Decoding into a 16kHz `OfflineAudioContext` gives a correct 16kHz mono Float32Array; the
  output transcribes identically to an ffmpeg/soxr decode of the same file.
- q4 Whisper weights build a session on WASM; int8/uint8/q8 do not.
- WebGPU is available on this machine (Intel gen-12lp, `shader-f16`) but produces wrong output
  for quantized Whisper.
- Piper VITS runs on `onnxruntime-web` with `piper_phonemize` supplying French phonemes.
- Transformers.js caches models in `transformers-cache` and they survive a refresh.
- The strict translation-v2 browser flow is verified with an intercepted OpenAI-compatible
  response: legacy replacement, persistence, and progressive disclosure all work in Chrome.

## Assumed, not verified
- Piper's `cachedFetch` cache survives a refresh. The code is in place; a warm second load has
  not been observed.
- Round-trip WER scoring end to end. Never completed a full run.
- Behaviour on Safari and Firefox. Everything has been tested in Chrome only.
- Exact compliance with the stricter translation prompt across every configured LLM. The prompt
  carries a contrastive example and malformed output is repaired, but the browser regression used
  an intercepted provider response rather than a live model.
- Whether `whisper-small q4`'s 5.5% holds beyond 345 words. Three clips is a small sample;
  one word is ~0.29% WER.
- That number formatting (`15h10`, `50 €`) is inflating WER rather than reflecting real
  mis-recognition. Strongly suspected, not isolated.

## Known false — do not re-assume
- ~~A Node experiment tells you whether a dtype works in the browser.~~ `onnxruntime-node`
  accepts quantized builds that ORT-Web rejects.
- ~~Quantization makes inference faster.~~ On WASM it is consistently slower.
- ~~A model with "french" in its name is better at French.~~ The Common Voice fine-tune is
  4x worse in aggregate than the generic multilingual model.
- ~~One eval clip is enough to rank models.~~ It reversed the ranking entirely.
