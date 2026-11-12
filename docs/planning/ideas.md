# Ideas & Todo

Current, unimplemented ideas only. Completed and rejected ideas are in
[`archive/ideas.md`](./archive/ideas.md). Bugs live in [`bugs.md`](./bugs.md). The workflow is in
[`README.md`](./README.md).

When an idea ships or is rejected, move it to the archive under a dated heading and remove it
from this file.

> Last reviewed: 2026-11-07.

## Product

- [ ] **Add a streak system.**
- [ ] add localisation 

## Models and performance

- [ ] **Bring Persian (and other cloud-only languages) onto the device.** Persian ships today as a
  cloud-only language (Groq speech-to-text, a cloud LLM, a cloud voice) because no local model has
  passed the human gates. Find lightweight local STT/TTS options for cloud-only languages (Persian,
  Arabic, Urdu, Hindi/Bengali, Korean, Vietnamese…), measure them like the model lab did, and turn
  the registry's `local` flags back on once one is good enough. The local path, and what it needs,
  is described in
  [`docs/architecture/supported-languages.md`](../architecture/supported-languages.md#persian-fa--cloud-only).

- [ ] **Find a lighter STT model or runtime.** Research
  [`model_problem.md`](../research/model_problem.md) and look for alternatives manually.
  - The local STT (`whisper-small` q4 via Transformers.js) holds about 1.9 GB of RAM for a
    299 MB download.
  - Work through the document's "Research directions" for something that meets its gates: about
    5.5% WER, near real time, far less RAM, and runs in the Android WebView.
  - Record every candidate and its result back in that document.

- [ ] **Evaluate a small multilingual local LLM for tutoring.** Find the smallest local model
  that is good enough at multilingual correction and explanation, and can run on a learner's
  machine. The old wllama note suggested looking at Google's Gemma models.

- [ ] **Find a TTS provider with more daily credits than ElevenLabs.** Look for a voice service
  with a higher free allowance, or a local option that is good enough for read-back.
