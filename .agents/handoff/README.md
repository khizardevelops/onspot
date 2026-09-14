# .agents/handoff

This folder is the project brain for AI agents working in this repository.

## Required Agent Workflow

1. Read this file first.
2. Read every other file in this folder before changing code.
3. Keep the relevant files updated as work progresses.
4. Before ending a session, update memory/state.md, memory/tasks.md,
   and memory/last-session.md.
5. Do not read archive/ by default. Open a specific snapshot only when
   the task needs historical context.

## Layout

- memory/: mutable session state. Expect to rewrite these as work moves.
- rules/: standing guardrails. Obey these; change them rarely and deliberately.
- references/: project background and tracked problems. Consult as needed.

## Files

### memory/ — session state

- memory/state.md: current implementation status and system shape.
- memory/pipeline.md: how work and data flow through the system end to end.
- memory/tasks.md: next actionable tasks.
- memory/last-session.md: handoff notes from the most recent session.
- memory/decisions.md: settled technical decisions and tradeoffs.

### rules/ — standing guardrails

- rules/style.md: coding and writing style preferences.
- rules/constraints.md: hard rules and limits.

### references/ — background and tracked problems

- references/overview.md: project intent, goals, and non-goals.
- references/glossary.md: project-specific terms.
- references/roadmap.md: near-future direction.
- references/assumptions.md: what is being taken as true, and what still needs verification.
- references/bugs.md: active defects that can be fixed within the current foundational technology.
- references/known-issues.md: foundational technology limits that require replacement or architectural change to resolve.
- references/commands.md: project-specific command reference.
