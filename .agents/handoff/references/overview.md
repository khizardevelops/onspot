# Overview

## Intent
**onspot** ("on the spot") is a desktop-first, privacy-focused, offline-capable app that helps
learners move from knowing a language's vocabulary and grammar to *speaking spontaneously*.

The loop: choose the language to study on first run → get a random speaking prompt → record 30–60
seconds → get a real-time transcript → have an LLM analyse errors (grammar, vocabulary,
connectors, naturalness) → hear the corrected phrasing read back naturally.

French is the first approved language. Speech recognition and voice models are not bundled: the
user downloads the approved pair for the selected language on demand (Settings → Language data),
and the app tracks approval status per language in `src/lib/languages/index.ts`.

## Lineage
This repo began as a **model-selection lab** for the speech stack. That work is done; the choices
and their evidence are in `docs/benchmarks/`. The product now consumes those choices:
`whisper-small q4` for local STT, Piper Tom for local TTS.

## Goals
- Run the local speech and language stack **entirely on the device**; cloud is BYOK and optional.
- Work offline once models are cached.
- Be honest and transparent about where audio/text goes (local vs third-party API).
- Keep the learner's data in a database they own and can export and sync to *their* cloud.
- Make adding a language a registry entry after a human quality pass — no app code changes.

## Non-Goals
- Training or fine-tuning models.
- Server-side inference for the local models.
- Being the model-comparison instrument — that was the lab; the verdicts are frozen.
