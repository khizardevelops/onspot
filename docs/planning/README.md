# Planning

How the project's active ideas and bugs are tracked, and how agents should use this folder.

## What lives here

| Path | Holds | Edited? |
|---|---|---|
| [`ideas.md`](./ideas.md) | Current, unimplemented ideas and planned work. | Yes |
| [`bugs.md`](./bugs.md) | Current, unpatched bugs. | Yes |
| [`archive/`](./archive/) | Frozen history of finished ideas and fixed bugs. | No |
| `README.md` | This workflow. | Rarely |

Finished work does not stay here. It moves to [`archive/`](./archive/):

```text
docs/planning/ideas.md   ->   docs/planning/archive/ideas.md
docs/planning/bugs.md    ->   docs/planning/archive/bugs.md
```

Planning keeps its history inside this folder, so all planning data stays together. The general
archive rule is in [`docs/archive/README.md`](../archive/README.md); planning is its one exception.

## The rule

**The active files contain only what is still open.** If an idea ships or is rejected, or a bug is
fixed, move it to the archive under a dated heading and delete it from the active file. Do not keep
a done item "for history" in the active file.

History is frozen. If an archived entry disagrees with an active one, the active one wins.

## Before you start

1. Read [`ideas.md`](./ideas.md) and [`bugs.md`](./bugs.md) before proposing or starting work.
2. Check `.agents/handoff/memory/state.md`, `tasks.md` and `last-session.md` for current session
   state. Those files are the session ledger; this folder is the durable backlog.
3. Check `.agents/handoff/references/bugs.md` for agent-tracked defects with root causes.
4. Do not read `docs/planning/archive/` by default. Open a specific archived file only when the
   task needs historical context.

## Adding an idea

- Put it in the closest section of `ideas.md`: **Product**, **Models and performance** or **UI**.
- Use `- [ ] **Short title.**` followed by one or two sentences saying what to do and why.
- Include evidence or a link when the idea depends on a measurement, a model or an external
  service.
- If the idea is really a bug, put it in `bugs.md` instead.
- If it is a design decision already made, record it in `.agents/handoff/memory/decisions.md`,
  not here.

## Adding a bug

- Put it under `## App` in `bugs.md`. Add another section only when the list grows enough to need
  one.
- Say what happens, what should happen, and how to reproduce it.
- Include the platform and version when they matter.
- Do not paste API keys, tokens or personal data.
- If the bug has a known root cause, put the root cause in
  `.agents/handoff/references/bugs.md` and keep the active entry user-facing.

## Finishing an item

1. Cut the entry from the active file.
2. Append it to the matching archive file under a dated heading: `## Archived YYYY-MM-DD`.
3. Keep enough context to understand it later: what was done, the date, and the evidence.
4. For a rejected idea, say why it was rejected and link the evidence.
5. Fix any links that pointed at the old location.
6. Update the `> Last reviewed: YYYY-MM-DD` line at the top of the active file.

Use the `archive/` folder under this directory. Do not create `history.md`, `done.md` or a second
backlog.

If something archived becomes relevant again, move it back to the active file and continue there.

## Formatting

- Use British English (`colour`, `behaviour`, `recognise`, `licence`, `centre`).
- Use one `- [ ]` checkbox per open item.
- Lead with a bold title, then a short paragraph. Keep the active files scannable; they are not
  logs.
- Keep the idea sections in this order: **Product**, **Models and performance**, **UI**.
- Dates are `YYYY-MM-DD`.

## What not to put here

- Session state, handoff notes or "what I did today": those belong in `.agents/handoff/`.
- Fixed bugs or shipped ideas: those belong in `docs/planning/archive/`.
- Architecture decisions: `.agents/handoff/memory/decisions.md`.
- Measured numbers: `docs/benchmarks/`.
- Open research: `docs/research/`.
