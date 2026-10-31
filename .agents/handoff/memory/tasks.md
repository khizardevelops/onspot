# Tasks

## Card stack + paper timeline (2026-10-31)
- [x] Stack of index cards driven by the demo's scroll math (`cardStack.ts`), bury delay 0.35,
  tilt, depth fade; lock onto a card when scrolling stops; card on top = selected take; tall cards
  scroll inside themselves; arrival drop; paper timeline with playhead, hover expand, click to jump.
  Verified in headless Chromium: rest/mid/hover/jump screenshots (light, dark, phone), wheel notch =
  one card, nudge falls back, tall card scrolls before the stack moves (and resumes at its end when
  scrolling back), touch swipe lift + nudge + inner scroll, reduced motion, 19-take timeline keeps
  the current take in view, real fake-mic take dropped in smoothly, word selection/meanings unchanged.
- [ ] **Verify in the Tauri desktop (WebKitGTK):** wheel/trackpad feel of the lock, `inert`, `:has()`
  on the timeline, `filter: blur` cost with three buried cards.
- [ ] `ui-sandbox` mocks still show the old conveyor list (they were already stale).
- [x] Timeline hover loop fixed (static hover area); timeline on phones (tap to open, tap to jump,
  tap outside to close). Verified: pointer parked on the strip's right edge stays open (no flicker),
  far left of the open paper stays open, leaving closes; phone tap flow.
- [x] Rail removed; `AppHeader` top bar on Practice, History, Insights, Settings. Verified at 1280,
  1024 and 390px: no horizontal overflow, current section marked, links/theme/☰ menu work.
- [x] Paper index cards, `--page-gutter`, compact top bar, Feedback tab label clipping, phone layout
  (timeline + Feedback in the bar, one-row composer, mode in ⋯, 36px touch floor). Verified at 1280,
  1024, 390px, light and dark; phone timeline open/jump/close, Feedback open/close, no overflow.
- [x] Scroll direction unified (down = older, cards lift up), timeline newest first, translation
  notebook styling, tilt ±0.4°. Verified: wheel down/up one card each way; a long take scrolls inside
  then lifts away, and comes back at its end then scrolls up inside; a real take dropped in at
  scroll 0; translations (all three, alternative, 29-word list) on desktop, phone and dark.
- [x] Feedback panel notebook redesign. Verified at 1280 (light/dark), 1024, 820 and phone: no
  overflow, filters, empty filter note, by-type menu, card expand, stats sheet, close → rail/bar.
- [ ] Verify the 36px touch floor on a real phone (the user's build); raise `--touch-target` if taps miss.
- [ ] Dev pages (model lab, STT bench, UI sandbox) have no navigation since the rail went; add
  `AppHeader` there if they are used regularly.
- [x] Selection drawn as a highlighter stroke (yellow band, pooled start, chisel ends; dark variant).
  Verified at 2x: phrase, single word, a stroke across a line wrap, dark; text does not move; copy
  text unchanged; a partial touch selection is inked as whole words immediately.

## Spoken explanation and three-track card (2026-10-30)
- [x] LLM returns a faithful `correctedText` ("Did you mean to say?") and a tagged `explanation`;
  `naturalSpeech`/`summary` retired; migration 7; card tracks You said / Did you mean / Explanation;
  explanation auto-plays. Browser-verified with real Groq STT + LLM and ElevenLabs (2 takes).
- [x] Local explanation audio (2026-11-01): English Piper voice for the English, the selected target
  voice for target-language spans; user picks the English voice by listening (approval pending).
- [ ] ~~User-owned: local explanation audio.~~ Local Piper voices speak only the target language;
  the tags already mark which spans are target-language, so one option is an English Piper voice for
  the rest plus the target voice for tagged spans (two voice loads per explanation; one resident
  voice today). Until then explanation audio needs Cloud TTS.
- [x] Follow-up question has its own play/replay button (track `followUp`). Browser-verified.
- [x] Hover/tap word meanings for "You said" and "Did you mean" (one LLM call per take on first
  hover, stored in `attempts.word_glosses`). Verified desktop + touch phone; one label at a time.
- [x] Word-granular selection (mouse drag by words, double-click, Shift+click; touch snaps to
  words). Verified: mid-word drag → "avec ma sœur", mid-drag already whole words, Shift+click
  extends, double-click plays once and selects one word, later clicks still play, phone snap.
- [x] Expressions (model-found, validated) and custom-range selection meanings; two-line label.
  Verified: hover expression + highlight, mouse drag-select (1 call, then instant), older card not
  lifted, phone selection. Live model: market take → no expressions; rich sentence → il y a,
  tout à coup, besoin de, pommes de terre, tout à fait.
- [ ] Optional: hover meanings for the follow-up question and the explanation's highlighted words.
- [ ] Selections that span "You said" and "Did you mean" (two texts) show nothing by design; revisit
  if learners try it.
- [x] Teacher voice: model writes `line` per mistake + opening `note`; app validates each line and
  falls back only on failure. Live-verified on New York / j'ai allé / correct takes and in the app.
- [x] Explanation composed from `{ mistakes: [{said, say, why}], note }` and validated (no identical
  fix, no repeats/overlaps, ≤3), after the user saw "You said X. Say X". Live Groq runs on the
  user's cases: no broken output; the model still sometimes reads an odd phrase as a mistake.
- [x] Auto-play hardening: prime the shared player in the Start/Stop taps; "Tap ▶" notice on
  NotAllowedError. Verified in Chromium's normal policy; **verify in the Tauri desktop (WebKitGTK)**.
- [ ] Optional (frictionless): stop recording automatically after a silence. Not built: learners
  pause to think mid-answer, so it needs a tuned threshold and probably a setting.
- [x] Follow-up question as its own field with a hidden-by-default translation (user request);
  "mention each mistake once" rule. Browser-verified with a real take and an older `<ask>` take.
- [ ] Prompt compliance: GPT-OSS sometimes leaves mentioned French words (aller, être) untagged; the
  rule was tightened (the latest take tagged them) — check a few more takes and other models.
- [ ] `src/routes/ui-sandbox/` Mock cards still show the old single "natural version" button.
- [ ] Optional: the explanation is generated for every take; consider a per-language explanation
  word cap if long takes (5 min) need more than three mistakes covered.

## ElevenLabs voices (2026-10-30)
- [x] Hide Voice Library voices on the free plan; remove stale built-in ids; new default (Alice);
  replace the stored old default; readable 402.
- [x] Follow-up after the user still hit the 402: library voices hidden unless the plan is known
  paid; 402 → remember per key, switch to Alice, retry, toast. Browser-verified with a library voice
  saved on the free key (402 → 200 with Alice, no error box; picker 21 premade voices, 0 library).
- [ ] The `alif-bey-pey` key in `~/.keys` cannot list voices or read its plan (401
  missing_permissions); with it the picker cannot load voices at all — consider a clearer message.
- [ ] A paid ElevenLabs account was not available: verify library voices stay listed there.

## Usage monitor (2026-10-30)
- [x] Ledger of cloud calls (tokens, audio seconds, characters, headers, refusals), per key hash, in
  `localStorage`; Settings → Usage tab with per-model/per-account meters, sources and estimates;
  Practice notice. Browser-verified (real takes, injected TPD refusal, local TTS, phone/dark).
- [ ] Verify live `x-ratelimit-*` readings in the Tauri desktop/Android apps (code path untested at
  runtime; parsers are unit-checked against real header values).
- [ ] Verify DeepSeek `/user/balance` with a real key (CORS preflight allows the app origin).
- [x] Per-model Groq view: model chips (in-use model selected by default, follows Settings), each
  model's own meters/estimate; Free and Developer tables with plan detection from live headers.
  Browser-verified (default, picking, Settings switch and back, phone).
- [ ] Groq `compound`/`compound-mini`/`qwen3.6-27b` are not in Groq's published table; add them when
  the docs list them (they show this device's 24 h usage and live/reported figures until then).
- [ ] Developer-plan detection needs a desktop/Android run with a paid key.
- [x] Per-minute estimate uses Groq's admission rule (used + reserved prompt+max_tokens ≤ TPM);
  calls record `reservedTokens`. Free gpt-oss: about 2 takes a minute, not 3.
- [ ] Re-check `publishedLimits.ts` against Groq's rate-limits page periodically (dated 2026-10-30).

## Cloud limits for five-minute takes (researched 2026-10-30, nothing implemented)
- [ ] Decide how a 5-minute take is evaluated. `MAX_RECORDING_SEC` is still 60 although the README
  promises up to five minutes. At 5 min (1 200-word cap) one evaluation needs ~15k output tokens
  plus a ~1.5–2.3k-token prompt, which exceeds the free-tier 8k TPM (GPT-OSS/Qwen) and Compound's
  8 192 max completion. Options: per-segment evaluation, translations on demand only, or Dev tier.
- [ ] Live provider limits: keep the full `/models` entries (`active`, `context_window`,
  `max_completion_tokens`), record `x-ratelimit-*` headers, parse `Limit N, Requested M` from
  413/429 bodies, and pre-check a request against them before sending.
- [ ] Verify with a key whether the **web** build can read Groq's `x-ratelimit-*` headers. A 401
  had `access-control-allow-origin: *` but no `access-control-expose-headers`; Tauri's HTTP plugin
  reads them regardless.
- [ ] Cloud TTS sends the whole text in one request. A 5-minute correction (~7k chars) is over
  OpenAI's 4 096-char cap; ElevenLabs exposes `maximum_text_length_per_request` on `GET /v1/models`.

## SvelteKit 3 migration (branch `migration`, 2026-10-04)
- [x] Migrate (sv migrate), check 0/0, build, preview smoke in Chromium (4 routes, nav, COOP/COEP).
- [ ] Exercise Practice with real STT/TTS/LLM on the restarted :5173 dev server; then the Tauri
  desktop + Android builds.
- [x] Commit and merge `migration` into main (`main` fast-forwarded 2026-10-06).
- [ ] Optional: Kit 3 polls `_app/version.json` hourly (`version.pollInterval`); set it to 0 in
  `vite.config.ts` if the Tauri/static build should not.

## Japanese (candidate → approved)
- [ ] Listening test of CSS10 / Mera / Tsukuyomi-chan; choose default + any processing profile.
- [ ] whisper-small q4 Japanese transcript review (CER) on real human-transcribed learner speech.
- [ ] Record evidence in docs/benchmarks, flip `approval.status`, test the download in a prod build.
- [ ] Verify a real Japanese evaluation with an LLM key (corrections offsets on unspaced text).
- [ ] Optional: furigana (ruby) for kanji in transcripts/corrections, neo-styled.

## Follow-ups from the 2026-10-03 audit
- [x] Audit + follow-up fixes committed by the user (`4bc2d94`).
- [ ] Verify the wrong-language flag with a real LLM call (only tested with a mocked response).
- [ ] Optional: detect the spoken language from audio (Whisper language-id / Groq `verbose_json`),
  since local Whisper forced to French can translate English speech into French text.
- [ ] Optional: multi-tab takeover for the web DB (BroadcastChannel → holder `pauseVfs()`); today a
  second tab only gets a clear "open in another tab" message.
- [ ] Run a real take with the downloaded model to exercise the reworked STT worker load/idle path.
- [ ] Tune the silent-take threshold (-46 dBFS) on a real microphone.
- [ ] Decide on light `--muted-foreground` contrast (4.25-4.49:1 on rail/inset/control).
- [ ] Tauri: atomic migrations/corrections. `.sqlite` import now has a schema-text check, but no
  rollback if the overwrite itself fails.

## Processing choices (2026-10-25)
- [x] Independent Local/Cloud choices for speech-to-text, the LLM and text-to-speech.
- [x] UI names are **Speech-to-text**, **LLM** and **Text-to-speech** (not transcription/read-back).
- [x] Language data checks/downloads only the parts the choices need; cloud-only needs no speech
  download. The first-run picker asks for the three Local/Cloud choices after the language.
- [x] LLM via a local OpenAI-compatible server (LM Studio, llama.cpp, Ollama); optional key; Tauri
  uses the HTTP plugin so the desktop app does not need server CORS.
- [x] ElevenLabs and OpenAI-compatible text-to-speech both supported, with separate keys/models/
  voices and an ElevenLabs voice picker.
- [x] Settings redesign: two tabs (Learning / Data), three capability rows with Local/Cloud switches
  and inline disclosures, no global preset, requirement count and data-flow line.
- [x] Practice gate driven by the same requirement model; links to the exact missing row.
- [x] Voice pickers open a searchable modal (pinned footer, keyboard navigation, AA detail text)
  instead of an oversized dropdown; Preview lives in the modal footer.
- [x] Row disclosure chevrons stay inside the card from 320 to 1440px.
- [x] `initSettings()` merges choices made before hydration instead of reverting them.
- [ ] Run a live ElevenLabs key through the preview and a real spoken reply.
- [ ] Run a real LM Studio/llama.cpp/Ollama server in the browser and desktop app.
- [ ] Tauri desktop: verify the plugin-http local-LLM path and the absence of CORS requirements.

## Phase 3 — BYOC sync (complete 2026-10-25)
- [x] Google Drive: app-private `appDataFolder`, desktop loopback PKCE, web Google Identity
  Services token client, resumable upload/download, refresh-token handling on desktop.
- [x] WebDAV for Nextcloud, ownCloud and pCloud: `webdav` package in the browser (server CORS
  required) and a PROPFIND/MKCOL/PUT/GET transport over the Tauri HTTP plugin elsewhere.
- [x] Whole-database snapshot sync with a device-local content revision, explicit conflict prompt,
  and a download path that reuses the restore rollback/rescue logic.
- [x] Settings → Cloud sync: provider choice, Google connect, WebDAV fields, Test connection,
  Sync now, last-sync time, conflict dialog, actionable errors.
- [ ] Verify Google Drive with a live account and the two OAuth client ids.
- [ ] Verify WebDAV against a real Nextcloud (browser CORS and desktop paths).
- [ ] Optional: background/automatic sync, or a sync-on-launch preference.
- [x] SQLite **import** (restore a `.sqlite` backup). Settings → Storage → Restore database and
  History's empty state replace the local DB from the exported file. Legacy format-1 JSON restore
  remains available and merges safely. Browser-verified; the Tauri path is now guarded by a
  schema-text check but still needs a runtime run.

## Inception closeout (2026-10-25)
- [x] AGPL SPDX headers on every owned source file; `bun run spdx` / `bun run spdx:check`.
- [x] `.github/workflows/release.yml` builds Windows `.exe`/`.msi`, macOS `.dmg` and Linux
  `.deb`/`.AppImage` bundles on tags or manual runs.
- [x] `docs/architecture/sync.md` and `docs/architecture/platforms.md`; iOS blockers documented.
- [ ] Run the Tauri `.sqlite` export/import round trip once on a desktop build.

## UI library follow-ups (neo-svelte, 2026-09-24)
- [x] Replace shadcn-svelte with @dvcol/neo-svelte across the app; remove shadcn/bits-ui.
- [ ] Visually check LanguageDownloadBar during a real download and LanguagePicker (forced).
- [ ] Revisit when neo-svelte 2.0 (cascade layers, NeoDialogConfirm) is published: simplify the
  specificity overrides and the composed confirm dialogs.
- [ ] Sweep remaining hand-rolled buttons (AudioBar, Transcript word buttons, the paper timeline is
  deliberately custom) for neo equivalents where they don't fight the stack/transcript layout.

## Resource usage
- [x] Native whisper.cpp STT for desktop and Android (branch `feature/native-speech`).
- [ ] Vulkan GPU for native whisper (`whisper-rs` feature `vulkan`); measure desktop and phone.
- [x] Shipped desktop builds: `GGML_NATIVE=OFF` in release.yml (whisper-rs passes `GGML_*` env to
  cmake), so released Linux packages run on any x86-64 with AVX2 (2026-11-01).
- [ ] CI: Android workflow must build whisper.cpp (cmake, clang/libclang, NDK env from android.sh).
- [ ] Release APK: check size/stripping with the plugin; remove the old Transformers.js cache on
  upgrade is wired (`removeSupersededStt`) but unverified on a real upgrade.
- [ ] Native TTS (sherpa-onnx Piper) as a second `speech/tts` engine, then the same interface.
- [x] whisper.cpp / wllama vs Transformers.js checked 2026-09-30 — rejected (8–12x slower).
- [x] **User-owned research** on STT RAM: resolved for the apps by native whisper.cpp (2026-10-04);
  the browser build still uses Transformers.js (`docs/research/model_problem.md`).
- [ ] Optional, browser build only: reduce Transformers.js STT RAM (ORT arena/session options,
  quantized-embedding export, shorter idle release); measure with `/stt-bench/`.

## Language system follow-ups
- [ ] Evaluate and approve the next language (STT + voice) with a human quality pass, then add one
  `LanguageDefinition`; see `docs/architecture/languages.md`.
- [ ] Re-test the downloaded language data on a truly cold cache end to end (Whisper 299 MB +
  Piper 64 MB) including Cancel mid-download and resume.
- [x] Settings voice preview: cached first generation, instant replay, confirm-gated regeneration.
  Browser-verified cold (45s, 64 MB voice) and warm (1s after reload).
- [x] Settings redesign from `prototype/to-be-implemented/Settings.html` on shadcn components
  (Card, Field, InputGroup, ToggleGroup, Item, Slider, Toggle), 4-band EQ + volume, live-tuned
  voice preview, SQLite export. Browser-verified (37 + 12 checks, export verified separately).
- [x] History neumorphic cards + disclosed search options; Practice neumorphic Exam/Casual switch;
  feedback sidebar width fix; Paper texture background + rail; rail buttons as analogue keys.
- [ ] Run the desktop (Tauri) export and import once for real: dialog save, `VACUUM INTO` temp
  file, fs read/write, close + overwrite `onspot.db`, reopen. `cargo check` passes but neither
  flow is runtime-tested.
- [x] Advanced Voice audio: in-page General/Advanced toggle, per-voice volume + 3-band EQ,
  reset-to-approved, tuned cache keys. Browser-verified (26/26), including
  neutral→tuned→neutral cache behavior.
- [ ] Keep `languageDownloadBytes` honest when a non-default voice is selected (currently the
  default voice's estimate is used for the combined bar).
- [ ] Optional STT input conditioning (high-pass/normalization) if a future language needs it —
  any change invalidates the approved WER baseline and must be re-measured first.

## Verification and polish backlog
- [ ] Complete a real end-to-end local practice run after downloading Whisper small q4: record,
  worker transcription, configured LLM evaluation, persistence, and read-back.
- [ ] Confirm the Tom EQ/loudness profile on real read-backs by ear (implemented, not yet heard).
- [ ] Consider pre-warming word audio for the visible attempt only if measured usage warrants the
  extra CPU/memory; Piper is now worker-hosted and releases its session after 90 seconds idle.
- [ ] Add per-file SPDX headers for AGPL-3.0 compliance.

## Completed agent tooling
- [x] Isolated, interactive chat-history UI sandbox at `src/routes/ui-sandbox/` (Mock components,
  hardcoded live data, real progressive disclosure with simulated backends) plus
  `bun run bundle:ui` (repomix, sandbox `.svelte` only). Production components and stores are
  deliberately untouched.
- [x] `bun run bundle` (`repomix/bundle.mjs`): export any page (auto-discovered from
  `src/routes`), several pages combined or separately, or any folder/file/glob, with local
  imports traced. Real repomix runs verified (settings: 103 files; settings+history at depth 1
  as markdown).
- [x] Consolidated all benchmark/metric data into `docs/benchmarks/` (`stt.md`, `tts.md`,
  `runtime.md`, `llm-providers.md`, `README.md`) and de-duplicated it out of `rules/constraints.md`,
  `known-issues.md`, `decisions.md` and `docs/research/model-vetting.md` (was `docs/plan.md`).
  The `approved-tech.md` / `groq-models.md` redirect stubs were deleted in the 2026-10-01 docs reorg.

## Completed product foundation
- [x] SvelteKit static SPA, Tauri v2 shell, COOP/COEP, and Tauri/OPFS database adapters.
- [x] Mic capture, worker-hosted local Whisper, Groq STT, structured LLM evaluation, persistence,
  Piper/cloud TTS, and cached audio.
- [x] Practice, History, Insights, Settings, search, replay, rename/delete, export, and toasts.
- [x] Language registry + approval metadata, first-run picker, manual language-data download with
  a global cancellable progress bar, and per-voice TTS processing (EQ/limiter/normalization).
- [x] Language-parameterized STT/TTS/prompts/translation, and a refreshed Groq model list that
  auto-refreshes from `GET /models` when a key is present.
- [x] Visual pass: no purple accent, 56px rail, tinted mode/filter selection, bordered feedback
  cards, collapsible session stats, flush composer, no Sparkles, single-row attempt header.
- [x] Explicit card selection with a compositor-driven attempt conveyor, deterministic 1050ms new
  card lift, and no previous/next overlay or scroll-driven selection.
- [x] Per-attempt translation v2: strict idiomatic/literal/word-for-word semantics, retroactive
  regeneration and persistence, optional idiomatic alternatives, word breakdown, and progressive
  disclosure without output headings.
- [x] Apple-inspired product polish using shadcn-svelte primitives throughout Practice,
  AttemptCard, FeedbackPanel, Settings and navigation; smooth phase/disclosure/menu/card
  transitions and a fixed mobile hamburger menu that consumes no layout row.
- [x] Refresh/restart data rehydration: Practice opens the newest persisted session, History
  distinguishes DB failure from empty storage, and dev startup cannot silently change OPFS origin.
- [x] Feedback severity summary is count-over-label (7/2/3/2 shape) with category filters in the
  hamburger menu; deletion corrections use strike-through + Remove and never an empty arrow.
- [x] Coach notes opens/closes as one smooth shadcn Collapsible: compact desktop rail, closed-first
  phone summary bar, automatic reopening for linked transcript corrections, and no 390px overflow.
- [x] Performance pass: Piper in a lazy worker, single-voice/idle disposal, capped Whisper WASM
  threads, idle Whisper disposal, transfer/stream-based large buffers, lower-frequency meters and
  playback identity, parallel correction loads, Latin-only fonts and offscreen card containment.

## Repository state
- Git history now exists (initial commit `0a2d033 save point`). This is no longer an all-untracked
  working tree.

### External UI critique (applied to real components, 2026-09-14)
Done: #1 active card state, #2 severity-vs-category colour, #3 real audio player, #4 offset-based
corrections (migration v5), #5 responsive split, #7 flat sections (no nested cards), #8 header
overflow menu, #9 translation labels + formal-alternative chips, #10 feedback accordion/filters/
severity summary, #11 conveyor softened + reduced-motion (kept per user), #13 key a11y fixes,
#14 word-click vs card-select clarified, #15 duplicate stats removed, #16 sortOrder, #18 segment
playback state, #19 translation retry + revert-on-failure, #24 copy pass.

Remaining: #6 design-token sweep (kill nonessential <12px arbitrary sizes), #12 replace the last
JS floor-spacer measurement with CSS if a reliable dynamic-height solution emerges, #13b complete
the 44px touch-target/contrast pass, #21 drop the redundant `attempt.translation` field, #23 add
true list virtualization if `content-visibility` proves insufficient for very long histories,
#25 container queries, #26 axe-core/Playwright a11y + visual-regression tests.
- [ ] macOS bundle job fails in release.yml (v0.1.0); investigate when macOS matters.
- [ ] Linux AppImage aborts with EGL_BAD_PARAMETER on Arch (bundled WebKit); consider dropping it or
  building it on a newer base; .deb/.rpm work.
- [ ] Optional: default the web build (GitHub Pages) to Cloud processing, so first visitors are not
  pointed at the on-device data download.
