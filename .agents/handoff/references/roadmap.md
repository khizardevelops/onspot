# Roadmap

## Near-Term
- Complete one real local Whisper + configured LLM practice run after the full model download.
- Confirm the Piper Tom EQ/loudness processing profile by ear, then approve the next language
  (STT + voice) with a human quality pass and add it to the language registry.
- Verify Google Drive with a live account and client ids (desktop loopback and web popup); the
  code is complete, but no real account was available for the 2026-10-25 pass.
- Run a live ElevenLabs key and a real LM Studio/llama.cpp/Ollama server end to end (preview,
  read-back, correction, and the Tauri desktop path).

## Completed
- **Phase 1 — foundation.** SvelteKit SPA, Tauri shell, cross-origin isolation, and dual-runtime
  database abstraction.
- **Phase 2 — speech + AI pipeline.** Mic capture, worker-hosted local Whisper / Groq STT, LLM
  evaluation, persistence, and Piper / cloud TTS.
- **Phase 4 — product UI.** Practice, History, Insights, Settings, the attempt card stack, and
  per-attempt strict translation v2 with progressive disclosure.
- **Language system.** Registry with per-language approval records, first-run language picker,
  manual cancellable language-data download with a global progress bar, per-voice TTS processing
  (EQ/limiter/normalization), and language-parameterized STT/TTS/prompts.
- **Phase 3 — BYOC sync.** Google Drive (app-private folder; desktop loopback PKCE, web Google
  Identity Services) and WebDAV, with whole-database snapshots, conflict prompts, and a
  non-destructive local restore path (2026-10-25).
- **Per-step processing.** Independent Local/Cloud choices for speech-to-text, the LLM and
  text-to-speech; capability-aware downloads; a local OpenAI-compatible LLM; ElevenLabs and
  OpenAI-compatible text-to-speech; a two-tab Settings page with three inline disclosure rows and a
  searchable voice-picker modal with in-modal preview (2026-10-25).

- **Spoken coaching + usage monitor.** Three-track attempt card (you said / did you mean /
  explanation with learner highlights, auto-played), ElevenLabs free-plan voice filtering, and a
  Settings → Usage monitor per model or per account (2026-10-30). Explanation audio is cloud-only
  until the local approach is decided.

## Medium-Term
- Grow the prompt set and topic generation beyond the prototype's static list.
- Pronunciation scoring beyond WER (the transcript already gives word-level signal).
- Spaced-repetition surfacing of recurring corrections (the analytics already aggregate them).
- An iOS app (needs macOS/Xcode; see `docs/architecture/platforms.md`).

## Out Of Scope
- Training, fine-tuning or exporting models.
- Server-side inference for the local models.
- Re-litigating the STT/TTS model choices without new evidence.
