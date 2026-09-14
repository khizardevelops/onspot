# Groq account models

What a specific Groq API key can actually reach, probed on **2026-09-14**. The app's provider
dropdown only ships two GPT-OSS defaults; this is the full picture from the account, including
rate limits, so nobody re-probes from scratch.

## Method

Read the key from a local file (never printed or logged), then:

1. `GET https://api.groq.com/openai/v1/models` to list what the key can see.
2. `POST https://api.groq.com/openai/v1/chat/completions` once per model with
   `max_tokens: 1`, so each model registers in the dashboard metrics and the response exposes its
   `x-ratelimit-*` headers.

Rate limits below are the per-model values returned in those headers, not the docs' published
tiers. They can change with the account's service tier.

## Results

| model | chat | RPM | TPM | context | max completion |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | ✅ | 1000 | 8 000 | 131 072 | 65 536 |
| `openai/gpt-oss-20b` | ✅ | 1000 | 8 000 | 131 072 | 65 536 |
| `openai/gpt-oss-safeguard-20b` | ✅ | 1000 | 8 000 | 131 072 | 65 536 |
| `qwen/qwen3.6-27b` | ✅ | 1000 | 8 000 | 131 072 | 16 384 |
| `qwen/qwen3.8-27b` | ✅ | 1000 | 8 000 | 131 042 | 16 384 |
| `groq/compound` | ✅ | 250 | 70 000 | 131 072 | 8 192 |
| `groq/compound-mini` | ✅ | 250 | 70 000 | 131 072 | 8 192 |
| `allam-2-7b` | ✅ | 7 000 | 6 000 | 4 096 | 4 096 |
| `meta-llama/llama-prompt-guard-2-22m` | classifier | 14 400 | 15 000 | 512 | 512 |
| `meta-llama/llama-prompt-guard-2-86m` | classifier | 14 400 | 15 000 | 512 | 512 |
| `canopylabs/orpheus-v1-english` | ❌ TTS | — | — | 4 000 | 50 000 |
| `canopylabs/orpheus-arabic-saudi` | ❌ TTS | — | — | 4 000 | 50 000 |
| `whisper-large-v3` | ❌ STT | — | — | 448 | 448 |
| `whisper-large-v3-turbo` | ❌ STT | — | — | 448 | 448 |

## Notes

- **Llama 3.1 8B and Llama 3.3 70B are absent from the account list entirely.** They are
  Enterprise-only on Groq; a standard key gets `model_not_found` (404). This is why the app's
  curated Groq dropdown contains only the GPT-OSS models.
- **The GPT-OSS / Qwen tier is only 8 000 tokens per minute.** One onspot evaluation can request
  up to 2 048 output tokens (the pacing cap) plus the system prompt and transcript, so firing
  several evaluations inside a minute will trip a 429. If that becomes a problem, lower
  `MAX_EVALUATION_TOKENS` in `src/lib/config.ts` or switch to a Compound model (70 000 TPM).
- `whisper-large-v3(-turbo)` return `does not support chat completions` — they are speech-to-text.
  Cloud transcription uses `whisper-large-v3-turbo` through the **transcriptions** endpoint, not
  chat.
- `canopylabs/orpheus-*` are text-to-speech and additionally require an org admin to accept terms
  before use.
- `meta-llama/llama-prompt-guard-2-*` answered 200 only because the probe sent exactly one user
  message with no system prompt; they are prompt-injection classifiers, not usable for language
  evaluation.
- `allam-2-7b` works but its 4 096-token context is too small for the evaluation system prompt
  plus a full 60-second transcript, so it is not a good candidate here.

## Where this is reflected in the app

- Curated dropdown: `openai/gpt-oss-120b` (default) and `openai/gpt-oss-20b`
  (`src/lib/adapters/llm/providers.ts`).
- The Settings **Refresh model list** button queries `GET /models` and filters out non-chat
  models (speech-to-text, text-to-speech, guards/classifiers), so the models above appear there
  as "From your account".
- Output budget: `MAX_EVALUATION_TOKENS = 2048` in `src/lib/config.ts`, derived from the
  60-second / 240-word pacing estimate.

See also [`approved-tech.md`](./approved-tech.md) for the STT/TTS model verdicts.
