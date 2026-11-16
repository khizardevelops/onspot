# ADR-010 — P4 LLM boundary: host HTTP, no key in the core

- Status: accepted; provider/model catalog implemented in the P7 closeout (2026-11-14); pacing and the usage ledger superseded by ADR-011 (2026-11-16)
- Date: 2026-11-12 (P4)
- Deciders: migration lead

## Context

The LLM pipeline needs an OpenAI-compatible HTTP call on both runtimes. The
desktop webview cannot reach many local servers through browser CORS, while the
browser has no Tauri HTTP plugin. API keys must never enter the database, logs,
events or exports (I3), and P4's prompt/parser goldens already pin the
model-facing text.

The TypeScript adapter also has provider catalogs, DeepSeek balance checks and a
usage-ledger-backed pacing engine. P6 owns the ledger; the settings/provider
catalog move is P7 (ADR-008).

## Decision

- **The core builds the prompt and parses the reply; the driver performs HTTP.**
  `HttpClient` takes `{ method, url, headers, body, provider }` and returns
  `{ status, headers, body }`. It never receives a key. The host reads the key
  from its `SecretStore` and adds `Authorization`.
- **`LlmProvider` exposes `evaluate` and `test_connection`.** `OpenAiEvaluator`
  lives in `onspot-adapter-llm-openai`; `onspot-app::evaluation` wraps it in the
  `EvaluatorPort` the practice loop already uses. The P3 `core.host_reply`
  evaluation shim is gone from the bridge.
- **Pacing is a core token bucket with the measured rule.** Allowances refill
  continuously at the stated capacity; a request is charged before sending; the
  wait uses the same 120 ms margin. The two deterministic tests pin the
  "8002 over 8000 → 15 ms + margin" case and a full-minute refill. Header
  learning, daily windows and the usage ledger remain P6.
- **Provider catalog and DeepSeek balance stay driver-side.** They are settings
  and quota display data, not model policy; P7 moves the catalog and P6 owns
  the balance/usage ledger.
- **Prompt templates are copied with replacement tokens.** JSON braces make
  `format!` fragile, so templates use `{{language}}`-style tokens; the golden
  hash is the authority.

## Consequences

- No key can appear in a Rust event, log, error or persisted row; the desktop
  path uses the Tauri HTTP plugin, the web path uses `fetch`.
- The browser must allow CORS for the configured endpoint, exactly as today;
  local servers work through the desktop plugin.
- Pacing covers the common per-minute budget but not the P6 ledger; a provider
  with header-only limits may be slower to learn than the legacy path until P6.
- Provider/model UI catalogs remain in TypeScript until P7.
