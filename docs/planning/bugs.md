# Bugs

Current, unpatched bugs only. Fixed bugs are in [`archive/bugs.md`](./archive/bugs.md).
Agent-tracked defects with root causes live in `.agents/handoff/references/bugs.md`. The workflow
is in [`README.md`](./README.md).

When a bug is fixed, move it to the archive under a dated heading and remove it from this file.

> Last reviewed: 2026-11-03.

## App

- [X] **Reduce the spacing around attempt cards.** The cards should use as little surrounding
  padding as possible, so more of the screen is available for the take and the cards feel like
  part of the page rather than separate panels. The current desktop page gutter is 28 px, the
  card gap is `clamp(24px, 5vh, 44px)`, and phones use a 12 px gutter with edge-to-edge cards.

- [ ] **Lock a session to the language it started in.** The global "I'm studying" language should
  only choose the default for new sessions and preload its language data. Reopening an older
  session must keep that session's language and prompts, even if the global language has changed.
  Once a session has started in a language, it cannot switch.

- [] the audio of some local tts is either too loud or too slow. normalise the audio before output
