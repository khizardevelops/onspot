# PHASE 5 — Knowledge features: translations, word glosses, phrase meanings, insights

Standing context: Master Strategy Prompt; P0–P4 merged (LLM pipeline on the
core path).

## Mission

Port the LLM-powered study features that sit on top of the P4 pipeline:
three-way translations of the corrected take, word-by-word glosses, phrase
meanings, and cross-session insights. These features are lazy, cached and
job-like — the job orchestration moves into `onspot-app`.

## Tasks

1. **Goldens first** (same discipline as P4):
   - `translationPrompt.ts` rendering (all versions — but note
     `TRANSLATION_SET_VERSION = 3` in `adapters/db/types.ts` governs current
     behavior; render the v3 prompt byte-identical, keep only what
     regeneration paths need of older versions) and the `TranslationSet`
     response parsing (idiomatic/variants/literal/word-for-word/
     `wordBreakdown`, `instructionLanguage` stamping).
   - `adapters/llm/glossary.ts` (~320): gloss request rendering, response
     shaping, the exact `WordGloss` structures stored per attempt.
   - `insights.ts`: recurring-mistake aggregation over synthetic session
     sets — capture the clustering/filtering output exactly.
2. **Use cases** (`onspot-app`):
   - `EnsureAttemptTranslations` (port the logic in
     `stores/practice.ts::ensureAttemptTranslations` + its persistence via
     `saveWordGlosses`-style repo calls, ~LOC 769–975 — verify), with the
     "current version / instruction language" regeneration rules
     (`translationsCurrent`).
   - `EnsureWordGlosses` and `EnsurePhraseMeaning`: port the job dedup and
     queue semantics (`glossKey`, `glossJobKey` patterns) as in-process
     tasks with `CancelToken`s; concurrent identical requests coalesce.
   - `BuildInsights`: aggregate over all sessions via the repositories;
     emit/serve the data the Insights page renders.
3. **Bridge + events**: commands
   `translations.ensure { attempt_id }`, `glosses.ensure { attempt_id, text,
   word_index }`, `phrases.ensure { attempt_id, text }`,
   `insights.build`; events `translations_ready`, `glosses_ready`,
   `phrase_ready`, `insights_ready`. All payloads `ts-rs`-generated.
4. **Rewire** (I7): the transcript hover/meaning flow
   (`components/wordSelection.ts` stays view-layer — only its *data
   requests* move), `WordGloss.svelte`, `ExplanationText.svelte`,
   `transcriptMeanings.svelte.ts` (its logic parts — verify what is view
   vs logic), `CorrectedPassages.svelte` data paths, and the Insights page
   (`src/routes/insights/+page.svelte`) switch to `core-client` behind the
   toggle; flip default after gates.
5. **Cache semantics**: glosses/translations are stored with their exact
   current cache keys (they must keep hitting existing rows in the fixture
   db; add a "legacy-written row is read by core" test both directions).

## Acceptance gates

- [ ] Golden parity: v3 translation prompt + parsing, glossary prompts +
      parsing, insights aggregation.
- [ ] Coalescing tests: N concurrent identical gloss requests → 1 provider
      call (mocked), all callers satisfied; cancellation leaves no stale
      "in-flight" state.
- [ ] Interop: rows written by the legacy path are read correctly by the
      core path and vice versa (fixture db).
- [ ] Manual smoke (web + desktop, `core` backend): hover a word → meaning
      appears and is cached across restart; translation tabs (idiomatic /
      literal / word-for-word) and `wordBreakdown` render; regenerate after
      switching instruction language works; Insights page lists the same
      recurring mistakes as legacy on the same db.
- [ ] All I1 gates green; `.agents/handoff/` updated.

## Out of scope

Usage accounting (P6), sync/export (P7), any change to view components
beyond their data source.
