# Ideas & Todo

Current, unimplemented ideas only. Completed and rejected ideas are in
[`archive/ideas.md`](./archive/ideas.md). Bugs live in [`bugs.md`](./bugs.md). The workflow is in
[`README.md`](./README.md).

When an idea ships or is rejected, move it to the archive under a dated heading and remove it
from this file.

> Last reviewed: 2026-11-06.

## Product

- [ ] **Add a streak system.**

- [ ] **Support iPhone and iPad as a PWA.** iOS is the only platform without onspot, and the App
  Store needs a paid Apple account, so ship the web build as an installable home-screen app
  instead. The full brief for the implementing agent, with phases, iOS limits to verify and the
  questions to answer first, is [`docs/prompts/ios-focused-pwa.md`](../prompts/ios-focused-pwa.md).
  - **2026-11-06:** the installable PWA is live at
    [onspot.khizardevelops.workers.dev](https://onspot.khizardevelops.workers.dev). It is a
    Cloudflare Workers static-assets site deployed with `cf deploy --prebuilt` (the `cf` CLI cannot
    build SvelteKit directly), with manifest/icons/launch images, a production-only offline
    service worker, update prompt, and the iPhone/iPad install guide. Browser-verified. Remaining:
    verify on a real iPhone/iPad, test Google Drive and local models there, add the new origin to
    the Google OAuth client, and keep the old GitHub Pages origin up with an export-and-move
    notice.

- [ ] lets try out adding persian support for this. we will only use the cloud api key provided for inference and tts, sst, and llm. once we beautifully implement support for persian (and right-to-left languages) then we ill figure out finding the best light weight local models for these cloud / online only supported languags



## Models and performance

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
