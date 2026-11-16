<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# ADR-011 — The usage ledger and rate-limit pacing live in the core

- Status: accepted
- Date: 2026-11-16 (completion of P6/P8)
- Deciders: migration lead, after the post-P8 review

## Context

P4 moved every LLM request into `onspot-adapter-llm-openai`, but P6 left the
usage ledger in TypeScript (`usage/ledger.ts`, browser `localStorage`). The
review found the consequences:

- **LLM usage went uncounted.** Only the TypeScript client and the cloud speech
  adapters wrote to the ledger, so evaluations, translations, glosses and
  prompt topics made by the core never reached the usage monitor.
- **Pacing did nothing.** The Rust client kept a simplified token bucket inside
  `OpenAiEvaluator`, and the bridge built a new evaluator for every request, so
  every request started with an empty bucket. It also assumed 8,000 tokens a
  minute for every provider (slowing paid plans and local servers) and never
  learnt the limits a refusal or the `x-ratelimit-*` headers state.
- **Per-caller options were dropped.** `complete()` ignored its temperature,
  translations were sent without JSON mode, and every request used a fixed
  reply budget instead of one sized to the text.
- **The wrong key could be sent.** The endpoint's key slot was guessed from the
  URL host, so a local server got the custom provider's key.

## Decision

- **`onspot-app` owns the ledger (`usage_ledger::UsageLedger`) and the pacing
  (`usage_pacing::RequestPacer`)**, a line-for-line port of `pacing.ts` and the
  stateful half of `ledger.ts`. `Core` holds one pacer (and through it one
  ledger) for the whole run, so concurrent requests see each other.
- **`onspot-adapter-llm-openai` depends on `onspot-app`.** The adapter uses the
  pacer, the ledger and the provider catalog (model labels in error copy)
  directly. Dependencies still point inward (adapter → app → ports → domain);
  the alternative, a wide pacing port in `onspot-ports`, would have duplicated
  the pacer's types for a single caller.
- **A new port, `DeviceStore`**, holds values that belong to the device and must
  never enter the synced database. The ledger is saved under the key the web
  driver always used, `onspot.usage.v1`, in the same JSON shape, so an existing
  record carries over. Drivers that keep values themselves answer the host calls
  `device.read`/`device.write` (the webview: `localStorage`, refusing any key
  under the secret prefix); the CLI stores a JSON file beside its keyfile.
- **Driver-side cloud engines report through the core.** Groq speech
  recognition and the ElevenLabs/OpenAI-compatible speech adapters call
  `usage.record_call` / `usage.record_refusal` with a key *hash* (`keyId`),
  never a key. `LlmEndpoint` carries the same `keyId`.
- **`LlmEndpoint.provider` is the key slot**: `local` for a local server,
  otherwise the chosen provider (`groq`, `deepseek`, `custom`), from one rule
  (`llmKeySlotFor` in TypeScript, `resolve_endpoint` in Rust) pinned by
  `request-endpoints.json`. The setup guide tests an unsaved key through a
  transient `candidate` slot that only the host can read.
- **Pacing waits are events.** `pacing_wait_changed` restores the Practice
  screen's "Groq's per-minute limit: continuing in N s…" notice.

## Consequences

- `usage/ledger.ts`, `rateLimits.ts`, `publishedLimits.ts` and
  `adapters/llm/{client,pacing,jsonRepair}.ts` are archived under
  `deprecated/`; `fetchWithTimeout` moved to `platform/` for the speech adapters.
- `usage.snapshot` no longer takes the ledger from the driver.
- The browser practice check now fails if any LLM or speech call is missing
  from the ledger.
