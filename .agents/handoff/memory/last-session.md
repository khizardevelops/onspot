# Last Session

## Outcome
Built a standalone, **1:1 interactive** sandbox of the chat-history UI under
`src/routes/ui-sandbox/`, per the revised `docs/prompts/ui-capture.md`, with production untouched.

### Approach: clone and clean, keep interactivity
- The earlier "flattened / peak-clutter" sandbox (all `{#if}` removed, all disclosures forced
  open) was replaced. The revised brief asks for the opposite: preserve state logic and
  progressive disclosure so the UI behaves like the real product.
- Production `AttemptStream.svelte`, `AttemptCard.svelte` and `stores/practice.ts` remain
  unmodified.
- New self-contained `Mock*` files under `src/routes/ui-sandbox/components/`:
  - `MockTranscript.svelte` — token split, correction tagging, hover tooltips, click/​keyboard
    selection. `playWord()` replaced with local simulated playback state.
  - `MockAttemptCard.svelte` — all translation state and `{#if}` blocks kept (menu, variants,
    breakdown, segments, voice selector). Store/TTS/LLM calls replaced with local state
    (simulated spinners/playback).
  - `MockAttemptStream.svelte` — explicit card selection, deterministic 1050ms lift, compositor
    conveyor, floor spacer and `ResizeObserver` kept. Practice store replaced with bindable local
    state.
  - `MockFeedbackPanel.svelte` — the correction sidebar (linked transcript marks, read-back
    buttons, session stats), ported out of `+page.svelte` into its own interactive mock.
  - `+page.svelte` — hardcoded realistic live session and bindable active attempt/correction state.

### Hardcoded "live" data
- A French proverb (`Petit à petit, l'oiseau fait son nid`) with idiomatic + two idiomatic
  variants + literal + word-for-word and an ordered word breakdown.
- Four attempts, 15 inline corrections across grammar/register/filler/style with exam status and
  formal alternatives.

### Repomix
- `package.json`: `"bundle:ui": "npx repomix --include \"src/routes/ui-sandbox/**/*.svelte\"
  --output \"repomix/ui-sandbox-bundle.xml\""`.
- Output lives in the gitignored `repomix/` folder, not the repo root. The root is kept clean.
- Bundle: 5 files, ~16.3k tokens. No product files included.

## Verification
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: clean static build.
- Headless Chrome `/ui-sandbox/`: menu starts closed and translations hidden; clicking Translate
  opens the menu; "Compare all three" reveals idiomatic + word-for-word; alternatives/breakdown
  controls; segment panel toggles; voice selector only on the active card; clicking a feedback
  correction highlights the transcript mark and vice versa; clicking a card moves the active
  index and updates the feedback panel; no page errors.

## Limits and next work
- Phase 3 BYOC sync is still next (see `memory/tasks.md`).
- The sandbox is dev tooling only; not linked from the product nav.
