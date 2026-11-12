# Practice loop map (P3)

- Status: implemented in P3
- Date: 2026-11-12
- Sources: `src/lib/stores/practice.ts` (1,757 lines),
  `src/lib/stores/practiceSession.ts` (39), and the modules it calls.
- Purpose: fix the boundary of `RunPracticeSession` before writing Rust, and
  record where every exported function and every piece of state goes.

## 1. What exists

`practice.ts` is one module-level singleton: one `writable<PracticeState>`, one
database handle, one recorder, one timer, one run token, and a set of exported
functions that mutate that singleton. Components import the functions directly
and subscribe to `practice`.

`practiceSession.ts` is **not** a second practice store. It is a context object
that lets the same components render either the learner's live session or the
Settings → Text size sample:

```ts
interface PracticeSession {
  state: Readable<PracticeState>;
  live: boolean;
  setActiveAttempt(id: string | null): void;
}
```

`PracticeScreen.svelte` supplies `LEARNER_SESSION` in the app and a sample
session in the preview. The split is a view concern and stays after P3. It is
not part of `RunPracticeSession` and must not be folded into the core.

### State today

| Field | Owner after P3 | Notes |
| --- | --- | --- |
| `phase` | core session | `idle / recording / transcribing / evaluating / error`; the only state machine. |
| `prompt` | core session | Draft prompt, restored from the session when opened. |
| `promptEnglishFallback` | core session | Set by prompt selection. |
| `mode` | core session | Locked once `sessionId` exists. |
| `elapsed` | core session | Driven by the recording clock. |
| `level` | core session | Latest `AudioCapture` level event. |
| `progress` | core session | Latest `SttEngine` progress. |
| `statusText` | core session | Learner-facing progress copy. |
| `error` | core session | Learner-facing copy, stable code on the event. |
| `sessionId` | core session | Null while the draft has no take. |
| `attempts` | core session | `AttemptView` list, oldest first. |
| `activeAttemptId` | core session | Latest take unless the learner picks another. |

Derived values outside the snapshot stay in TypeScript during P3:
`busy`, `recording`, `locked`, the glare tone (pure phase/mode checks);
`usageWarnings` (P6); `reminders` (not migrated); `pacingWait` (LLM adapter,
P4); `processingReady`/`firstMissingRequirement` (setup checks, still the TS
settings/language-data path); and `explanationAudioAvailable` (see §6).

## 2. Exported function map

“Writes” means practice state unless a database or settings write is named.
Destinations: **P3 core** = `onspot-app::practice` use case; **P3 view** = thin
TS adapter; **P3 port** = a host implementation; **P5** = translations/glosses;
**P7** = catalog/settings move.

| Export | Callers | Reads | Writes / effects | Destination |
| --- | --- | --- | --- | --- |
| `practice` (`Readable`) | `PracticeScreen`, `AttemptStream`, sample session | all `PracticeState` | — | **P3 view**: latest core snapshot, same shape. |
| `PracticePhase`, `PracticeState`, `AttemptView` | components, `sampleSession`, export, tests | — | — | **P3 core** wire/view types; TS re-exports the generated shape. |
| `AttemptTrackKind` | `AttemptCard` | — | — | **P3 core** (playback kinds); TS re-export. |
| `explanationAudioUnavailable` | `AttemptCard` | settings, language data | — | **P3 core** view snapshot/selector; see §6. |
| `explanationAudioAvailable` | `practice.ts` internally | above | — | **P3 core** derived flag in snapshot. |
| `translationsCurrent` | `AttemptCard` | translation version/language | — | **P5**; stays TS until then. |
| `initPractice` | `+layout.svelte` | database, store emptiness, settings | hydrate, first prompt, phase/error | **P3 core** `HydratePractice` + `NextPrompt`; adapter calls it once. |
| `hydrateLatestSession` | `history`, `export`, `DataSettings` | sessions, settings, attempts, setup | delegate to `openSession` | **P3 core** `ResumeLastSession`; returns bool. |
| `setTargetLanguage` | `LanguagePicker`, settings, dummy | settings, language registry, store | settings, reset session/view, prompt, recorder/timer, language data refresh | **P3 core** `SetTargetLanguage` + host language refresh intent. |
| `setSessionMode` | `PracticeScreen` | `sessionId` | mode, settings | **P3 core** `SetSessionMode` (no-op when a session exists). |
| `newSession` | `AppHeader`, `PracticeScreen` | store | abandon take, clear view, prompt | **P3 core** `StartSession` (draft). |
| `requestPrompt` | internal only | settings, LLM readiness, stored prompts, prompt lock | DB prompt + submission, prompt state, toast | **P3 core** `NextPrompt`; generation port decision in §7. |
| `nextPrompt` | `PracticeScreen` | — | async `requestPrompt` | **P3 core** `NextPrompt` (fire and forget). |
| `setInstructionLanguage` | settings, dummy | store session/attempts | settings, prompt | **P3 core** `SetInstructionLanguage`; a live session keeps its prompt. |
| `startRecording` | `PracticeScreen` | phase, `starting`, processing readiness, run token | `starting`, recorder, stop audio, warm voices, phase/elapsed/level/status/timer | **P3 core** `StartRecording`; `AudioCapture`, `AudioPlayback`, `TtsEngine`, `Clock`. |
| `cancelRecording` | `PracticeScreen` | — | run token, abort analysis, timer, recorder, phase/elapsed/level/status/progress | **P3 core** `CancelRecording` / `AbandonTake`. |
| `stopAndAnalyze` | `PracticeScreen` | phase, recorder, run token, settings, prompt snapshot | claim recorder, stop timer, transcribe, evaluate, persist, play, phase/progress/error/attempts | **P3 core** `StopAndAnalyze`; `SttEngine`, legacy `EvaluationPort`, `RecordsStore`, `AudioPlayback`. |
| `setActiveAttempt` | `PracticeScreen`, `AttemptStream` | attempts | active id, prepare audio | **P3 core** `SetActiveAttempt` + playback preparation. |
| `clearError` | `PracticeScreen` | store | error; `phase: error → idle` | **P3 core** `ClearError` or adapter command; must not reset a live phase. |
| `ensureAttemptTranslations` | `AttemptCard` | attempts, settings, DB | DB attempt, view | **P5**. |
| `wordGlossesFor` | `AttemptCard` | attempts, settings | — | **P5** (view helper). |
| `ensurePhraseMeaning` | `AttemptCard` | attempts, settings, DB | DB attempt, view | **P5**. |
| `ensureWordGlosses` | `AttemptCard` | attempts, settings, DB | DB attempt, view | **P5**. |
| `followUpQuestion` | `AttemptCard`, `ExplanationText` | attempt | — | **P3 core** pure helper; exported through the adapter. |
| `playAttemptTrack` | `AttemptCard` | settings, language data, attempt | audio loading/play, error | **P3 core** `PlayAttemptTrack`; `TtsEngine` + `AudioPlayback`. |
| `playSegment` | `AttemptCard` | attempts | audio | **P3 core** `PlaySegment`. |
| `setAttemptVoice` | `AttemptCard` | attempts, settings, DB | DB attempt, view, audio | **P3 core** `SetAttemptVoice` (persist + re-render). |
| `speakText` | `AttemptCard`, `FeedbackPanel`, sandbox | settings | audio, error | **P3 core** `SpeakText`. |
| `playRecording` | `AttemptCard` | DB | audio | **P3 core** `PlayStoredAudio`. |
| `playStoredAudio` | `history` | DB | audio | **P3 core** `PlayStoredAudio`. |
| `renameSession` | `history`, `PracticeScreen` | DB session, open id | DB session, prompt title | **P3 core** `RenameSession`. |
| `deleteSession` | `history`, `PracticeScreen` | DB session/attempts | delete attempts/corrections/audio/session, reset view | **P3 core** `DeleteSession`. |
| `openSession` | `history`, `dev/long-takes`, `insights` | DB session/attempts, settings | setup/settings, view, prompt, prepare audio | **P3 core** `OpenSession`. |

Private helpers move with their callers:

- `persistAttempt` → `StopAndAnalyze` persistence helper. It creates the session
  row when the draft has none, writes the attempt, replaces corrections, writes
  base64 audio, updates the view, and records practice activity.
- `buildCorrections` → pure `onspot-domain`/`onspot-app` function, golden-tested.
- `isSilent` → `onspot-dsp` with the existing golden fixtures.
- `capWords`, `countWords`, `MAX_RECORDING_SEC` → `onspot-dsp`/domain (P3).
- `trackText`, `followUpQuestion`, speech option builders → `onspot-app`
  speech-piece logic (text pieces, explanation pieces).
- `prepareTakeAudio`, `prepareSessionAudio`, `takeClips` →
  `RunPracticeSession` scheduling + `TtsEngine`; the queue is app state, the
  voice work is the port.
- `sessionPrompt`, `adoptSessionSetup`, `keepOpenSessionSetupCurrent`,
  `saveSessionSetup`, `useCloudWhereNotLocal`, `openSessionSetup` → **P3 core**
  session setup, reading/writing `RecordsStore` and settings.

## 3. Imports and companion modules

| Module | What `practice.ts` uses | Destination |
| --- | --- | --- |
| `utils/recorder.ts` (`VoiceRecorder`) | microphone, Opus blob, 16 kHz PCM, duration, level | `AudioCapture` host shim both runtimes. The webview still records on desktop, so the Tauri shim calls this same TS path through the driver until a native capture port exists. |
| `speech/stt/service.ts` | local Transformers.js or Groq | `SttEngine` port: web host shim now; `onspot-adapter-native-stt` for desktop/Android. |
| `speech/tts/service.ts` | local/cloud synthesis, stored clips, explanations | `TtsEngine` port: host shims both runtimes in P3. |
| `stores/audio.ts` | shared player, loading, prime, stop | `AudioPlayback` host shim. |
| `stores/processing.ts` | readiness gate before recording | Driver-side precondition until setup moves; the core receives a ready/missing result. |
| `practice/prompts.ts`, `promptCatalogue.ts` | seed and pick stored/catalogue prompts | Data stays TS; core selects stored prompts. Generation decision §7. |
| `practice/promptSubmissions.ts` | queue/flush generated prompt | Host/driver side until P6 sync. |
| `practice/sessionSetup.ts` | parse/infer/apply setup | **P3 core** (pure), using Rust record types. |
| `stores/settings.ts` | all `AppSettings` fields | P2 settings store; P3 reads a typed settings snapshot (ADR-008). |
| `adapters/llm/*` | evaluation, prompt topic, translations, glosses | Evaluation stays the legacy TS path until P4 through an `EvaluationPort` shim; translations/glosses P5. |
| `languages/*` | names, voices, defaults | Host data for now; the language catalog moves in P7. |
| `pronunciation.ts` | tappable words and speech options | **P3 core** text-piece selection; host voice data. |
| `stores/reminders.ts` | `recordPracticeActivity` | **P3 view/driver** after `attempt_persisted`, or a small port; not part of the core session. |

## 4. Proposed `RunPracticeSession`

One application object owns the current session view and serialises commands.
It is created by `Core` with `HostAdapters` and an `EventSink`.

```text
Core
 └─ RunPracticeSession
     ├─ state: PracticeView (the snapshot)
     ├─ run: CancelToken            (today's `run`)
     ├─ analysis: Option<CancelToken> (today's AbortController)
     ├─ recorder: Option<Box<dyn AudioCapture>>
     ├─ timer: Option<ClockHandle>
     ├─ prompt_generation / speech_request sequencing
     ├─ prompt_source: PromptSource? (see §7)
     ├─ evaluation: EvaluationPort   (legacy TS shim in P3)
     ├─ records: RecordsStore
     ├─ settings: SettingsStore
     ├─ clock: Clock
     ├─ capture/stt/tts/playback ports
     └─ event sink
```

Rules carried over exactly:

- `StartRecording` sets `starting` before awaiting permission and refuses a
  second start; a stale run token cancels the recorder that arrived late.
- `StopAndAnalyze` claims the recorder synchronously before awaiting `stop`, so
  the 60 s timer firing during the Stop tap cannot stop it twice.
- Every await checks its run token before writing state. Session/language
  change, cancel, delete and open bump it.
- The timer ticks at 250 ms, stops at `MAX_RECORDING_SEC`, and calls the same
  stop path. The clock is injected so tests can advance it.
- Evaluation and transcription get separate cancellation tokens; cancelling
  playback or a prompt does not abort an analysis.
- `speechRequest` increments make an older synthesis unable to play over a
  newer one.

## 5. Events and the view snapshot

The Svelte adapter subscribes once and replaces the store with each snapshot;
it never derives practice state from component code. Proposed catalog
(additive to `UiEvent`, ADR-004):

```text
practice_state_changed      { snapshot }
audio_level                 { level }
transcription_progress      { progress, status }
evaluation_started          { }
attempt_persisted           { attemptId }
take_silent                 { }
error                       { code, message }
speak_track / play_segment / speak_text / play_recording
```

`practice_state_changed` carries everything the screen renders: phase, prompt,
mode, elapsed, level, progress, status text, error, session id, attempt views,
active id, and derived flags (`canRecord`, `canStop`, `locked`,
`explanationAudioAvailable`, `explanationAudioReason`). The adapter keeps the
same export names, so `PracticeScreen`, `AttemptStream`, `AttemptCard` and
`FeedbackPanel` change minimally.

Stable error codes replace string matching in the core:
`practice.microphone_unavailable`, `practice.recording_failed`,
`practice.take_silent`, `practice.setup_incomplete`,
`practice.transcription_failed`, `practice.evaluation_failed`,
`practice.speech_failed`, `practice.attempt_not_found`,
`practice.saved_data_unavailable`. The driver owns the learner-facing copy
(invariant I6); the TS adapter maps codes to today's exact strings.

## 6. Explanation availability

Today `explanationAudioUnavailable` derives from `appSettings` and
`languageData` (status `checking`, installed voice flags, language voice
lists). The P3 driver computes the flag from the existing settings + language-data
stores and sends it in `PracticeConfig`; the core keeps it in the snapshot.
Moving the language-data installation state itself remains P7 work.

## 7. Open decisions to settle in P3

1. **Prompt generation.** `next_prompt` calls `PromptSource` first; the host
   shim runs the existing TS generator and the core stores the result. With no
   model, the driver passes the stored/catalogue candidates and the core picks
   one. Catalogue data stays TS until P7.
2. **Evaluation.** `EvaluationPort` is a shim around today's TS
   `evaluateAttempt` on both runtimes for P3. P4 replaces the shim; the core
   only sees `EvaluationResult`.
3. **Session management scope.** `renameSession`, `deleteSession` and
   `openSession` are in the God store but not in the phase's short use-case
   list. Recommendation: port them with the session state (they are already
   repository-only) so no practice action remains in the God store.
4. **Native STT.** The `native-stt` crate is a registered stub. P3 must either
   implement the whisper.cpp adapter or explicitly keep desktop on the host
   shim; recommendation: implement it, because the phase gate requires the
   desktop core path.
5. **Cloud STT.** Keep it in the host `SttEngine` shim in P3; the Rust Groq
   adapter follows the LLM HTTP client in P4.

## 8. Work order

1. `onspot-dsp`: silence and cap-words golden parity.
2. Ports: `AudioCapture`, `SttEngine`, `TtsEngine`, `AudioPlayback`, `Clock`,
   `EvaluationPort`, `PracticeEnvironment` (if approved).
3. `onspot-app`: `RunPracticeSession` state machine, run tokens, timer,
   persistence through `RecordsStore`, event catalog, scenario tests (four
   races).
4. Rust adapters: native STT; host RPC shims for capture/STT/evaluation/prompt
   on wasm and Tauri; playback is event intents handled by the driver.
5. Bridge commands and generated types; `useCore('practice')` allowlist; tick
   command because the driver owns the interval.
6. Svelte adapter (`stores/practice.ts` branches on `useCore('practice')`) and
   parity smoke matrix. The legacy implementation stays selectable through
   `VITE_CORE_BACKEND=legacy` (ADR-002), so the God store body remains until P8.

## 9. Acceptance checks for this map

- Every export above has one destination and a caller list.
- `practiceSession.ts` remains the sample/live view context.
- The state machine, cancellation, timer and persistence sequences are named.
- P5/P6/P7 work is explicitly out of scope.
- The four races have a test home: `stopAndAnalyze` double claim, cancel during
  transcription, new recording during evaluation, timer during stop.
