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
  service.ts   what the app calls; caches rendered audio in the database
  voices.ts    the voice list per language
  piper/       Piper and piper-plus voices in a Web Worker (eSpeak / OpenJTalk G2P)
  cloud/       OpenAI, bring-your-own-key
```

TTS has one on-device engine, so it has no engine interface yet. When a second one arrives
(e.g. native Piper through sherpa-onnx), it gets the same shape as STT.
