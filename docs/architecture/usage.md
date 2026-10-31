# Usage monitor

Settings → **Usage** shows how much of each cloud service's limit or credit is left, for the steps
set to Cloud. Practice shows one line under the prompt when something is low or used up.

## What each provider limits

| Provider | Scope | What is limited | Where onspot reads it |
|---|---|---|---|
| Groq (LLM) | per model, per organization | requests/day, tokens/minute, tokens/day | headers (desktop/Android) + device count |
| Groq (Whisper) | per model, per organization | requests/day, audio seconds/hour and /day | headers (requests only) + device count |
| ElevenLabs | per account | characters per billing period | `GET /v1/user/subscription` |
| DeepSeek | per account | prepaid balance (no rate limits) | `GET /user/balance` |
| OpenAI | per model, per organization | requests and tokens per minute | headers (desktop/Android) |
| Local servers | none | none | — |

OpenAI's credit balance is not readable with an API key; the monitor links to the billing page.

## Per model

Groq budgets every model separately, with its own ceilings, so the Groq LLM card has a **model
picker** (chips). It lists, in a stable order, the app's Groq model list, the other chat models in
Groq's published table, and any model this key has called; the model in use is always there,
marked **In use** and selected by default. Picking another model shows that model's own meters and
estimate; when Settings switches the LLM model, the card goes back to the model in use. Models Groq
does not publish limits for (Compound, Compound Mini, Qwen 3.6 at the time of writing) say so and
show what this device sent to them in the last 24 hours. Speech-to-text has a single Groq model the
app can use, so it has no picker.

`publishedLimits.ts` holds both of Groq's tables, Free and Developer (from the `rows` and `devRows`
the docs page embeds). The Developer table applies when a live reading shows a daily request ceiling
above the Free one (desktop/Android only); the browser assumes Free, and a limit Groq states in a
refusal still corrects each model on its own. On the Free plan, GPT-OSS 120B/20B and Qwen 3.8 share
the same ceilings (1K requests/day, 8K tokens/minute, 200K tokens/day) but separate budgets;
GPT-OSS Safeguard is lower (3 requests/minute, 2K tokens/minute) and is not a chat model the LLM
step offers.

## Sources, from most to least certain

Every meter says where its figures came from:

1. **Account**: the provider's own account API (ElevenLabs, DeepSeek).
2. **Live**: `x-ratelimit-*` headers on the latest response. Groq's request pair is per day and its
   token pair per minute; OpenAI's are both per minute. **Browsers cannot read them**: neither
   provider lists them in `access-control-expose-headers` (checked 2026-10-30), so only the Tauri
   apps, whose HTTP client is not bound by CORS, see them.
3. **Reported**: the limit a provider names when it refuses a call ("… tokens per day (TPD):
   Limit 200000, Used 199052 …"). Every runtime can read a refusal body, and its limit replaces the
   published one, so a paid plan's higher limits show up.
4. **Counted**: what onspot sent from this device (tokens from the response `usage`, seconds of
   audio, characters of text), against Groq's published free-plan limits
   (`src/lib/usage/publishedLimits.ts`, dated). Tokens per day and audio never appear in headers,
   so these are always counted.

Groq and OpenAI refill linearly: one used request of 1 000/day reset in 86.4 s and 73 of
8 000 tokens/minute in 547 ms. Live and reported readings are therefore aged forward at
`limit / window` instead of going stale; counted figures use rolling windows (minute, hour, day).

## Estimates

Numbers become decisions:

- **LLM**: takes left today = min(tokens left ÷ tokens per take, requests left), plus takes per
  minute. Tokens per take is this device's average over the last day (calls under 600 tokens are
  connection tests), 2 500 until there is one. **Per minute, Groq admits a call only if this
  minute's used tokens plus the call's reservation (prompt + `max_tokens`, ~4 850 for an
  evaluation) fit**: a 429 reported "Used 4716, Requested 4841" against 8 000. So takes per minute
  = ⌊(TPM − reservation) ÷ tokens per take⌋ + 1 (two on the free plan, not three), and a per-minute
  limit below the reservation is an error: no take can succeed on that model. The client records
  each call's reservation (`CloudCall.reservedTokens`).
- **Speech-to-text**: minutes of speech left today and this hour.
- **ElevenLabs**: read-alouds left before the allowance refills, at this device's average length.

## Storage and privacy

The record (`onspot.usage.v1` in `localStorage`) holds a day of calls, the latest headers and
refusals. It is keyed by a hash of the API key, never the key, so two accounts never mix and the
record is meaningless without the key. Like the keys, it never reaches the synced database.

## Code map

| Concern | File |
|---|---|
| Record of calls, headers, refusals | `src/lib/usage/ledger.ts` |
| Header, duration and refusal parsing | `src/lib/usage/rateLimits.ts` |
| Groq's published limits | `src/lib/usage/publishedLimits.ts` |
| Meters, estimates, warnings | `src/lib/usage/monitor.ts` |
| Number and time formatting | `src/lib/usage/format.ts` |
| ElevenLabs allowance | `src/lib/speech/tts/cloud/elevenLabsAccount.ts` |
| DeepSeek balance | `src/lib/adapters/llm/deepseekBalance.ts` |
| Settings → Usage | `src/lib/components/settings/UsageMonitor.svelte`, `UsageMeterRow.svelte` |
| Practice notice | `src/routes/+page.svelte` |

Calls are recorded in `adapters/llm/client.ts` (chat completions), `GroqWhisperAdapter.ts`,
`ElevenLabsTtsAdapter.ts` and `OpenAITtsAdapter.ts`. A new cloud adapter should call `recordCall`
after a successful response and `recordRefusal` on an error body.

## Verified (2026-10-30, browser build)

Real takes recorded Groq Whisper audio, a 2 527-token evaluation and ElevenLabs characters; the
Usage tab showed Groq per model (counted, with the browser note), ElevenLabs per account
(7 780 of 10 000 characters, refill date, about 48 read-alouds) and local steps as "no limits". An
injected Groq TPD refusal turned the gauge red, dropped the estimate to one take and showed the
Practice notice. Parsers pass the real header values and Groq/OpenAI refusal formats. **Not
verified**: live headers in the Tauri apps, DeepSeek's balance with a real key, OpenAI headers.
