# Contributing to onspot

Thanks for taking the time. onspot is a solo-maintained project, so small, focused contributions
are much easier to review than large ones. You do not have to write code to help.

## Ways to help

- **Test on your platform.** Windows and macOS testing is especially valuable; the maintainer
  develops on Linux and Android.
- **Report a confusing correction.** If onspot marks something that is actually correct, or misses
  something a teacher would catch, that is a useful bug report.
- **Improve the docs.** Setup steps, troubleshooting, screenshots and clearer wording all count.
- **Add example prompts.** Good prompts make the practice loop better for everyone.
- **Review a language or voice.** A language only ships after a human has listened to its voices
  and checked its transcripts.
- **Suggest a model or voice with evidence.** Read [`docs/languages.md`](docs/languages.md) and
  [`docs/benchmarks/README.md`](docs/benchmarks/README.md) first.

## Before you start

1. Read the [README](README.md).
2. Read [`docs/languages.md`](docs/languages.md) for the language approval rules.
3. For architecture and project decisions, read [`.agents/handoff/README.md`](.agents/handoff/README.md).
4. Open an issue before starting a large change, so we can agree on the approach.

## Development setup

You need Node.js 20.19+ or 22.12+, [bun](https://bun.sh), and a modern Chromium or Firefox browser.
Desktop builds also need the [Rust toolchain and Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
git clone https://github.com/khizardevelops/onspot.git
cd onspot
bun install

# Restore the French pronunciation data (18 MB, gitignored)
mkdir -p static/piper-wasm
cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} static/piper-wasm/

bun run dev          # web app at http://localhost:5173
bun run tauri dev    # desktop app
```

Before opening a pull request, run:

```sh
bun run check        # type-check
bun run build        # static production build
bun run spdx:check   # licence headers
```

For UI, speech or storage changes, verify the behaviour in a real browser and say which browser,
operating system and device you used. A passing type-check is not evidence that the app works.

## Code style

- Follow the patterns already in the codebase. One responsibility per file; small, named functions.
- Use names that say what things are. No magic numbers or strings; name the value and say where it
  came from when it is a measurement or a specification.
- Comments explain **why**, not what the code already says.
- Keep heavy work off the interface thread: transcription, speech synthesis and database work run in
  their own workers.
- Use the existing `@dvcol/neo-svelte` components. Do not add a second UI library or hand-roll a
  widget that neo already provides.
- Do not instrument production code for a test, demo or sandbox. Use the clone-and-clean components
  in `src/routes/ui-sandbox/` instead.
- User-facing copy and docs use **British English** spellings (`colour`, `recognise`, `licence`,
  `behaviour`, `organise`, `analyse`). Match the existing text.
- When you replace something, delete the old path in the same change.

## Language contributions

A language is not a settings toggle. Adding one means:

1. Choosing a speech-to-text model and a voice that actually work in a real browser.
2. Measuring transcription quality on human-transcribed speech. Report aggregate word error rate
   (or character error rate for unspaced scripts), never a single clip.
3. Writing or adapting the evaluation and translation prompts.
4. Running a human listening test on the voices and a transcript review.
5. Adding the language to the registry in `src/lib/languages/index.ts` with its approval record and
   evidence links.
6. Updating [`docs/architecture/supported-languages.md`](docs/architecture/supported-languages.md).

A language is only offered in production once it is approved. Development builds may show
candidates marked as unapproved. Do not open a pull request that only adds a language name without
the evidence.

## Model and voice contributions

- A model card is only accepted once it has loaded and produced output in a real browser.
- Rank models on aggregate measurements, not one clip.
- One card per download. Configuration on a card is only for choices that reuse the same weights.
- Check the model and voice licences, and add the attribution the licence requires.
- Do not commit model weights. They are downloaded from their public hosts at runtime.

## Pull requests

- Keep each pull request to one concern. Split refactors from behaviour changes.
- Explain **what** changed, **why**, and **how you tested it**.
- Link the issue it closes.
- Include before/after screenshots for UI changes.
- Update the README, docs or handoff notes when behaviour or architecture changes.
- Never commit API keys, tokens or `.env` files.

## Commit messages

Use the imperative mood and say what the commit does:

```
Fix the phone feedback sheet drag
Add the language-request issue template
Document the local LLM setup
```

## Review

onspot is maintained by one person. Reviews may take a while, and a large pull request may be
asked to split. A contribution that ignores the language or model rules may be closed rather than
merged. That is not personal; it protects the quality bar the app is built on.

## Licence

onspot is free software under the **GNU Affero General Public License v3.0 or later**. By
contributing, you agree that your contribution is licensed under the same terms. Model weights and
voices keep their own licences; list them in the documentation.

## Code of conduct and security

- Read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md). Do not open a
  public issue for a security problem.
