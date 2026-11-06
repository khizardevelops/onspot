# Archived bugs

> Archived 2026-11-03 from `docs/planning/bugs.md`. Frozen; current bugs are in
> [`docs/planning/bugs.md`](../bugs.md).

## Archived 2026-11-03

### Start speaking was available without an LLM provider (fixed 2026-10-03)

Practice now checks every processing requirement before a take. If the LLM is not configured, the
main action becomes **Set up LLM** (or **Install data** for a missing local model) and links to
the right Settings section. `startRecording()` also refuses as a second guard. The old behaviour
let the learner speak and only failed after the take.

### A wrong-language take could read as a clean take (fixed 2026-10-03)

The evaluation now returns `spokenLanguage`. When the learner answers in another language,
`normalizeEvaluation` replaces the corrections with one grammar error covering the whole
transcript ("Answered in X instead of <language>"), so the take is never presented as clean and
Insights counts it. Local Whisper is forced to the target language, which remains a limitation;
see the comment in `adapters/llm/evaluate.ts`.
