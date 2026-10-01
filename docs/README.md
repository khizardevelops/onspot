# docs

Human-facing project documents. Agent session state (current status, decisions, rules, tracked
defects) lives in `.agents/handoff/`, not here.

Everything outside `archive/` is an **active** document: current, lean, and edited as work
moves. When any file, or part of one, stops being useful day to day, it moves to
[`archive/`](./archive/README.md) at the **same path**: `archive/` mirrors this folder tree
one-for-one. Active docs are not logs. See the archive README for when and how to archive.

| folder | what goes in it |
|---|---|
| [`planning/`](./planning/) | Your working lists: [`ideas.md`](./planning/ideas.md) (ideas, planned work, done) and [`bugs.md`](./planning/bugs.md) (bugs to fix). |
| [`architecture/`](./architecture/) | How the product is built: [`languages.md`](./architecture/languages.md) (how a language is tracked and approved) and [`supported-languages.md`](./architecture/supported-languages.md) (which speech tech each language uses). |
| [`benchmarks/`](./benchmarks/README.md) | Every measured number: STT, TTS, runtime/memory, LLM providers. The one place to update a figure. |
| [`research/`](./research/) | Open problems and how to evaluate fixes: [`model_problem.md`](./research/model_problem.md) (STT RAM usage, all models in use) and [`model-vetting.md`](./research/model-vetting.md) (checks before adopting a model). |
| [`reference/`](./reference/) | Raw external data, e.g. [`groq_free/`](./reference/groq_free/) (Groq free-tier rate-limit CSVs). |
| [`prompts/`](./prompts/) | Prompts given to AI tools: the product inception brief and the UI-capture request. |
| [`scratch/`](./scratch/) | Throwaway text, e.g. sample French dialogue. Nothing here is authoritative. |
| [`archive/`](./archive/README.md) | **Archived** content from any folder above, at its mirrored path (`docs/X/Y.md` → `docs/archive/X/Y.md`). Frozen; read only for history. |
