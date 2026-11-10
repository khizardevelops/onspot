# Archived bugs

> Archived 2026-11-03 from `docs/planning/bugs.md`. Frozen; current bugs are in
> [`docs/planning/bugs.md`](../bugs.md).

## Archived 2026-11-03

### Start speaking was available without an LLM provider (fixed 2026-10-03)

Practice now checks every processing requirement before a take. If the LLM is not configured, the
main action becomes **Set up LLM** (or **Install data** for a missing local model) and links to
the right Settings section. `startRecording()` also refuses as a second guard. The old behaviour
let the learner speak and only failed after the take.

### A wrong-language take could read as a clean take (fixed 2026-10-03)

The evaluation now returns `spokenLanguage`. When the learner answers in another language,
`normalizeEvaluation` replaces the corrections with one grammar error covering the whole
transcript ("Answered in X instead of <language>"), so the take is never presented as clean and
Insights counts it. Local Whisper is forced to the target language, which remains a limitation;
see the comment in `adapters/llm/evaluate.ts`.

## Archived 2026-11-08

### Some on-device voices were much louder or quieter than others (fixed 2026-11-08)

Reported as "the audio of some local tts is either too loud or too slow. normalise the audio
before output". Measured on 51 voices (ITU-R BS.1770 integrated loudness): raw output spanned
14.3 dB, from Piper Tom at −29.9 LUFS to Urdu Fasih at −15.6. Peak normalisation could not fix it,
because most Supertonic voices already peak near full scale yet differ by 5 dB.

Every on-device clip is now leveled when it is made, in `processPcm` (`src/lib/utils/audioEffects.ts`):
the voice's EQ and compressor, then one gain to −20 LUFS (`utils/loudness.ts`: K-weighted, 400 ms
blocks, gated, so a spike or a pause barely moves it), then the learner's volume, then a
look-ahead peak limiter at −1 dBFS (`utils/peakLimiter.ts`), with one top-up pass for loudness
the limiter took off. The work is done once per clip, before it is stored, so playback has no
added delay (about 5 ms per second of speech). Each piece of a long text or a two-voice
explanation is leveled on its own, so both voices match. The Settings preview uses the same
gain. Clip cache keys carry `lufs-20`, so clips made before are made again.

Evidence: 51 voice clips leveled to −20.39 … −20.00 LUFS with no peak above the ceiling; in the
app (2026-11-08), Tom, Supertonic FR M1 and DE F1, Fasih and Ryan all came out at −20.00 … −20.05
LUFS, from −27.4 … −15.0 raw. Numbers in [`docs/benchmarks/tts.md`](../../benchmarks/tts.md#loudness).
Not covered: cloud voices (a streamed clip plays before it can be measured), and stored clips of
Piper Tom, which replay about 2 dB quieter because Opus at 32 kbps drops part of his strong
treble.

