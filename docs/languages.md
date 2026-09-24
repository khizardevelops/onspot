# Supported languages

The app ships no models. Every language's speech recognition and voice are downloaded by the
user, on demand, from public model hosts. This file explains how languages are tracked and
approved; the machine-readable source of truth is
[`src/lib/languages/index.ts`](../src/lib/languages/index.ts).

## Where the data lives

| Concern | Location |
|---|---|
| Approval status, STT/TTS descriptors, prompts, audio profiles | `src/lib/languages/index.ts` (`LanguageDefinition`) |
| Piper voice definitions the TTS worker builds | `src/lib/adapters/tts/voices.ts` (derived from the registry) |
| STT model + language hint | `LanguageDefinition.stt` |
| Voice EQ / compression / loudness profile | `LanguageDefinition.voices[].processing` |
| Download + progress + cancel | `src/lib/stores/languageData.ts` |
| Evidence for each approval | `docs/benchmarks/stt.md`, `docs/benchmarks/tts.md` |

## Approval rule

A language is offered to users only when `approval.status === 'approved'`, and every STT model
and voice it lists carries its own approval record (who tested it, when, and where the evidence
lives). This is the same standard the model lab applied: a human must have tested output quality
before a download is exposed, because a 64–299 MB model that fails the classroom is worse than no
model.

## Adding a language

1. Evaluate candidate STT models and voices with a human quality pass (listen to the voice, read
   the transcripts). Record the evidence under `docs/benchmarks/`.
2. Add the STT descriptor and voice list to a new `LanguageDefinition` in
   `src/lib/languages/index.ts`, including each entry's `approval` record.
3. Add the language's speaking prompts and its `preview` sentence (used by the Settings voice
   preview; keep it short because the first synthesis is the slow part).
4. If the voice needs correction, give it a `processing` profile (4-band EQ, compressor / limiter,
   makeup gain, peak normalization). The DSP code is generic; only the numbers are per-voice.
   Learners can layer their own ±12 dB volume/EQ adjustments on top in Settings → Advanced →
   Voice & audio → Equalizer; those are stored per voice and never modify the approved defaults.
5. Set `approval.status = 'approved'` and run the download flow in a browser before shipping.

## Current state

| Language | Code | Local STT | Default voice | Status |
|---|---|---|---|---|
| French | `fr` | `onnx-community/whisper-small` q4 | Piper Tom (M, medium) | Approved (2026-09-13) |
| Japanese | `ja` | `onnx-community/whisper-small` q4 | piper-plus CSS10 (F) | Candidate (2026-09-25) |

The full per-language stack (engines, G2P, voices, prompts) is in
[`supported-languages.md`](supported-languages.md).

Candidate entries are committed with `approval.status = 'candidate'`. Production builds offer
approved languages only (`APPROVED_LANGUAGES`); development builds also offer candidates
(`OFFERED_LANGUAGES`), labelled "candidate, not yet approved", so step 5 can be run in the real
app. A voice's `engine` selects its TTS path: `piper` (eSpeak G2P) or `piper-plus` (OpenJTalk
G2P in WASM, Japanese).
