# Archive

Every document in `docs/` is either **active** or **archived**. This folder holds the archived
ones, for the whole of `docs/`: planning, architecture, benchmarks, research, reference,
prompts, scratch, and any folder added later.

## Active vs archived

| | Active (`docs/`, everything outside `archive/`) | Archived (`docs/archive/`) |
|---|---|---|
| **Holds** | What is true and relevant **now**. | What **used to be** relevant: finished, superseded, or old. |
| **Size** | Lean and scannable. | As large as it needs to be. |
| **Edited?** | Yes, as work moves. | No. Frozen once archived. |
| **Read by default?** | Yes, by people and agents. | No. Opened only when a task needs the history. |

**Active documents are not logs.** No file in `docs/` should keep growing into a record of
everything that ever happened in the project. When information stops being useful day to day,
it moves here. That keeps space free and the active documents readable.

## The archive mirrors `docs/`

`docs/archive/` replicates the exact folder tree of `docs/`. Archived content goes to the same
path it had when active, with `archive/` inserted after `docs/`:

```
docs/<folder>/<subfolder>/<file>   →   docs/archive/<folder>/<subfolder>/<file>
```

```
docs/                                     docs/archive/
├── planning/                             ├── planning/
│   ├── ideas.md            ──────────►   │   ├── ideas.md
│   └── bugs.md             ──────────►   │   └── bugs.md
├── benchmarks/                           ├── benchmarks/
│   └── stt.md              ──────────►   │   └── stt.md
├── research/                             ├── research/
│   └── model_problem.md    ──────────►   │   └── model_problem.md
└── reference/groq_free/                  └── reference/groq_free/
    └── chat_completions.csv ─────────►       └── chat_completions.csv
```

Create the folders in `archive/` as needed, matching `docs/` one-for-one. The tree is the
lookup: anything archived from `docs/X/Y.md` is always at `docs/archive/X/Y.md`.

This applies to two cases:

- **A whole file or folder is retired.** Move it to its mirrored path. Nothing stays behind in
  the active tree, except an optional pointer (below).
- **Part of a file is archived.** Cut the old part and append it to the mirrored file at the
  same path, e.g. old sections of `docs/planning/ideas.md` go into
  `docs/archive/planning/ideas.md`. The newest archived batch goes at the top under a dated
  heading, `## Archived 2026-10-01`. The active file keeps only what is current.

## When to archive

Archive content when it is:

- **Done:** completed ideas, fixed bugs, closed checklists.
- **Superseded:** a benchmark replaced by a newer run, a design or plan that was replaced, a
  rejected approach whose evidence no longer needs to sit beside the current decision.
- **Stale:** about code, tools, providers or models the project no longer uses.
- **Crowding out the present:** a file or folder is big enough that the current information is
  hard to find.

Keep it active when it is still being worked on, is the evidence behind a decision still in
force, or is looked up regularly. If in doubt, keep a one-line summary active and archive the
detail.

## How to archive

1. **Move, don't copy.** The content leaves the active document. Having it in both places
   defeats the purpose.
2. **Use the mirrored path.** Same folders, same subfolders, same file name, under
   `docs/archive/`.
3. **Mark it.** A file archived whole starts with a note; an appended batch has its dated heading:

   ```markdown
   > Archived 2026-10-01 from `docs/research/model_problem.md`. Frozen; see `docs/` for current state.
   ```

4. **Pointer only if useful.** If the active document still benefits from knowing the history
   exists, leave one line, e.g. "Older runs: `archive/benchmarks/stt.md`". Otherwise leave no
   trace.
5. **Fix references.** Update links in other docs, `.agents/handoff/` and code comments that
   pointed at the moved content. Link to the archived path, or to the active replacement.

## Rules for this folder

- **Frozen.** Don't edit archived content, except to fix a broken link or append a new archived
  batch. If something becomes relevant again, move it back into the active tree and continue
  there.
- **Never the source of truth.** If an archived file disagrees with an active one, the active
  one wins.
- **Only the archive tree lives here.** No new documents are written here directly. Everything
  in `archive/` arrived by being moved out of `docs/`. This README is the only exception.
- **Not read by default.** People and agents open a specific archived file only when a task
  needs historical context. The same rule applies to `.agents/handoff/archive/`.
