# Roadmap

## Near-Term
- **Phase 3 — BYOC sync.** Google Drive (OAuth 2.0 PKCE, client-side), WebDAV, and local
  `.sqlite` export/import.
- Complete one real local Whisper + configured LLM practice run after the full model download.
- Apply the listening-test EQ/loudness pass to Piper Tom.

## Completed
- **Phase 1 — foundation.** SvelteKit SPA, Tauri shell, cross-origin isolation, and dual-runtime
  database abstraction.
- **Phase 2 — speech + AI pipeline.** Mic capture, worker-hosted local Whisper / Groq STT, LLM
  evaluation, persistence, and Piper / cloud TTS.
- **Phase 4 — product UI.** Practice, History, Insights, Settings, the attempt conveyor, and
  per-attempt strict translation v2 with progressive disclosure.

## Medium-Term
- Grow the prompt set and topic generation beyond the prototype's static list.
- Pronunciation scoring beyond WER (the transcript already gives word-level signal).
- Spaced-repetition surfacing of recurring corrections (the analytics already aggregate them).
- Raw `.sqlite` byte export for Tauri (the current export is a portable SQL dump).

## Out Of Scope
- Training, fine-tuning or exporting models.
- Server-side inference for the local models.
- Re-litigating the STT/TTS model choices without new evidence.
