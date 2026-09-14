# Adding a model: what to check before you spend time on it

Written after a session where several promising models turned out to be dead ends. Check
[`approved-tech.md`](./approved-tech.md) first — if your candidate is on the Rejected list, stop.

---

## The 60-second vet

Run these before downloading anything.

```sh
REPO=onnx-community/whisper-small        # or whatever you are considering

# 1. Does it exist, what is it, is it gated?
curl -s "https://huggingface.co/api/models/$REPO" | python3 -m json.tool | head -30

# 2. What will it ACTUALLY download? (encoder + merged decoder, not the repo size)
curl -s "https://huggingface.co/api/models/$REPO?blobs=true" | python3 -c "
import json,sys
S={f['rfilename']:(f.get('size') or 0) for f in json.load(sys.stdin).get('siblings',[])}
for dt,suf in [('fp32',''),('q4','_q4'),('q8','_quantized'),('int8','_int8'),('fp16','_fp16')]:
    e=S.get(f'onnx/encoder_model{suf}.onnx',0); m=S.get(f'onnx/decoder_model_merged{suf}.onnx',0)
    if e and m: print(f'{dt:6s} {(e+m)/1e6:7.1f} MB')
"
```

Then answer these four questions:

| question | if the answer is wrong |
|---|---|
| Is the architecture supported by Transformers.js? | Custom `modeling_*.py` + `trust_remote_code` cannot run in the browser at all. |
| Does it need external G2P? | If yes, it needs French eSpeak data — see the G2P trap below. |
| Is there a **q4** build? | int8/q8/uint8 Whisper builds do not load. q4 is the only quantized precision that works. |
| Have you got **3+ eval clips**? | One clip will rank models wrong. It already did, by 4x. |

---

## Approved / Rejected verdicts

Moved to [`approved-tech.md`](./approved-tech.md) — the full list of what works, what doesn't,
and the evidence for each, kept there so it doesn't drift out of sync with a second copy here.
Check it before spending time on a candidate.

---

## The five traps that cost the most time

### 1. A Node test proves nothing about the browser
`onnxruntime-node` loads q8 Whisper happily and scores an identical 7.2% WER. ORT-Web
refuses the same file. **Only a browser run counts.** Test headful, with a cold cache.

### 2. Quantization is a download lever, not a speed one
Browser WASM has no INT8 SIMD path (no VNNI, no ARM dot-product), so ORT-Web dequantizes back
to float on every matmul.

| | fp32 | q8 |
|---|---|---|
| MMS-TTS French | **rtf 0.53** | rtf 2.68 |

**fp32 on WASM. fp16 only on WebGPU. 8-bit only to save bandwidth.**

### 3. Downloads are bigger than the spec sheet, because embeddings stay fp32
`q4` quantizes MatMul weights and leaves `embed_tokens` alone.

| | whisper-base | whisper-small |
|---|---|---|
| embed_tokens at fp32 | 106 MB | **159 MB** |
| actual q4 total | 142 MB | 299 MB |
| what a "4-bit" table predicts | ~60-75 MB | ~180-220 MB |

For whisper-small, **53% of the download is one fp32 embedding table**. The encoder, which has
no embeddings, *is* properly 4-bit: 352.8 MB → 66.2 MB.

Grimly: the only export that quantizes embeddings is **int8** — the broken one.

### 4. French G2P is the real bottleneck for TTS
`phonemizer` (what kokoro-js depends on) ships **English-only** eSpeak:

```
Invalid language identifier: "fr". Should be one of: en, en-029, en-gb, en-us...
```

That single limitation is why Kokoro is English-only in browsers. **`@diffusionstudio/piper-wasm`**
carries the full espeak-ng-data (18 MB, every language) and is the only French G2P that works
client-side. Call it with the input as a JSON **array** — a bare object aborts with an opaque
emscripten pointer and no stderr.

### 5. One eval clip will rank models wrong
It already did:

| model | set1 only | across 3 clips |
|---|---|---|
| whisper-base fp32 | 4.8% | **9.9%** |
| whisper-small-cv11-french | **2.4%** | **21.7%** |

The "best" model on one clip was the worst overall. **345 words is still small** — one word is
~0.29% WER. Aggregate WER is total-errors / total-words, never a mean of per-clip rates.

---

## Adding an STT model — checklist

1. Check `onnx-community/<model>` exists and has a **q4** build.
2. Compute the real download: `encoder_model_q4` + `decoder_model_merged_q4`.
3. Add a card in `src/lib/adapters/registry.ts` with an explicit `dtype`.
4. **Load it in a browser before trusting it.** Confirm the card reaches `Ready`, and that the
   progress bar shows real MB.
5. Benchmark against **every** clip in `eval/`, not just one.
6. Compare to the incumbent: `whisper-small q4`, **5.5% aggregate**, 299 MB, rtf 1.48.
7. If it loses, record why in `known-issues.md` so nobody retries it.

## Adding a TTS model — checklist

1. Does Transformers.js map the architecture? Check
   `MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES` in `transformers.web.js`. `vits` and
   `style_text_to_speech_2` are there; a `pipeline('text-to-speech', ...)` call still rejects
   the latter.
2. Does it need G2P? If yes, does French data exist for it?
3. Does the checkpoint have **multiple speakers**? Multi-speaker VITS graphs declare a `sid`
   input; omitting it fails with `input 'sid' is missing in 'feeds'`. Single-speaker graphs
   reject the extra feed — so supply it conditionally on `session.inputNames`.
4. Check the **sample rate** — French Piper voices range 16 / 22.05 / 44.1 kHz, and it
   materially changes perceived quality.
5. Synthesize and check **peak amplitude**, not just buffer length. A correctly-sized buffer of
   silence is a real failure mode.
6. Score round-trip WER, then **listen**. Round-trip measures intelligibility, not naturalness;
   a flat robotic voice can score 0%.

---

## Environment gotchas

- **Use one dev server port.** The browser Cache API is per-origin: `:5173` and `:5174` keep
  separate model caches, so switching re-downloads everything.
- **`/tmp` is tmpfs (RAM-backed).** Test browser profiles holding model weights cost real
  memory — over a gigabyte, easily.
- **After a fresh clone**, restore the gitignored phonemizer assets:
  `cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} public/piper-wasm/`
- **WebGPU is not a free win.** It is available here and builds sessions, but returns 92% WER
  at q4 versus 9.6% on WASM. Re-test per machine; do not assume.

---

## Where the details live

- `docs/approved-tech.md` — the model/library verdicts and their evidence
- `.agents/handoff/references/known-issues.md` — exact errors and re-test triggers
- `.agents/handoff/references/bugs.md` — what was fixed and why
- `.agents/handoff/memory/decisions.md` — settled calls and their evidence
- `.agents/handoff/rules/constraints.md` — the hard rules
