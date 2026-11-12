# PHASE 4 — The LLM pipeline: client, evaluation, repair, explanation, pacing

Standing context: Master Strategy Prompt; P0–P3 merged. The practice loop
now runs on the core but still calls the legacy TS evaluation host adapter.

## Mission

Port the entire `src/lib/adapters/llm/` pipeline to Rust with **byte-identical
model-facing behavior** (invariant I5) and retire the legacy evaluation host
adapter from P3. This module is the app's brain: `client.ts` (~379),
`prompt.ts`, `evaluate.ts`, `jsonRepair.ts`, `explanation.ts`,
`glossary.ts` stays for P5, `pacing.ts` (~482), `providers.ts`,
`deepseekBalance.ts`, `languageGuidance.ts`, `translationPrompt.ts`
(translated in P5; the *prompt builder* can land here with its golden
fixtures — implementer's choice, document it).

## Tasks

1. **Capture more goldens first.** Extend the P0 harness:
   - Prompt rendering: for each mode (`exam`/`casual`) × level (A1–C2) ×
     target language (French + the Japanese config even if hidden) ×
     instruction language: render today's TS prompts on synthetic inputs and
     store the exact strings. The Rust renderer must reproduce them
     byte-identical; a test hashes each fixture.
   - Evaluation parsing: canned provider responses covering: clean JSON;
     markdown-fenced JSON; `stripThinking` cases (`<think>` blocks);
     truncated output at the token limit (the `closingBrace`
     string-awareness cases); duplicate keys; wrong category values; >MAX
     vocabulary suggestions; missing follow-up. Capture today's TS parser
     output as expected values.
   - Explanation composition: `composeExplanation`, `formatExplanation`,
     `separateFollowUp`, `normalizeFollowUp`, `speakableExplanation`,
     `EXPLANATION_MAX_MISTAKES` edge cases.
2. **`LlmProvider` port + adapter** (`crates/adapters/llm-openai`):
   - OpenAI-compatible chat completions over the `HttpClient` port: native =
     `reqwest` (inherit proxy/timeout behavior from `client.ts`), web = host
     `fetch` shim. Streaming: verify whether `client.ts` streams; port
     whatever it does, no more.
   - Port `providers.ts` catalog, `deepseekBalance.ts` quirk handling, and
     `pacing.ts` (token-bucket/pacing decisions with the `Clock` port — the
     handoff notes it refills continuously, "2 tokens over → try again in
     15ms"; reproduce exactly, test deterministically).
   - API keys come from `SecretStore` only; keys never enter logs, events,
     errors, or the database (I3; add a redaction test on error paths).
3. **Use cases** (`onspot-app::evaluation`):
   - `TestLlmConnection` (replaces the settings-page "Test connection" call —
     rewire it behind the toggle in this phase, including its provider error
     passthrough formatting).
   - `EvaluateAttempt`: build messages (I5) → send (pacing) → repair → parse
     → compose explanation → emit `evaluation_started`/`finished` events →
     return the `EvaluationResult` shape that `persistAttempt` already
     stores (the serde model must round-trip today's JSON exactly; test with
     fixture evaluations from the P2 fixture db).
   - `MAX_EVALUATION_TOKENS`, word caps and their config plumbing
     (`lib/config.ts`) port to a core config module.
4. **Rewire** (I7): the P3 `StopAndAnalyze` use case switches from the
   legacy host adapter to the Rust `EvaluateAttempt` when
   `VITE_CORE_BACKEND=core`; flip the default after gates. The legacy
   `adapters/llm/evaluate.ts` path stays for the toggle until P8.
5. **Error handling**: provider HTTP errors, rate-limit responses, malformed
   JSON after repair, and cancellation mid-request must surface as typed
   `CoreError`s with the same user-visible handling the TS catch blocks
   produce today (copy mapping lives in the driver).

## Acceptance gates

- [ ] Byte-identical prompt fixtures across the full matrix (hash test).
- [ ] Evaluation-parsing goldens pass, including truncation and
      `stripThinking` cases; explanation goldens pass.
- [ ] Pacing: deterministic tests reproduce the exact refill/penalty timing
      on a mocked clock; no real sleeps in tests.
- [ ] Manual smoke (web + desktop, `core` backend): a real practice take with
      a real Groq key produces feedback indistinguishable from legacy
      (same structure, same failure handling on an invalid key);
      "Test connection" works from Settings on both runtimes.
- [ ] Redaction test: no key material in any event payload, error, or log.
- [ ] All I1 gates green; boundary check green (no `reqwest` in core crates —
      it lives in the adapter); `.agents/handoff/` updated.

## Out of scope

Translations/word glosses/phrase meanings/insights (P5), usage accounting
(P6), sync (P7).
