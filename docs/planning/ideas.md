# Ideas & Todo

Ideas and planned work. Bugs live in [`bugs.md`](./bugs.md).

## New Ideas
- Add a section in the app which will be a simple document laying out what onspot will help you improve (spontanious speaking, grammer, etc) and what onspot cannot help you improve (accent, etc) 

## Optimisation

- [ ] **Find a lighter STT model/runtime.**
  Research [`model_problem.md`](../research/model_problem.md) and look for alternatives manually.
  - The local STT (whisper-small q4 via Transformers.js) holds ~1.9 GB of RAM for a 299 MB download.
  - Work through the doc's "Research directions" for something that meets its gates: ≈5.5% WER,
    near real-time, far less RAM, and runs in the Android WebView.
  - Record every candidate and its result back in that doc.

- [ ] **Audio file compression.**
  Store recordings in a compressed format suited to speech, to save space.

- [x] **Switch models to `@wllama/wllama` / GGUF to cut RAM and disk.**
  Original idea: ONNX / Transformers.js seemed to double model size and RAM compared with native
  formats like GGUF, so delete the downloaded models and use wllama versions instead (or run the
  current models with wllama).
  - **Checked 2026-09-30: not possible.** wllama is llama.cpp and runs GGUF LLMs only; it cannot
    run Whisper or Piper, and the app has no local LLM.
  - whisper.cpp (the GGUF-style Whisper) was benchmarked: ~4× less RAM and a smaller download,
    but 8–12× slower in WASM (a 60 s answer ≈ 15–20 min). Rejected — see
    [`benchmarks/stt.md`](../benchmarks/stt.md). Piper has no GGUF path.
  - Follow-up is the "Find a lighter STT model/runtime" item above.
  - look into google's gemma models, find the smallest llm model that is good in multilingual stuff and being a language tutor

## UI

- [ ] **Mode-coloured background glare.**
  The background light glare should be blueish-green in casual mode and red in exam mode.
  Outside a session it should use the app accent colour.

## UX

- [ ] **Automatic Groq free-model rotation.**
  The app should pick and rotate between Groq free models automatically, based on:
  - priority
  - per-language linguistic ability
  - tokens per day
  - tokens per minute

## Done

- [x] Paper-textured background and matching textured cards, to give a learning vibe.
