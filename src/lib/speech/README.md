# speech

Everything that turns speech into text (STT) and text into speech (TTS). The rest of the
app only imports the two services:

- `stt/service.ts` — `transcribeSpeech`, plus `prepareLocalStt` / `missingLocalSttBytes` /
  `cancelLocalSttPrepare` / `localSttModel` for the language-data download.
- `tts/service.ts` — `synthesizeSpeech`, `listLocalVoices`, `preloadLocalVoice`,
  `cancelLocalVoiceDownload`.

## STT

```
stt/
  service.ts          what the app calls; local engine or Groq cloud
  localEngine.ts      picks this build's on-device engine (the only place that decides)
  LocalSttEngine.ts   the interface every on-device engine implements
  native/             whisper.cpp in the desktop and Android apps, via the Rust plugin
                      src-tauri/plugins/speech
  transformers/       Whisper via Transformers.js in a Web Worker (browser build)
  cloud/              Groq, bring-your-own-key
```

The model each engine downloads is declared per language in `src/lib/languages/index.ts`
(`stt.models`). Every language shares the same Whisper weights.

**Adding an engine:** a new folder implementing `LocalSttEngine`, its model entry in
`SttModels`, and one line in `localEngine.ts`. Nothing outside `speech/` changes.

## TTS

```
tts/
  service.ts            what the app calls; caches rendered audio in the database
  textPieces.ts         cuts a text too long for one voice run into sentence-sized pieces
  speechPieces.ts       speaks pieces one at a time and joins them (long texts, explanations)
  explanationSpeech.ts  an explanation's two voices, on top of speechPieces
  streamingPlayback.ts  plays a clip while it is still being made or downloaded
  local/                the on-device voice worker every engine runs in: the main-thread proxy
                        (LocalVoiceWorker, listened clips first, idle shutdown), the registry
                        that builds one adapter per voice, the download cache and asset map
  piper/                Piper (eSpeak G2P) and piper-plus (OpenJTalk G2P, Japanese) adapters
  supertonic/           Supertonic 3 on the prebuilt sherpa-onnx runtime: one shared model
                        speaks 31 languages
  cloud/                ElevenLabs and OpenAI-compatible, bring-your-own-key
```

The voices themselves are data: `src/lib/languages/voices.ts` lists every voice by the language
it speaks, and the same voice can read back a target language or the instruction-language half
of an explanation. The order per language is Supertonic, then Piper for the languages
Supertonic lacks (Persian, Chinese), then cloud speech.

**Adding a voice:** one entry in `languages/voices.ts`. **Adding an engine:** an adapter folder
next to `piper/` and `supertonic/`, its `engine` value on `LanguageVoice`, one case in
`local/registry.ts` and its asset list in `languages/voices.ts`. Nothing outside `speech/` and
`languages/` changes.

The sherpa-onnx runtime is gitignored; `scripts/sherpa-tts-assets.sh` puts the pinned,
verified prebuilt in `static/sherpa-onnx/`. Do not build sherpa-onnx from source.
