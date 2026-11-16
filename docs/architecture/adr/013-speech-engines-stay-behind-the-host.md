<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# ADR-013 — Speech engines stay behind the host; the unused native-stt stub goes

- Status: accepted
- Date: 2026-11-16
- Deciders: migration lead, after the post-P8 review

## Context

P3 registered `crates/adapters/native-stt` (`WhisperCppStt`), a 76-line wrapper
over the whisper.cpp engine in `tauri-plugin-speech`, intended as the desktop
`SttEngine`. Nothing ever used it: the desktop core reaches speech recognition
through the webview host (`stt.transcribe`), whose native engine calls the
same plugin. P8's prompt puts native speech engines out of scope.

Wiring it would have meant a second whisper context beside the plugin's (the
plugin already loads the model for the webview's download/readiness flow),
and moving model selection and download state into the core.

## Decision

- Remove `native-stt`. Speech recognition stays a host port on every runtime:
  Transformers.js and Groq in the browser, whisper.cpp in Rust inside
  `tauri-plugin-speech` on desktop/Android. The computation is already Rust;
  only the call is routed through the webview.
- A future driver without a webview (a Rust UI, a full CLI) adds an in-process
  `SttEngine` together with the model management it needs, instead of
  inheriting a stub that never ran.

## Consequences

- No dead adapter in the workspace; PORTS.md and the blueprint describe what runs.
- TTS stays as P3 left it: host engines (Piper/Supertonic workers, cloud APIs).
