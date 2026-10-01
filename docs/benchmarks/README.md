# Benchmarks and metrics

The single home for measured numbers in this project: model quality, speed, download sizes,
provider rate limits and runtime behaviour.

Anything in `.agents/handoff/` or the other docs that used to repeat a table now links here
instead, so there is **one place to update**. Decisions and hard rules stay in
`.agents/handoff/`; raw numbers live here.

For *how* to vet a new candidate, see [`../research/model-vetting.md`](../research/model-vetting.md). For the approved/rejected
verdict list, see [`stt.md`](./stt.md) and [`tts.md`](./tts.md).

## Index

| file | what it holds |
|---|---|
| [`stt.md`](./stt.md) | Whisper / Moonshine speech-to-text: aggregate and per-clip WER, rtf, downloads, long-form decoding, rejected STT candidates. |
| [`tts.md`](./tts.md) | Piper / MMS / Kokoro text-to-speech: the listening-test ranking, rtf, peak amplitude, sample rates, and the French G2P bottleneck. |
| [`llm-providers.md`](./llm-providers.md) | LLM provider reach and rate limits, led by the Groq account probe, plus the output-budget derivation. |
| [`runtime.md`](./runtime.md) | Device and precision, WASM vs WebGPU, quantization, ONNX Runtime isolation, cache and tmpfs behaviour, download-size reality. |

## Provenance rules

A number without provenance is not evidence. Every table states where it came from.

- **Browser-only.** Model numbers come from a real browser run with a cold cache, never a Node
  test: `onnxruntime-node` loads q8 Whisper that ONNX Runtime Web refuses.
- **Aggregate WER is total-errors / total-words**, never the mean of per-clip rates.
- **State the set.** The aggregate set is `eval/set1 + eval2 + eval3` (345 words); a per-clip
  figure is labelled `set1`, `set2`, or `set3`.
- **One clip ranks wrong.** Never record a verdict from a single clip; it has already reversed a
  ranking by 4x.
- **Timestamp it.** Model exports and provider limits change. Add the probe date.

## Known inconsistencies

Two independent STT runs disagree on `set1` (see [`stt.md`](./stt.md#provenance-note)). The
three-clip aggregate is the decision basis; the older single-clip matrix is kept for the
q4/int8 diagnostic. When in doubt, re-run in a browser with a cold cache before trusting either.
