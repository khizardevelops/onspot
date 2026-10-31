# Processing choices

Speech-to-text, the LLM and text-to-speech are **independent**. Each has its own Local/Cloud switch
and can run on the device or through an API the learner controls. There is no global preset: a
learner can mix any three choices. The app never forces a model download for a step that is set to
Cloud.

## The rows

| Step | Local | Cloud / API |
|---|---|---|
| Speech-to-text | Whisper small (Whisper.cpp on desktop/Android; Transformers.js in the browser) | Groq `whisper-large-v3-turbo` |
| LLM | A local OpenAI-compatible server: LM Studio, llama.cpp, Ollama, vLLM, … | Groq, DeepSeek, or any OpenAI-compatible endpoint |
| Text-to-speech | Piper / piper-plus voices | ElevenLabs, or any OpenAI-compatible speech server (OpenAI official or local) |

The LLM step is cloud by default because most learners do not run a local model. A local server is
an **endpoint**, not an embedded model: the app sends the transcript to
`{baseUrl}/chat/completions`, exactly like a cloud provider. The key is optional; a keyless LM
Studio/llama.cpp/Ollama server works. In a browser the server must allow the app origin (CORS); the
Tauri desktop and mobile builds route the request through the HTTP plugin and do not.

Text-to-speech keeps **both** ElevenLabs and the OpenAI-compatible path. Each has its own key, model
and voice fields, so switching never destroys the other configuration:

| | ElevenLabs | OpenAI-compatible |
|---|---|---|
| Endpoint | `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` | `{baseUrl}/audio/speech` |
| Auth | `xi-api-key` | `Authorization: Bearer …` when a key is set |
| Model | `eleven_multilingual_v2` (quality) or `eleven_turbo_v2_5` (fast) | `gpt-4o-mini-tts`, or the server's model |
| Voice | ElevenLabs voice id; refresh from `GET /v2/voices` | e.g. `alloy`, or the server's voice |
| Languages | Multilingual model covers French and Japanese | Provider-dependent; a local server must carry the target language |

ElevenLabs returns MP3 (`mp3_44100_128`), decoded in the browser with `AudioContext`, then cached in
the local database like every other spoken reply.

## Downloads

`src/lib/stores/languageData.ts` checks and downloads only the local parts the current choices
need. A cloud-only setup reports “No local speech data is needed”; a mixed setup downloads only the
missing speech model or voice. The progress bar is weighted by what is actually missing, and the
capability requirements update immediately when a choice changes.

## One requirement model

`src/lib/stores/processing.ts` derives the requirements for the three steps. The Settings rows, the
download footer and the Practice gate all consume that store, so they cannot disagree. Each
requirement says what is missing and which row fixes it:

- Speech-to-text: `transcription-download` / `transcription-key`
- LLM: `correction-endpoint` / `correction-key`
- Text-to-speech: `readback-download` / `readback-key`

Practice disables recording until every requirement is met and links to the first missing row.

## Settings layout

Settings is two tabs: **Learning** (language, level, mode and the three processing rows) and
**Data** (storage, export/restore, cloud sync). The Processing card has one row per step — Speech-to-
text, LLM, Text-to-speech — with a Local/Cloud segmented control, a one-line status and a chevron.
Only one row is expanded at a time; changing a row's mode opens it. The detail is a grid transition
(`0fr`/`1fr`) that keeps the content mounted, and the inactive detail is `inert`.

All tab content and every row detail stay mounted and are hidden with CSS. This is deliberate:
neo-svelte 1.2.0's `NeoSelect` sets state in its cleanup, which Svelte rejects when the select
unmounts during a tab or mode switch. Transient model/voice lists therefore use a text input plus
clickable fetched options instead of swapping in a select.

Hash links: `#speech-to-text`, `#llm` and `#text-to-speech` open the matching row. The older
`#transcription`, `#ai-provider` and `#voice` anchors still focus the same rows.

The row header pins its Local/Cloud control and chevron (`flex: 0 0 auto`) and lets the text column
shrink (`flex: 1 1 auto`, `min-width: 0`). Without that the chevron paints outside the frosted card
once the header becomes a row at 640px.

### Voice pickers

Speech-to-text and the LLM take a key or URL; text-to-speech picks a voice. A voice list is too much
content for a dropdown (an ElevenLabs account can hold 100 voices, each with a metadata line), so
the picker is a **modal** (`components/settings/VoicePicker.svelte`) rather than a popover:

- the Settings row shows a compact trigger: the selected voice name plus one detail line;
- the modal has a title, a search field once the list exceeds six voices, a scrollable option list,
  and a footer for the section's own actions (Preview, Refresh) and Done;
- the header and footer are pinned, so only the list scrolls, and the dialog is capped at
  `min(38rem, 100dvh - 4rem)` so a short phone viewport still shows Done;
- arrow keys/Home/End walk the options, and the search field takes focus on a fine pointer only
  (auto-focusing on a phone would open the keyboard over a list the learner just wants to scan).

Each option carries a second line so the choice is informed:

| Branch | Detail line |
|---|---|
| Local Piper | download size, sample rate and speaker count |
| ElevenLabs | `language · accent · gender · age · use_case` plus the voice description |
| OpenAI | the voice's character, e.g. “Friendly and energetic” for Nova |

A voice id saved by an older build stays selectable even when the account list does not contain it;
once the account's voices have loaded it is marked as not available to the account. The account's
voices load once automatically when a key is stored; a failed automatic load stays quiet and leaves
the manual Refresh button.

**Free ElevenLabs plans cannot use Voice Library voices through the API** (HTTP 402
`paid_plan_required`). `/v2/voices` does not say which plan a voice needs (`available_for_tiers` is
empty), so the picker reads the plan from `GET /v1/user/subscription` and lists voices copied from
the library (`sharing.status: "copied"`) **only when the plan is known to be paid**. A key restricted
to text-to-speech cannot read its plan (401 `missing_permissions`), so it gets premade and owned
voices only, with a note on granting "User: Read". Showing a voice that then fails is worse than
hiding one. If a paid voice is still used (saved earlier, or the plan was unreadable), the speech
service catches the 402, remembers per key hash that library voices are refused
(`stores/elevenLabsVoice.ts`), switches the saved voice to Alice, retries, and shows a toast, so the
reply still plays. A refused 402 costs no characters. The picker also swaps a saved voice the plan
certainly cannot use as soon as the list loads. The old
hard-coded "built-in" ids (Rachel, Domi, Elli, Josh, Arnold) were removed: by 2026-10-30 most of
them resolved to *different* paid library voices. The default is the premade Alice
(`Xb7hH8MSUJpSbSDYk0k2`), and a stored copy of the old default `21m00Tcm4TlvDq8ikWAM` is replaced
on load. A 402 at speech time is turned into an actionable message.

## Settings hydration

`initSettings()` reads the database on startup and after a restore. A choice made while that read is
in flight is recorded and merged over the loaded snapshot, and the hydration write itself is not
persisted; otherwise the learner's first click could be silently reverted, and a restored database
without a field would immediately gain (and sync) a default.

## Code map

| Concern | File |
|---|---|
| Choices and requirements | `src/lib/stores/processing.ts` |
| Capability-aware cache/download | `src/lib/stores/languageData.ts` |
| Cloud text-to-speech options | `src/lib/stores/ttsConfig.ts` |
| ElevenLabs adapter | `src/lib/speech/tts/cloud/ElevenLabsTtsAdapter.ts` |
| ElevenLabs voices | `src/lib/speech/tts/cloud/elevenLabsVoices.ts` |
| ElevenLabs plan and allowance | `src/lib/speech/tts/cloud/elevenLabsAccount.ts` |
| Usage monitor | `src/lib/usage/` (see `usage.md`) |
| OpenAI-compatible adapter | `src/lib/speech/tts/cloud/OpenAITtsAdapter.ts` |
| TTS factory / cache | `src/lib/speech/tts/service.ts` |
| LLM endpoint resolution | `src/lib/stores/llm.ts` |
| OpenAI-compatible client | `src/lib/adapters/llm/client.ts` |
| Settings shell | `src/routes/settings/+page.svelte` |
| Processing rows / footer | `src/lib/components/settings/ProcessingSection.svelte` |
| Disclosure row | `src/lib/components/settings/CapabilityRow.svelte` |
| Voice picker modal | `src/lib/components/settings/VoicePicker.svelte` |
| LLM details | `src/lib/components/settings/CorrectionSettings.svelte` |
| Speech-to-text details | `src/lib/components/settings/TranscriptionSettings.svelte` |
| Text-to-speech details | `src/lib/components/settings/ReadbackSettings.svelte` |
| First-run choices | `src/lib/components/LanguagePicker.svelte` |
| Practice gate | `src/routes/+page.svelte`, `src/lib/stores/practice.ts` |

## Verification

- Browser at 1280px and 390px: three independent rows and their disclosures, all-cloud (no
  install), all-local (363 MB install), mixed modes, requirement counts, ElevenLabs/OpenAI switching
  and persistence, keyless local LLM (mock server: model list + connection test), Practice gate
  routing, no page errors and no horizontal overflow.
- Not yet run with a live ElevenLabs key or a real LM Studio/llama.cpp/Ollama server. The desktop
  Tauri runtime still needs a pass for the local-server HTTP path.
