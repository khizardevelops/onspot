# Glossary

- **Language registry**: `src/lib/languages/index.ts`. The single source of truth for supported
  languages, their approved STT/voice descriptors, prompts, and approval evidence.
- **Approved language**: a `LanguageDefinition` (and each of its STT/voice entries) whose
  `approval.status` is `approved` after a human quality pass. Only these are offered to users.
- **Language data**: the downloadable bytes for one language — the local STT weights plus the
  selected Piper voice. Nothing is bundled; the user downloads it on demand.
- **Download gate**: the Practice notice that tells the user to open Settings → Language data and
  click Download before their first local session. Cloud-only setups skip it.
- **Processing profile**: a per-voice post-processing chain (high-shelf EQ, compressor/limiter,
  makeup gain, peak normalization) applied to TTS PCM before playback.
- **STT**: Speech-to-Text. The UI label is **Speech-to-text**; older notes say "transcription".
- **LLM**: the correction step (Groq, DeepSeek, custom, or a local OpenAI-compatible server). The UI
  label is **LLM**; older notes say "correction" / "AI provider".
- **WER**: Word Error Rate — percentage of incorrectly transcribed words.
- **CER**: Character Error Rate — percentage of incorrectly transcribed characters.
- **RTF**: Real-Time Factor — ratio of processing time to audio duration (< 1.0 = faster than real-time).
- **Adapter**: A pluggable class implementing `ISTTAdapter` that wraps a specific STT model.
- **Registry**: The `STTRegistry` singleton that manages all model adapters.
- **Transformers.js**: Hugging Face's JavaScript library for running ONNX models in the browser.
- **ONNX**: Open Neural Network Exchange — portable model format used for browser inference.
- **WebGPU**: Browser API for GPU-accelerated compute, used by ONNX Runtime Web for fast inference.
- **TTS**: Text-to-Speech. The UI label is **Text-to-speech**; older notes say "read-back".
- **Voice picker**: the modal that chooses the TTS voice (`components/settings/VoicePicker.svelte`).
  Not a dropdown: it carries per-voice detail, search, Preview and Refresh.
- **G2P**: Grapheme-to-Phoneme — turning spelling into pronunciation symbols. The bottleneck
  for French in the browser: the common `phonemizer` package ships English-only eSpeak data.
- **Phoneme**: a unit of pronunciation. Piper consumes phoneme ids, not letters.
- **VITS**: the end-to-end TTS architecture behind both Piper and MMS-TTS. Deterministic text
  encoder, so it rarely drops syllables, but flatter prosody than newer models.
- **Piper**: rhasspy's VITS voices, distributed as `.onnx` plus an `.onnx.json` config
  carrying the phoneme map, sample rate and inference scales.
- **sid**: speaker id. An extra ONNX input that multi-speaker Piper voices require and
  single-speaker ones reject.
- **Kokoro / StyleTTS2**: an expressive TTS architecture. Better prosody than VITS, but its
  browser package ships English voices only.
- **Round-trip WER**: synthesize text, transcribe it back with the STT model, score the result.
  Measures intelligibility, **not** naturalness — a flat robotic voice can score 0%.
- **dtype**: weight precision (fp32 / fp16 / q8 / int8 / q4). On browser WASM this is a
  download-size lever, not a speed one.
- **RTF < 1.0** means faster than real time; `rtf 2.0` means a 60s clip takes 120s.
- **ZeroGPU**: HuggingFace's shared GPU tier for Spaces. Anonymous callers get a small
  per-IP quota; exhausting it returns an error event with a null payload and no header.
- **Language of instruction**: the language explanations are written in; today the language's
  `translationTarget` (English for every language).
- **Attempt tracks**: the three things each take lets you hear and read: **You said** (transcript),
  **Did you mean to say?** (`correctedText`, the correct version) and **Explanation**.
- **Explanation markup**: the explanation's highlight tags — `<wrong>`, `<right>`, `<key>` — each
  wrapping target-language text (`adapters/llm/explanation.ts`). `<ask>` only in takes saved before
  the follow-up became its own field.
- **Follow-up**: the target-language question that ends each explanation, with a translation the
  learner reveals on demand (`attempts.follow_up`).
- **Word glosses**: the in-context meaning of each word of an attempt's texts, shown on hover/tap
  (`attempts.word_glosses`, fetched once per take).
- **Usage monitor**: Settings → Usage; per-model or per-account limits with their source
  (account / live / reported / counted). See `docs/architecture/usage.md`.
- **Usage ledger**: the device-local record of cloud calls behind the monitor (`onspot.usage.v1`).
