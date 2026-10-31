# Pipeline

How data flows through onspot. The lab's benchmark pipeline (eval clips, WER scoring) is retired
with the lab UI but its audio handling is reused in the STT adapter; its details are preserved in
`references/bugs.md` and `docs/benchmarks/`.

## Practice loop (product)

```
prompt (seeded or generated)
      |
      v
MediaRecorder → Opus 24 kbps mono (webm; ogg/mp4 fallback, speech/audioFormat.ts)
      |                  |
      |                  +--> decode → 16 kHz mono Float32Array
      v
transcribe
  +-- local:  @huggingface/transformers whisper-small q4 (WASM)
  |           sequential 30s windows seeking to the last timestamp
  +-- cloud:  Groq whisper-large-v3-turbo (BYOK); uploads the Opus recording itself
  |           (~2.4 KB/s; WAV from the PCM only for a container Groq does not take)
      |
      v
transcript ──────────────────────────────► Attempt row (DB)
      |
      v
LLM evaluation (OpenAI-compatible, BYOK: Groq / DeepSeek)
  system prompt = fixed schema + rules per language (prefix-cacheable: Groq bills cached input at half
  price and leaves it out of rate limits; DeepSeek far lower); level, tone, prompt and transcript are
  in the user message → strict JSON:
    { spokenLanguage, correctedText (faithful "did you mean"),
      explanation (instruction language, <wrong>/<right>/<key> tags),
      followUp: { question (target language), translation (instruction language) },
      translations: { idiomatic, idiomaticVariants[], literal, wordForWord }   ← only when Settings
                     shows translations after every take; otherwise null, fetched on demand,
      corrections: [{ category, severity, label,
      original, replacement, explanation, speakText, examStatus,
      formalAlternatives }], vocabulary[], connectors[] }
      |
      v
Correction rows (DB) + correctedText + explanation on the Attempt
      |
      v
Attempt card: three tracks, each text + TTS
  You said (transcript) · Did you mean to say? (correctedText) · Explanation (tags stripped)
  +-- local: Piper worker (Tom / UPMC / Siwis / piper-plus JA) via onnxruntime-web + G2P
  |           one resident voice, transferred PCM, release after 90s idle
  |           explanation: two voices (English voice + target voice), see explanationSpeech.ts;
  |           every clip of a take is prepared ahead, in priority order (on-device only)
  +-- cloud: ElevenLabs (opus_48000_32), or an OpenAI-compatible /audio/speech server (BYOK,
  |           response_format opus; WAV fallback remembered per server)
  |    tts/service.ts: one pending request per clip (concurrent callers share it), plays at once,
  |    stores in the background as Opus (cloud as it arrives; Piper/WAV encoded with Mediabunny
  |    over WebCodecs, lazily loaded; WAV kept where Opus encoding is unavailable)
      |
      v
explanation auto-plays after the take (correct version when it cannot be spoken)

every cloud call ─► usage ledger (localStorage: tokens, audio s, characters,
                    rate-limit headers when readable, refusal limits) ─► Settings → Usage

audio blob ──────────────────────────────► AudioAsset row (DB, base64)

saved attempt has old/versionless translation variants
      |
      +-- user selects a translation view
      v
strict translation-only LLM JSON
  → idiomatic + 0–2 alternatives + literal + word-for-word + word breakdown
  → persist translation set v2 on the existing Attempt
```

Everything except the BYOK endpoints runs on the device. Audio is stored so an attempt can be
replayed; text goes to a cloud LLM only when a key is configured.

## Language-data download (manual, cancellable)

```
user picks a language (first run or Settings)
      |
      v
language registry entry: approved STT + default/selected voice + prompts
      |
      v
Settings -> Language data -> Download  (never automatic)
      |
      v
stores/languageData.ts
  +-- preloadLocalSTT(language)      whisper repo -> transformers-cache
  |     progress callback -> weighted share of 0..100
  +-- preloadLocalVoice(voice)       .onnx into onspot-tts-cache
  |     progress callback -> the rest of 0..100
  +-- refreshLanguageData()          re-reads both caches -> ready
      |
      +-- LanguageDownloadBar (layout) shows the combined bar + Cancel anywhere
      +-- cancel: terminate both workers; next use lazily recreates them
      v
Practice gate clears once both caches hold the approved files

TTS read-back:  Piper PCM -> voice processing profile (EQ, compressor/limiter,
                makeup, peak normalization) -> WAV -> cache/playback
```

The check uses the Cache API, which is per origin — a cold origin shows "Not installed" even if
another port has the bytes. Cloud-only configurations skip the gate.


## Runtime split

```
Desktop (Tauri v2)                    Web SPA
  window.__TAURI_INTERNALS__            no Tauri
  TauriSqlAdapter                       OpfsSqliteAdapter
  @tauri-apps/plugin-sql                sqlite-wasm + OPFS (Worker)
      \_______________________________/
                     |
             IDatabaseAdapter (getDatabaseAdapter())
                     |
            stores / components (never SQL directly)
```

## Weight loading (carried from the lab, still true)

```
Transformers.js models             Piper voices (TTS worker)
  createPipeline()                   cachedFetch()
  -> detectDevice()                  -> caches.match(url)      hit: instant
  -> transformers-cache              -> response.body.tee()    miss: download
  -> createDownloadProgress()        -> one stream to cache, one growable inference buffer
       aggregates bytes across weight files (>=1MB),
       no monotonic clamp, reports MB and a status string
```

Both caches are **per-origin**. Serving the app on a different port means a cold cache.
Piper and Transformers.js keep **separate** ONNX Runtime instances (see `known-issues.md`). Both
large local models are lazy and worker-hosted; Whisper uses at most two WASM threads on capable
machines (otherwise one), and both model sessions release after 90 seconds without work.
