# Text-to-Speech (TTS) benchmarks

French TTS results for browser-side synthesis. The voice choice was a **human listening test
(2026-09-13)**, not an automatic metric: rtf and round-trip WER measure speed and
intelligibility, not how a voice sounds. See [`runtime.md`](./runtime.md) for the G2P and
quantization constraints behind these numbers.

## Listening-test ranking

| rank | voice | notes |
|---|---|---|
| 1 | **Piper Tom (M, medium)** | Winner. Needs an EQ boost in the high end and a loudness increase. |
| 2 | Piper UPMC — jessica (#0) | |
| 3 | Piper Siwis (F, medium) | |
| 4 | Piper UPMC — pierre (#1) | |
| — | Piper MLS (medium, 125 speakers) | **Kept, not ranked.** One checkpoint with 125 speakers; held back for individual auditioning rather than judged as one entry. |

## Voice measurements

| voice | download · sample rate | rtf / peak | evidence |
|---|---|---|---|
| **Piper Tom (M, medium)** | 64 MB · **44 kHz** | — | Winner. Only male voice in the set; highest fidelity. Same proven adapter path as Siwis/UPMC; rtf/peak not individually isolated before the listening test picked it. |
| Piper UPMC (medium, 2 speakers) | 77 MB · 22 kHz | rtf 0.355 · peak 0.34 | jessica #0 and pierre #1 ranked #2 and #4. Confirmed non-silent. Multi-speaker graphs declare an extra `sid` input: omitting it fails with `input 'sid' is missing in 'feeds'`; single-speaker graphs reject the extra feed, so feed it conditionally on `session.inputNames`. |
| Piper Siwis (F, medium) | 63 MB · 22 kHz | rtf 0.35 (3 runs, 0.35–0.355) · peak 0.48–0.55 | Ranked #3; the fastest voice measured, just not the preferred sound. |

## Rejected TTS voices

Removed from the app entirely (not just unranked). Evidence kept for future TTS work.

| model | download · sample rate | why it lost |
|---|---|---|
| Piper Siwis (F, low) | 28 MB · 16 kHz | Not in the top 4; smallest / lowest-fidelity Piper option. |
| MMS-TTS French (fp32) | 114 MB · 16 kHz | rtf 0.90 in the full app (0.53 isolated). Lost the listening test to Piper, which is smaller and faster. |
| MMS-TTS French (q8) | 38 MB · 16 kHz | Loads and runs, but **rtf 2.68 — ~5x slower than fp32 on WASM** (no INT8 SIMD path). |
| Audio8 TTS 0.6B (remote) | 0 MB · 44 kHz | rtf 2.94 with a token, fails outright without one (ZeroGPU anonymous quota). Third-party Gradio Space, can disappear. Best raw fidelity measured, worst reliability. |
| Web Speech API | native | Returns no audio buffer — cannot be scored, replayed or exported. |
| Kokoro-82M for French | 92.4 MB q8 | Loads fine (no ORT conflict), but `kokoro-js` ships a **frozen 28-voice English-only registry**. `ff_siwis` downloads (522,240 bytes) but cannot be registered. Its own VOICES.md grades French **B- on <11 hours**. Also bundles transformers 3.8.1, predating `q8f16`. |
| Matcha-TTS for French | — | **No French model exists anywhere.** k2-fsa has 25 repos and zero French; sherpa-onnx's French offering *is* Piper. |

## French G2P is the real bottleneck

`phonemizer` — what `kokoro-js` depends on — ships an **English-only** eSpeak build:

```
Invalid language identifier: "fr". Should be one of: en, en-029, en-gb, en-us...
```

That single limitation makes Kokoro English-only in the browser. **`@diffusionstudio/piper-wasm`**
carries the full espeak-ng-data (18 MB, every language) and is the only French G2P that works
client-side. Call it with the input as a JSON **array** — a bare object aborts the module with an
opaque emscripten pointer and no stderr.

## Round-trip caveat

Round-trip WER (synthesize → transcribe → score) measures intelligibility, **not naturalness**:
a flat robotic voice can score 0%. Never rank TTS on it alone. Synthesize and check **peak
amplitude** too, not just buffer length — a correctly-sized buffer of silence is a real failure
mode.
