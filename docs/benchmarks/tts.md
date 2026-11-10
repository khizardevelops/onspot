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

## Supertonic 3 and the any-language voice table (2026-11-07/08)

Goal set by the user: on-device speech for any instruction language and any target language,
under 300 MB of RAM and 500 MB of storage, quick, high quality, in the web build and the Tauri
apps. Measured in headless Chromium (Playwright, the cached Chromium), one WASM thread like the
live site (no cross-origin isolation), on this laptop while its swap was nearly full, so speeds
are ±10–30 %. RAM is the voice worker's own PSS plus swapped pages after speaking, measured from
`/proc` in a fresh browser per case.

**Runtime.** The official sherpa-onnx v2.0.1 browser build (GitHub release tarballs; npm
`sherpa-onnx` is Node-only) runs unmodified: an empty `getPreloadedPackage` buffer skips its
baked-in demo model and our files are written into its file system. The `.wasm` is byte-identical
across the VITS and Supertonic tarballs. It starts with a 512 MiB heap reservation, mostly
untouched pages; `free()` never returns memory, ending the worker does.

| Engine and voice | Worker RAM | rtf (one thread) | Notes |
|---|---|---|---|
| Supertonic 3 int8, both roles from one model | **262 MB** | **0.9–1.1 at 5 steps** (1.4–2.2 under heavy swap); 0.82–0.87 at 3; 0.6 at 2 — but see below: under 5 steps sounds broken | One 145 MB download for 31 languages |
| Piper Tom 44 kHz (onnxruntime-web, today's engine) | 361 MB (+ ~57 MB eSpeak) | 0.5–1.1 | ORT `enableCpuMemArena: false` made no difference |
| Piper Ryan 22 kHz | 240 MB (+ eSpeak) | 0.3–0.5 | |
| Piper Tom + Ryan | 432 MB (+ eSpeak) | | Two Piper sessions |
| Piper Tom on sherpa-onnx | ~590 MB incl. its phonemizer | ≈ ORT (0.94 vs 0.92) | sherpa needs re-exported files (`exit(-1)` on rhasspy's); not adopted |

Short texts at 3 steps: a word in ~1.5 s, a phrase in ~2.3 s. At 2–3 steps the raw output
overshoots full scale (peaks 1.06–1.72), so `SupertonicAdapter` scales such clips down to 0.95.
The user listened to French, English, Korean and Japanese clips and chose Supertonic ("sounds
really good"); 3 vs 5 steps is still to be confirmed by ear.

**Coverage decided:** Supertonic first (31 languages), Piper for the gaps (Persian `fa_IR`
voices, Chinese Huayan; rhasspy's chaowen and xiao_ya expect pinyin phonemes and are left out),
cloud for the rest (Urdu, Bengali; later the same day the user pointed out rhasspy's Urdu voices,
and Urdu Fasih/Aegis and Bengali Google were added: all three load and speak in the voice check,
rtf 0.20–0.35 after the first load). Rejected for now: Kokoro-82M (8–9 languages, French graded
B- by its own card, same single-thread speed problem), MMS-TTS (CC-BY-NC), Phonon 40m multilingual
(5 languages, CC-BY-NC), a language detector (the app knows every segment's language),
eSpeak formant voices as a fallback (not high quality), WebGPU fp32 Supertonic (not measured:
ORT-web loads the ~400 MB fp32 model through its WASM heap, which never shrinks, so it cannot
meet 300 MB), and a custom sherpa-onnx build.

**Voice check (2026-11-08, `/model-lab/voices/` on the dev server, headless Chromium):** all 48
voices in the table loaded and spoke one sentence in their language with a plausible length:
31 Supertonic languages (style F1), 4 French and 4 English Piper voices, 5 Persian, Chinese Huayan,
and 3 Japanese piper-plus. Supertonic rtf on that short sentence: 0.74–1.46, median 0.98 (Finnish
slowest; short texts cost proportionally more than the 0.82–0.87 of a long sentence); Piper
≤ 0.55. The production build (`build/`, served statically) passed Spanish Supertonic and Chinese
Piper the same way.

**Product path:** French read-back with `supertonic-fr-m1` made 6.75 s of audio in 10.6 s on a
cold worker (model load included); the replay came from the SQLite clip cache in 4 ms; a
Spanish-instruction explanation (Supertonic F1) with French words (Supertonic M1), both from one
model, made 7.1 s in 13 s. The renderer grew by 400 MB during that run without a forced garbage
collection; the isolated worker measurement after GC is 262 MB, the difference being the
downloaded model buffers awaiting collection.

**Denoising steps: 5, not 3 (2026-11-08).** The app first shipped 3 steps for speed. The user
heard it as "speaking under water with a funny voice filter, as if 2-bit quantised". Measured on the
same sentence and voice (M1): the share of energy above 5 kHz, which is unconverged flow noise in
this model, was 7.8 % (fr) / 16.6 % (en) at 3 steps, 1.8 % / 9.4 % at 4, 1.05 % / 0.64 % at 5,
0.6 % / 0.4 % at 6 and 0.9 % / 0.9 % at 8; voicing periodicity rose to its plateau at 5. rtf on an
unloaded laptop: 0.74–0.76 at 4, 0.90–1.14 at 5, 1.30 at 6, 1.6 at 8. So `SUPERTONIC_STEPS` is 5 (the
model's default), the cache keys of Supertonic clips include the step count (no stale 3-step clip
is replayed), and a clip made by the app at 5 steps measured 1.6 %. Separately, the Settings preview
played through a 22.05 kHz audio context, which cut the top octave of every 44.1 kHz voice; it now
uses the device rate.

**Steps and speed now follow Supertone's reference: 8 steps, speed 1.05 (2026-11-08, later).**
"5 is the model's default" was wrong: 5 is sherpa-onnx's API default; Supertone's
`example_onnx.py` and sherpa's own examples use 8 steps and speed 1.05. The user then reported some
words sounding wrong. Two causes were found:
- **Edge trimming cut real speech.** Pieces of explanations and long texts were trimmed at a fixed
  sample level of 0.01 with a 15 ms margin. Against each clip's true speech edges (−40 dB of its
  loudest 5 ms window; Supertonic's padding is digital silence) that lost up to 136 ms of the first
  word and 180 ms of the last. Trimming is now relative (−40 dB) with a 30 ms margin.
- **Steps.** Seeded A/B clips (same text, voice and noise) at 5/1.0 and 8/1.05 are in the
  session scratchpad; the 5-step clip of a tricky sentence peaked at 0.78 against 0.43 at 8 (less
  converged). Which of the two the ear prefers is the user's call.
- **Cost of 8 steps:** sentence rtf ~1.6 unloaded (vs ~1.0 at 5). An explanation is spoken in many
  short pieces, each paying the model's fixed cost: a six-piece explanation took 42 s at 8 steps
  under heavy memory pressure, against ~13 s at 3 steps earlier; playback starts after the first piece.

## Loudness

Measured 2026-11-08 as ITU-R BS.1770-4 integrated loudness (K-weighted, 400 ms blocks, gated) on
the voice check's raw clips, one sentence per voice. Scripts: `loudness.py` and
`leveling-check.ts` in the session scratchpad.

- **Raw output spans 14.3 dB** over 51 voices: Piper Tom −29.9 LUFS … Urdu Fasih −15.6.
  Supertonic sits at −24.0 … −18.8 with 27 of its 31 voices peaking within 1.5 dB of full scale,
  so peak normalisation cannot even them out; the peak-to-loudness ratio runs from 12 to 24 dB.
- **Target −20 LUFS** (mono). With a −1 dBFS ceiling the limiter then touches 26 of 51 voices, by
  a median of 2.3 dB on brief peaks (worst 4.6 dB); at −18 it would touch 36 (worst 6.6 dB), at
  −16 45 (worst 8.6 dB). −20 also keeps Supertonic about where it was.
- **Result:** leveled and limited once, the 51 clips span −21.05 … −20.00 LUFS (the limiter takes
  up to a decibel off the spikiest voices); with one top-up pass, −20.39 … −20.00, every peak at
  or under 0.89. The app's meter agrees with the Python reference to 0.005 LU.
- **Cost:** about 5 ms per second of speech in JavaScript (measure, level, limit, measure, top
  up), against 1–2 s of synthesis per second. It runs once, before the clip is stored.
- **In the app** (Chromium, muted): Tom −27.4 → −20.0, Supertonic FR M1 −24.8 → −20.0, DE F1
  −24.7 → −20.0, Fasih −15.0 → −20.1, Ryan −20.7 → −20.1. A three-sentence text in pieces came
  out at −20.0; a two-voice explanation at −21.0 as a whole (its pauses between short pieces
  count in the measure; every piece is leveled on its own). Tom with +3 dB volume: −17.0.
- **Stored copies (Opus, 32 kbps) lose a little:** Ryan 0.4 dB, Supertonic 0.2–0.8 dB, Tom 2.0 dB.
  Almost half of Tom's weighted loudness lies above 4 kHz (his treble lift brings up hiss and
  sibilance), and Opus at 32 kbps keeps a third of it. At 48 kbps Tom still loses 1.8 dB, at
  64 kbps 0.3 dB, at twice the size (8 KB per second instead of 4).

