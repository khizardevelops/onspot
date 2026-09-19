# LLM providers and rate limits

What the app can actually reach through its BYOK OpenAI-compatible providers, with the measured
rate limits. Led by the Groq account probe; DeepSeek and the output budget follow.

## Groq account models

What a specific Groq API key could reach, probed on **2026-09-14**. The app's provider dropdown
only ships two GPT-OSS defaults; this is the full picture from the account, including rate
limits, so nobody re-probes from scratch.

### Method

Read the key from a local file (never printed or logged), then:

1. `GET https://api.groq.com/openai/v1/models` to list what the key can see.
2. `POST https://api.groq.com/openai/v1/chat/completions` once per model with `max_tokens: 1`, so
   each model registers in the dashboard metrics and the response exposes its `x-ratelimit-*`
   headers.

Rate limits below are the per-model values returned in those headers, not the docs' published
tiers. They can change with the account's service tier.

### Results

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

### Notes

- **Llama 3.1 8B and Llama 3.3 70B are absent from the account list entirely.** They are
  Enterprise-only on Groq; a standard key gets `model_not_found` (404). This is why the curated
  Groq dropdown contains only the GPT-OSS models.
- **The GPT-OSS / Qwen tier is only 8 000 tokens per minute.** One onspot evaluation can request
  up to **3 072** output tokens (see the budget below) plus the system prompt and transcript, so
  firing several evaluations inside a minute trips a 429. If that becomes a problem, lower
  `MAX_EVALUATION_TOKENS` in `src/lib/config.ts` or switch to a Compound model (70 000 TPM).
- `whisper-large-v3(-turbo)` return `does not support chat completions` — they are speech-to-text.
  Cloud transcription uses `whisper-large-v3-turbo` through the **transcriptions** endpoint, not
  chat.
- `canopylabs/orpheus-*` are text-to-speech and additionally require an org admin to accept terms.
- `meta-llama/llama-prompt-guard-2-*` answered 200 only because the probe sent exactly one user
  message with no system prompt; they are prompt-injection classifiers, not usable for language
  evaluation.
- `allam-2-7b` works but its 4 096-token context is too small for the evaluation prompt plus a
  full 60-second transcript.

## Output budget derivation

A learner speaks for at most 60s. Conversational French runs ~120–150 wpm and fast speakers reach
~180–200, so a liberal ceiling is **240 words** (200 wpm + 20% headroom). Constants in
`src/lib/config.ts`:

| constant | value | meaning |
|---|---|---|
| `MAX_RECORDING_SEC` | 60 | recording cap |
| `FAST_WORDS_PER_MINUTE` | 200 | fast-speaker estimate |
| `MAX_ATTEMPT_WORDS` | 240 | transcripts longer than this are truncated before evaluation |
| `MAX_EVALUATION_TOKENS` | **3072** | output budget (~12–13 tokens per spoken word) |

Every returned text field mirrors the transcript (`correctedText`, `naturalSpeech`, three
translation styles), plus a short summary and a correction list. Requesting more than necessary
is what tripped low output-tokens-per-minute provider limits in the first place.

## DeepSeek naming

The inception named `deepseek-chat` / `deepseek-reasoner`. DeepSeek's current API (checked
2026-09) serves `deepseek-flash` and `deepseek-v4-pro` (legacy names still accepted). The model
enum and default use the current names.

## Where this is reflected in the app

- Curated dropdown (`src/lib/adapters/llm/providers.ts`): GPT-OSS 120B (default), GPT-OSS 20B,
  Compound, Compound Mini, and the two Qwen 27B models. Excluded on purpose:
  `openai/gpt-oss-safeguard-20b` (classifier), `allam-2-7b` (4k context too small).
- Settings **auto-refreshes** `GET /models` on load whenever a key is present (no button press
  needed) and filters out non-chat models, so an account that sees newer models than this build's
  curated list still gets them as "From your account". The manual **Refresh model list** button
  remains.
