# Pipeline

How data flows through onspot. The lab's benchmark pipeline (eval clips, WER scoring) is retired
with the lab UI but its audio handling is reused in the STT adapter; its details are preserved in
`references/bugs.md` and `docs/approved-tech.md`.

## Practice loop (product)

```
prompt (seeded or generated)
      |
      v
MediaRecorder → audio Blob (webm/opus)          workers/ (Phase 2)
      |                  |
      |                  +--> decode → 16 kHz mono Float32Array
      v
transcribe
  +-- local:  @huggingface/transformers whisper-small q4 (WASM)
  |           sequential 30s windows seeking to the last timestamp
  +-- cloud:  Groq whisper-large-v3-turbo (BYOK)
      |
      v
transcript ──────────────────────────────► Attempt row (DB)
      |
      v
LLM evaluation (OpenAI-compatible, BYOK: Groq / DeepSeek)
  system prompt → strict JSON:
    { correctedText, translations: { idiomatic, idiomaticVariants[], literal, wordForWord },
      corrections: [{ category, severity, label,
      original, replacement, explanation, speakText, examStatus,
      formalAlternatives }] }
      |
      v
Correction rows (DB) + correctedText on the Attempt
      |
      v
TTS feedback
  +-- local: Piper (Tom / UPMC / Siwis) via onnxruntime-web + French G2P
  +-- cloud: OpenAI/Groq TTS (BYOK)
      |
      v
read corrected phrasing back (with EQ/loudness pass on Tom)

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
Transformers.js models          Piper voices
  createPipeline()                cachedFetch()
  -> detectDevice()               -> caches.match(url)      hit: instant
  -> transformers-cache           -> stream + progress      miss: download
  -> createDownloadProgress()     -> caches.put()
       aggregates bytes across weight files (>=1MB),
       no monotonic clamp, reports MB and a status string
```

Both caches are **per-origin**. Serving the app on a different port means a cold cache.
Piper and Transformers.js keep **separate** ONNX Runtime instances (see `known-issues.md`).
