# Glossary

- **STT**: Speech-to-Text.
- **WER**: Word Error Rate — percentage of incorrectly transcribed words.
- **CER**: Character Error Rate — percentage of incorrectly transcribed characters.
- **RTF**: Real-Time Factor — ratio of processing time to audio duration (< 1.0 = faster than real-time).
- **Adapter**: A pluggable class implementing `ISTTAdapter` that wraps a specific STT model.
- **Registry**: The `STTRegistry` singleton that manages all model adapters.
- **Transformers.js**: Hugging Face's JavaScript library for running ONNX models in the browser.
- **ONNX**: Open Neural Network Exchange — portable model format used for browser inference.
- **WebGPU**: Browser API for GPU-accelerated compute, used by ONNX Runtime Web for fast inference.
- **TTS**: Text-to-Speech.
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

