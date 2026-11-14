# Tasks

## Hexagonal migration P7 closeout (2026-11-14, uncommitted)
- [x] Port the typed `AppSettings` document, defaults, merge and normalisation to
      `crates/onspot-app/src/settings.rs` (ADR-008); add `settings.load` / `settings.patch`.
- [x] Port the provider/model catalog and Automatic-model policy to
      `crates/onspot-app/src/providers.rs` (ADR-010); generate/guard `assets/providers.json`.
- [x] Rewire `stores/settings.ts` to delegate hydration/writes to the core under
      `useCore('settings')`, keeping the optimistic store and legacy fallback.
- [x] Extend the core storage browser check to exercise `settings.load`/`settings.patch`; regenerate
      ts-rs types and wasm; rerun workspace tests, clippy, fmt, svelte-check, storage/practice/sync/
      portability, boundaries, SPDX, catalogs and coupling.
- [ ] Commit the closeout (user has not asked for a commit yet).
- [ ] P5 legacy→core gloss/translation fixture assertion (separate P5 gap).

## Hexagonal migration P8 (planned, 2026-11-14)
- [ ] Build `drivers/cli` over the same `onspot-app` core (settings/sessions/evaluate/insights/
      exports; STT/TTS absent by design).
- [ ] Remove `VITE_CORE_BACKEND` and the legacy branches, then **move** the dead TS modules to
      `deprecated/` (mirrored paths, SPDX kept) instead of deleting them. Add the boundary rule
      that live code cannot import `deprecated/`; keep tests/scripts on `core-client`.
- [ ] Re-run the coupling audit, make the TS boundary rules error-level, and document the before/
      after matrix.
- [ ] Fresh-clone build + desktop installer + Android APK + web build; final practice smoke;
      DRIVER-GUIDE/README/handoff; release tag.


## Hexagonal migration P0 (2026-11-12, done)
- [x] Re-verify the audit (LOC, file roles, schema version, coupling) and record corrections in the
      blueprint.
- [x] Write the coupling audit script and generate `docs/architecture/coupling-matrix.md`.
- [x] Publish blueprint, PORTS.md, BRIDGE.md, DRIVER-GUIDE.md and ADR-001..003.
- [x] Scaffold the cargo workspace, join `src-tauri`, move the release profile and linker pin.
- [x] Add `scripts/check-boundaries.mjs`, `scripts/coupling-audit.mjs`, `scripts/capture-golden.mjs`
      and the npm scripts; add the `architecture.yml` CI job.
- [x] Capture goldens for jsonRepair, capWords, isSilent, sameWords, sentenceChunks (33 cases).
- [x] Verify cargo check/fmt/clippy/test, bun check/build/SPDX, boundaries, matrix and fixture
      determinism.
- [x] Commit P0-P3 on `refactor/hex-arch-p0` (`baa6f5f`); open the PR when the user asks.

## Hexagonal migration P1 (2026-11-12, done)
- [x] Bridge dispatcher, `core.ping`, `BridgeError`, `bridge.v1` handshake and `UiEvent`
      (`pong`, `error`); event catalog in `onspot-app` with ADR-004.
- [x] Web transport (wasm-bindgen, JSON-compatible objects) and Tauri transport (`Channel`,
      pass-through `core_init`/`core_command`).
- [x] `CoreClient` with both transports selected by `isTauri()`, ADR-002 toggle (`VITE_CORE_BACKEND`,
      localStorage override, frozen allowlist) and a dev-only probe.
- [x] ts-rs type generation with a deterministic assembler; `bun run bridge:types` and the CI
      `bridge` job fail on a stale `types.gen.ts`.
- [x] Verified on the web (headless Chrome) and desktop (Xvfb + WebKitWebDriver): same init/ping
      values, both `pong` events, no probe in the production build.
- [ ] Android build of the shell with the bridge feature (no toolchain pass in this session).

## Hexagonal migration P2 (2026-11-12, done apart from build smoke tests)
- [x] Port schema 1–12 and the migration runner verbatim; `schema_migrations`, one transaction per
      version, quote-aware statement splitter.
- [x] `SqlDriver`, `HistoryStore`, `SettingsStore` ports; native `RusqliteDriver` (bundled SQLite,
      ADR-005); settings/history stores; cascade delete and JSON setup parsing.
- [x] Synthetic v0.2.4 (schema 9) fixture plus tests: fresh schema, v9 → 12 with rows preserved,
      `integrity_check`, `foreign_key_check`, repository round trips.
- [x] `history.list/search/rename/delete` and `settings.list/get/set` bridge commands,
      `settings_changed`/`history_changed` events, ts-rs types, Tauri boot wiring; secret-prefixed
      settings never returned.
- [x] Extract `historySearch.ts`, capture 10 cases, and prove Rust `regex` parity; ADR-006 records
      the engine differences.
- [x] Web host SQL shim over `sqlite.worker.ts`: async dispatch, per-target `Send` split, host
      object at `init_core_wasm`; browser harness `bun run test:storage` (Chrome + dev server).
- [x] `SecretStore` as a driver-side host store over the same browser storage on both runtimes;
      secrets regression asserted in the browser (settings + whole-db export contain no key).
- [x] Settings and History rewired through `core-client` (rows/load/search/list/rename/delete) and
      the default flipped to `core`; legacy remains selectable and is the fallback when the wasm
      package is absent.
- [x] Typed `AppSettings` defaults/merge resolved: deferred to P7 with the language/provider/voice
      catalogs; ADR-008 reconciles the phase prompt with `decisions.md`. P2 owns the rows only.
- [x] Migrate the checked-in schema-9 fixture through the **web** path: `CoreStorageCheck` opens it in
      an in-memory sqlite-wasm host and the Rust runner reaches schema 12 with rows intact; the same
      browser check still covers persistence, history writes and the secret regression.
- [x] Port the remaining repositories: `RecordsStore` (prompts, sessions, attempts, glosses,
      translations, corrections, audio, prompt submissions, sync) with round-trip + fixture tests.
      Usage is device-local `localStorage`, not a SQL table; its port is P6.
- [x] Provision the gitignored wasm package for deployed builds: Pages and Cloudflare now install the
      matching wasm-bindgen CLI and run `bun run bridge:wasm`; `scripts/cf-deploy.sh` builds it when
      missing.
- [x] Align the Tauri JS packages with the resolved crates (`api` 2.12.4, `plugin-sql` 2.6.0,
      `plugin-opener` 2.7.3, `plugin-dialog` 2.8.4, `plugin-http` 2.9.0, `plugin-fs` 2.7.1).
- [x] `bunx tauri build --no-bundle` succeeds; `target/release/onspot` (39 MB) built with the new
      storage path.
- [ ] Android build of the new storage path (needs the NDK toolchain).

## Hexagonal migration P7 (started 2026-11-12)
- [x] Session Markdown export: `onspot-app::export` assembles the same document (date/mode/takes,
      quotes, tag-stripped explanation, follow-up, translations, corrections, slug file name).
- [x] Bridge `export.session_markdown` loads the session/attempts/corrections; `useCore('export')`
      sends History/Practice exports through it. Golden full-take + empty-session tests pass.
- [x] Backup format guards (`is_sqlite_database`, `is_onspot_database`) with tests.
- [x] Sync policy (`compare_sync`/`decide_sync`/choice) with synthetic-pair tests; bridge
      `sync.decide`; `syncNow` asks the core for the decision when `useCore('sync')`.
- [x] Language registry moved to checked-in JSON (35 languages, voices, instruction languages),
      generated by `scripts/export-language-catalog.mjs`; Rust catalog lookup and resource levels.
- [x] Prompt catalogue moved to checked-in JSON (22 prompts); bridge `prompts.catalogue`; seeding
      uses the core when `useCore('language')`.
- [x] Language data planner math (`language.plan`) and `language.catalog`, with tests and a
      browser check. The catalog carries per-voice assets and the planner sums them, dedupes shared
      URLs across target/explanation voices, and keeps transfer below storage for compressed files.
      `bun run catalog:check` guards the checked-in JSON against the TypeScript registry.
- [x] Pure reminder due-state and onboarding status helpers with tests.
- [x] Bridge `reminders.state`; the reminder store uses it when `useCore('reminders')` (localStorage,
      notifications and scheduling stay driver-side). Browser gate checks a due reminder and the
      core prompt catalogue.
- [x] Bridge `onboarding.decide`; the layout redirect and welcome guide read the status through
      the core when `useCore('onboarding')` (the stored value stays device-local).
- [x] Whole-database export/restore API through `FileSystemSink`: two-step `restore.pick` /
      `restore.confirm`, `FileSystemSink` + `DatabaseFile` ports, base64 host calls, native
      rusqlite online backup; Rust secrets-boundary, foreign-file and v9-fixture round-trip tests;
      Data settings now use `export.database` / `restore.*` under `useCore('export')`.
- [x] WebDAV/Drive adapters moved behind Rust ports (`SyncProvider`, `OAuthBroker`, `SyncStore`,
      `HttpClient::send_bytes`), core `run_sync`, bridge `sync.*` + `http.sync` + `oauth.*` shims,
      and the golden decision table. Web round-trip/conflict smoke passes via `bun run test:sync`.
- [x] Desktop WebDAV round-trip smoke: `bun run test:sync:desktop` drives the release Tauri app
      under Xvfb/WebKitWebDriver against the in-memory WebDAV fixture (connect, native export,
      upload, no-op, conflict, rusqlite restore, foreign remote refused). Needs
      `bunx tauri build --no-bundle` first.
- [ ] Optional Drive smoke (needs real Google credentials).
- [x] Language download orchestration and core-driven progress bars: `LanguageDataInstaller`
      port, `RunLanguageDownload` (ordered STT → voice → explanation voice, combined progress),
      `language.download` / `cancel_download` / `download_progress`, `download_progress` event,
      driver worker host calls, and the store now takes pending/readiness from `language.plan`.
- [x] Sync UI rewire: `syncNow` and provider connect/disconnect use the core under
      `useCore('sync')`; Settings still owns the destination fields and the conflict dialog, while
      the driver keeps the content revision and device-local credentials.
- [x] Web smoke for sync (connect/upload/no-op/diverged conflict/restore/corrupt-remote rejection).
      The conflict is a real divergence now: a local session is written after the untouched upload
      and the remote is rewritten, so both sides changed; the explicit download discards the local
      edit.
- [x] Browser portability walkthrough (`bun run test:portability`): export → fresh browser context
      (wipe) → restore → history and session Markdown intact; secrets absent from the export.
- [x] Browser first-run walkthrough in the same check: a fresh database opens the setup guide,
      **Skip for now** records `skipped` and the redirect stops; a due reminder constructs a
      system notification.
- [x] Desktop dialog walkthrough: `bun run test:portability:desktop` clicks the real Settings →
      Data buttons, answers the native Save/Open dialogs with xdotool, confirms the replace and
      proves an exported setting came back. It caught the missing `dialog:allow-open` capability
      that made **Restore .sqlite** do nothing.
- [x] Committed P7 on `refactor/hex-arch-p0` as `c11ca8c` (the `deprecated/` archival policy for
      P8 is recorded in `decisions.md`).

## P7 closeout audit (2026-11-14)
- [x] Regenerated `docs/architecture/coupling-matrix.md` (P7 left it stale, so the architecture
      CI check would fail on `c11ca8c`). `node scripts/coupling-audit.mjs --check` now passes.
- [x] Re-ran the P0-P7 gates available here: `cargo test --workspace`, clippy, fmt, `check` (0
      errors), `test:storage`, `test:practice`, `test:sync`, `test:portability`,
      `test:sync:desktop`, `test:portability:desktop`, boundaries, SPDX, catalog, typegen.
- [ ] **Port the typed `AppSettings` defaults/merge/normalise document to the core (ADR-008).**
      P7 promised it and only moved the catalogs; `stores/settings.ts` still owns 520 lines of
      defaults, migration, `sanitizeTunings`, `rememberedVoices`. P8's deletion list includes
      `stores/settings.ts` logic, so this must land before the cutover.
- [ ] **Move the provider/model catalog and automatic-model policy to the core (ADR-010).**
      `adapters/llm/providers.ts` (167 lines: providers, models, resource-level trust, label and
      base-URL lookup) still drives Settings and the LLM client. P8's deletion list includes
      `adapters/llm/*` domain parts.
- [ ] Fix the remaining stale architecture prose: BRIDGE.md command names are updated; PORTS.md is
      updated for the P7 statuses. Re-read both once the two ports above land.
- [ ] Record gloss coalescing as a driver-side deviation (it lives in `stores/practice.ts`, not the
      core). Behaviour is correct under core; P8 should keep it in the thin store or move it.
- [ ] Android build still unverified (P1/P2/P3): this host has the Android SDK/NDK but no rustup
      Android targets. P8 needs an APK build (local toolchain or CI).
- [ ] Credential/device gates remain: P3 listening pass + physical Android run, P4/P5/P6 live-key
      smokes, P7 Drive smoke, Windows/macOS export/restore.

## Hexagonal migration P6 (started 2026-11-12, complete 2026-11-12)
- [x] Usage map (`docs/architecture/usage-map.md`): ledger rows, scopes, 24 h retention,
      header/refusal parsing, published tables, monitor consumers, time semantics.
- [x] Goldens and ports: `parseDuration`/`parseRefusal` (11), Groq tables (21), display
      formatting (12), ledger key/scope/totals (4); legacy `localStorage` JSON interop test.
- [x] `onspot-app::usage_monitor`: meters from live headers/refusals/counts, roll-forward,
      take/read estimates, notes, warnings, account-backed ElevenLabs/DeepSeek and local services.
- [x] Bridge `usage.snapshot` + `usage_warning { kind, provider, message_code }`; web/Android
      desktop-style header figure paths preserved.
- [x] Settings usage meters and practice warnings use `usage/view.ts`, which selects core or
      legacy; core monitor starts only when `useCore('usage')`.
- [x] Browser gate exercises the command and the core-backed store (`test:practice`); build,
      svelte-check, clippy, workspace tests, boundaries and SPDX green.
- [ ] Live-key meter comparison and a desktop (Tauri webview) usage-page smoke need a real key
      and device; not available in this session.

## Hexagonal migration P5 (started 2026-11-12)
- [x] Capture the Insights aggregation golden and port `computeInsights` to
      `onspot-app::insights`; the fixture covers grouping, severity, style exclusion and
      orphan-correction filtering.
- [x] Translation v3 prompt rules and messages ported; 6 language-pair goldens pass.
- [x] Translation response parsing and the `translations.ensure` bridge command; the core path
      persists the v3 set and `ensureAttemptTranslations` uses it.
- [x] Insights bridge (`insights.build`) and the Insights page data source behind `useCore`.
- [x] Glossary/hover prompts, parsing, `glosses.ensure`/`glosses_ready`, phrase translation and
      `phrases.ensure`/`phrase_ready`; the practice store coalesces identical jobs in flight.
- [x] Legacy-compatible gloss cache key (FNV-1a over UTF-16 + base-36 length, `numbered:` prefix).
- [x] Legacy gloss-key parity test and a browser cache check (two identical requests → one provider
      call); POS (`withPos`) is threaded through the core gloss request.
- [x] Bridge commands for translations/glosses/phrases/insights and the practice/Insights data paths.
- [ ] Live provider hover/restart smoke on a device with a real key (the browser check stubs the LLM).
- [x] Phrase meanings; bridge commands/events; rewire hover/translation/Insights data paths.
      (Was already done when the entry above was written; the duplicate was stale.)
- [ ] Legacy/core gloss/translation cache interop assertion: the v0.2.4 fixture has legacy
      `translations` JSON but no glosses, and `the_fixture_reads_through_the_full_repositories`
      only asserts row counts. Web cache check passes; desktop hover smoke waits on a real key.

## Hexagonal migration P4 (finished 2026-11-12, committed `74db35c`)
- [x] Extend the golden harness with prompt, evaluation-parse, explanation, markup and JSON-extract
      fixtures (captured from the current TS).
- [x] Port the pure LLM pipeline to `onspot-adapter-llm-openai`: `json_repair`, `strip_thinking`,
      `extract_json`, `normalize_evaluation`, `compose_explanation`/markup, evaluation prompt
      rendering, and the Japanese/Persian guidance. All captured fixtures pass byte-for-byte.
- [x] `onspot-dsp::words`: `same_words`, `overlapping_words`, `ends_sentence` with tests.
- [x] `HttpClient` + `LlmProvider` ports; `OpenAiEvaluator` adapter over the host HTTP shim;
      token-bucket pacing over `Clock` with deterministic refill/penalty tests.
- [x] `onspot-app::evaluation` (`EvaluateAttempt`, `TestLlmConnection`, `EvaluatorPort`); bridge
      `evaluation.test_connection`; `StopAndAnalyze` uses the Rust evaluator (the P3 host shim is
      gone); Settings' connection test uses it.
- [x] Redaction/error-path tests; web full loop and connection test against a stubbed provider;
      desktop connection test through the Tauri HTTP plugin; Android `cargo check`.
- [ ] Live Groq/DeepSeek key smoke (no key available here) and a human-quality review of a real
      model reply.

## Hexagonal migration P3 (started 2026-11-12)
- [x] Map the practice God store: `docs/architecture/practice-loop-map.md` (all exports, callers,
      state, companion modules, ports/use cases/events, four race cases). Posted for the phase
      re-approval; proceeding unless the owner objects.
- [x] Reconcile `practice.ts` vs `practiceSession.ts`: the latter is the sample/live view context,
      not a second store; it stays.
- [x] `onspot-dsp`: `speech::is_silent` and `speech::cap_words` with all `isSilent`/`capWords` golden cases passing; `MAX_ATTEMPT_WORDS = 240`.
- [x] Ports: `AudioCapture`, `SttEngine`, `TtsEngine`, `AudioPlayback`, `Clock`, `PromptSource`,
      `EvaluationPort`, `IdSource`, cancellation and the stable error shape (ADR-009). Contract
      tests pass. `PracticeEnvironment` is represented by the snapshot's
      `explanation_audio_available` flag.
- [x] `onspot-app::practice`: `RunPracticeSession` with start/cancel/stop/tick/timer, prompt choice,
      resume, persistence and the event snapshot; 15 scenario tests including the double-stop claim
      and timer. The remaining four cancellation races are not written yet.
- [x] Native STT adapter (`onspot-adapter-native-stt` wraps the plugin's whisper.cpp engine);
      host RPC shims for capture/STT/evaluation/prompt on both transports; playback intents.
- [x] Bridge `practice.*` commands and `core.host_reply`, generated types, `practice` on the core
      allowlist, `stores/practice.ts` branching on `useCore('practice')`. The legacy path stays
      selectable and remains until P8 (ADR-002).
- [x] Four cancellation race tests (stop during transcribe/evaluate, new take during evaluation,
      timer vs click) plus a full phase-event stream test.
- [x] Smoke: `bun run test:practice` in real Chrome (prompt, start, cancel, silent take, and a
      full stubbed STT → evaluation → persisted attempt loop); P2 `test:storage` still passes.
      Desktop release under Xvfb + WebKitWebDriver recorded 4.1 s through a null PipeWire source,
      ran native whisper.cpp + the local LLM stub, and persisted an attempt. Android `cargo check
      --target aarch64-linux-android` passes.
- [ ] Human-quality transcription/TTS listening pass and a physical Android run (the desktop smoke
      used a null sink; its transcript was an engine artifact, not scored speech).

## About page (2026-11-11, built)
- [x] Replace `/about` with the corrected stationery prototype and delete `/about-preview`.
- [x] Fix the single-scroller layout, phone header placement, reveal root and footer reveal.
- [x] Correct the privacy/audio/prompt-sharing wording and the AGPL version.
- [x] Apply card-stock paper, tape textures, Source Serif 4 and a dark surface ladder.
- [x] Restrict motion to transform/opacity and verify both themes at 1280 and 390 px.
- [ ] Frontend redeploy (the live site does not have this page yet).

## Historical word POS (2026-11-11, built)
- [x] Preserve `pos`/`posSections` when parsing saved glosses (previously dropped on reload).
- [x] Re-request a section with POS on hover when historical glosses have no labels; merge without
      losing words/phrases/selections; remember blank answers in `posSections`.
- [x] Show POS only while `showWordPos` is on; remove the `llmConfigured` gate.
- [x] Verified with a stored attempt: `Je mange une pomme.` gained `verb`, tooltip `eat / verb`, and
      both survived reload. check/build/SPDX clean.

## Instruction-language prompt catalogue + client generation (2026-11-10, built)
- [x] Single prompt catalogue keyed by instruction language (`practice/promptCatalogue.ts`); English
      entries are ordinary `en` rows, Japanese/Persian topics use `targetLanguages`. Removed
      `LanguageDefinition.prompts`/`LanguagePrompt`.
- [x] Migration 11: `prompts.instruction_language` (backfill `en`); `Prompt`, SQL adapter and legacy
      JSON import updated; seeding per target + instruction language with catalogue ids as row ids.
- [x] `adapters/llm/promptTopic.ts`: one prompt in the instruction language with target language,
      level, mode and recent topics; length, script and repeat validation.
- [x] Async prompt selection with in-flight/late-response guards; generation on session start and New
      prompt; fallback stored → English catalogue with a visible note; prompts only change between takes.
- [x] Removed the translation path (`promptDisplayText`, `translateCurrentPrompt`,
      `translatePromptText`, sample-session field).
- [x] Instruction-language change: a draft gets a new prompt at once; a session with takes keeps its
      prompt and uses the new language from the next prompt.
- [x] Verify: check 0/0, build, SPDX 254, migration on a pre-11 DB, catalogue counts, real adapter
      generation against a local OpenAI-compatible stub, app fallback chain and reload persistence.
      **Not verified:** a live Groq/DeepSeek call (no key configured here).
- [x] Docs: `docs/architecture/languages.md`, `supported-languages.md`.
- [x] `/about`, README and Settings privacy copy updated for opt-out prompt sharing.

## Prompt contribution phase (2026-11-11, built; Worker deployed)
- [x] Opt-out outbox of generated prompts (`prompt_submissions`, migration 12); sharing is on by
      default and the Settings → Data toggle stops queueing and sending; retries with backoff and
      on `online`; prompt only (title, text, languages, level, mode), no transcripts/keys/device id.
      Prompts generated while off stay local and are not backfilled.
- [x] Cloudflare Worker + D1 ingest (`server/prompt-submissions/`): validation, CORS, SHA-256
      content dedupe, no IP storage, `pending` review rows.
- [x] Russian catalogue entries (8) and short generation (5–6 words, hard cap 6) so a non-English
      instruction language does not depend on a model call.
- [x] **Deployed:** Worker `onspot-prompt-submissions` at
      https://onspot-prompt-submissions.khizardevelops.workers.dev, D1 `onspot-prompts`
      (`0f2fd610-3719-4fb6-bdc7-9db4191a1a65`), schema applied, `cf deploy` used. Live health, ingest
      and dedupe checked; test row removed. The app defaults to this URL.
- [ ] **Frontend redeploy:** the live SPA does not yet contain this session's code. The next normal
      frontend deploy (or `scripts/cf-deploy.sh`) will enable the Settings toggle for users.
- [ ] Maintainer review script exports approved rows into the repo catalogue via a PR; never auto-merge.


## Planning-ideas batch defects (2026-11-10)
- [x] `/about` imports that Lucide v1 no longer exports (`Github`, `Twitter`) → inline brand SVGs.
- [x] Four `state_referenced_locally` warnings in the theme, zoom and text-size stores.
- [x] Prompt translation across session open/startup and instruction-language changes; stale
      answers ignored.
- [x] JSON backup restore keeps `freeflow` sessions; Settings About link follows the base path.
- [x] Live check of prompt translation with a real Groq key (2026-11-10): switching instruction
      language to Spanish translated the prompt in 1.5–3 s, switching back to English restored the
      source at once, and a reload with Spanish stored translated the new prompt on startup.
- [ ] Backup round trip of a free-flow session.

## Sessions, voices per language, zoom (2026-11-08)
- [x] Sessions record and restore their setup (migration 10); older ones inferred once.
- [x] Voices remembered per language for read-back and explanations.
- [x] Word popup placed correctly under the interface scale (CSS zoom).
- [ ] neo menus/selects/tooltips under a non-100 % scale were not measured (same floating-ui
      issue may apply; `onScreen` in `neo.ts` would be the place).
- [ ] History could show each session's languages now that they are recorded.
- [ ] Ask: should a never-chosen explanation language default to a voice (e.g. Supertonic, whose
      model is shared) instead of asking once?

## UI motion and floating surfaces (2026-11-08, built)
- [x] Menus, selects, tooltips open in place at 90–150 %; select lists keep order, open at the choice.
- [x] Feedback sheet slower and smooth; swipe release follows the finger. Practice freeze at 90 % fixed.
- [x] Tooltips: 250 ms settle, even fade, crossfade between neighbours.
- [x] Nothing floating scales (no letter wobble); floating surfaces close on page scroll; glare pauses under them.
- [x] Settings selects fade only (neo's CSS scale removed).
- [ ] Dropdowns sliding in from the right off 100 % scale in the user's Firefox: not reproduced for
      PopMenus. Needs which dropdown, which scale, ideally a screen recording.
- [ ] User feels the tooltips and the sheet on real hardware; say if another animation still looks wrong.

## Voice loudness (2026-11-08, built)
- [x] Every on-device clip leveled to −20 LUFS + look-ahead limiter in `processPcm`; Settings
      preview levels the same way; `lufs-20` in cache keys (`decisions.md`). Verified in the app,
      muted: five voices −27.4 … −15.0 raw → −20.00 … −20.05.
- [ ] User listens: does −20 LUFS sit right against their music/system level, and do Tom and the
      spikiest Supertonic voices (DE F1) sound unsquashed?
- [ ] Ask: store clips at 64 kbps instead of 32? Opus at 32 kbps takes 2 dB (and some treble) off
      Piper Tom's stored copies; 64 kbps keeps it (0.3 dB) at twice the size.
- [ ] Cloud clips are not leveled (streamed ElevenLabs plays before it can be measured). Measure
      OpenAI/ElevenLabs output against −20 before deciding.

## Every on-device-voice language (2026-11-08)
- [x] 35 study languages and 35 languages of instruction from `LANGUAGE_FACTS`.
- [x] Urdu (Piper Fasih, Aegis) and Bengali (Piper Google) on the device; voice check 3/3.
- [ ] User listens to Fasih vs Aegis (Fasih is the default only because its v2 is newer).
- [x] Settings warns when the configured engines cannot handle a selected language (`support.ts`).
- [x] Hindi/Greek sentence ends, Chinese word splitting, a searchable first-run picker.
- [ ] Nothing is reviewed for the 32 new languages: listen to their default voices, try Whisper
      small on real speech (weak for et/lv/lt/sl is likely), and record the evidence.
- [ ] LLM rules exist only for Japanese and Persian (`languageGuidance.ts`); Chinese, Arabic,
      Hindi, Korean may need script/register guidance.
- [x] Arabic-script text (Urdu explanations broke: ہ/ے drawn by another font) → bundled Noto Naskh
      Arabic in every stack; checked in a real card with an Urdu explanation.
- [ ] Fonts for the other new scripts (Devanagari, Bengali, Hangul, Greek, Cyrillic) and
      Latin-extended letters are the device's; not audited on phones.
- [ ] Nastaliq for Urdu (Noto Nastaliq Urdu) if the user prefers it: needs `lang` on
      instruction-language text and taller lines; Naskh is used for now.
- [x] `۔`/`؟`/`。`/`।` count as sentence ends everywhere (one list in `segments.ts`); explanations
      no longer end in `۔.` and Urdu/Persian pieces get sentence pauses.
- [x] Follow-up questions in the wrong language are dropped (`couldBeWrittenIn`); the prompt says
      "never in <instruction language>".
- [ ] The first-run `LanguagePicker` never opens (`initSettings` always sets a language): decide
      whether the welcome guide should ask for the language, or delete the picker.
- [ ] ElevenLabs v3 (70+ languages) is not offered as a model; adding it would cover fa/ur/bn in the cloud.

## Take card voice menu (2026-11-08)
- [x] Voices inline in the card's actions menu, grouped by model; menus capped to the window.
- [ ] Touch check on a real phone (the long list scrolls inside the menu).

## Speaking pace (2026-11-08)
- [x] Settings → Speaking pace (80–110 %, default 90 %) for the target voice, at generation.
- [ ] Cloud read-back: ElevenLabs (`voice_settings.speed`) and OpenAI (`speed`) could honour the
      same setting; not done.

## Word taps (2026-11-08)
- [x] Prepare the words of the take being read (correct version + follow-up) in the background.
- [ ] Verify with a real take end to end (needs an LLM); watch phones, where preparing is slower.
- [ ] If "You said" words are tapped often, consider preparing those too (more background work).

## Supertonic sound (2026-11-08)
- [x] 3 steps sounded watery → measured; now Supertone's reference 8 steps / speed 1.05.
- [x] Explanation/long-text pieces lost up to 180 ms of their edge words → relative trimming.
- [ ] User listens to the seeded A/B (5/1.0 vs 8/1.05); if 5 sounds as good, return to 5 for speed.
- [ ] Explanation latency at 8 steps (42 s for six pieces under load): merge an explanation's
      same-voice pieces, or prepare earlier, if the user keeps 8.
- [ ] Build the sound-quality gate (noise, bandwidth, periodicity, clipping vs per-voice baseline).

## Voice library in Settings (2026-11-08, uncommitted)
- [x] Side panel beside Settings ≥1100 px, sheet below; grouped by model; download + cancel; Try / Sample.
- [x] Supertonic checksum verification + readable runtime exceptions (user saw "19949696").
- [ ] Ask the user where "19949696" happened (browser/Tauri, action) and whether it recurs after reload;
      the console now names the C++ type.
- [ ] Decide whether the cloud voice pickers should also open beside the settings.
- [ ] Device check of the sheet on iPhone/Android and in the Tauri window.

## On-device voices for any language: Supertonic 3 + Piper (2026-11-08, uncommitted on `main`)
- [x] Spike in the scratchpad: prebuilt sherpa-onnx runs unmodified; RAM/speed/latency measured
      (`docs/benchmarks/tts.md`); the user listened and chose Supertonic.
- [x] `scripts/sherpa-tts-assets.sh` (pinned v2.0.1, SHA-256s, LICENSE), `.gitignore`, SPDX skip,
      service-worker precache exclusion, a fetch step in the four CI workflows.
- [x] `speech/tts/local/` (worker, `LocalVoiceWorker` proxy, registry, cache, assets) and
      `speech/tts/supertonic/` (runtime loader, shared model, adapter; reference 8 steps / 1.05, peak ceiling).
- [x] Voice table `languages/voices.ts` by language code for both roles; Supertonic for 31
      languages; Piper Persian ×5 and Chinese Huayan; `voicesFor`/`explanationVoicesFor` read it.
- [x] Language data counts shared downloads once; Settings labels engine-neutral; sample button
      only for voices with a hosted sample.
- [x] Dev voice check at `/model-lab/voices/`; 48/48 pass on dev, 2/2 on the production build.
- [x] Fix: `globalThis.eval` (the bundler had turned an aliased eval into a direct eval).
- [ ] Listen: Supertonic at 3 vs 5 steps (session clips were in the scratchpad; regenerate in the
      model lab), and each language's voice in `/model-lab/voices/`; adjust `SUPERTONIC_STEPS`
      (`supertonic/SupertonicAdapter.ts`) if 3 sounds worse. User accepts rtf ~1.3.
- [ ] Turn on `local.tts` for Persian once a `fa_IR` voice passes the listening test.
- [ ] Audition explanation voices that have no hosted sample (Supertonic) before downloading.
- [x] Measure native Supertonic against WASM on laptop and phone (2026-11-10): 5× and 3.7× faster
      at 2 threads, no crash on hostile text.
- [ ] Native Supertonic for Tauri: the full plan is `docs/prompts/native-supertonic-voices.md`.
      Paused at the user's request. First ask the two questions at the top of that file (native
      clips by ear; memory of 350–385 MB against the 300 MB goal).
- [ ] Japanese engine ticket: Supertonic `ja` vs piper-plus by ear (piper-plus left untouched).
- [x] Urdu/Bengali on-device: rhasspy has Urdu (MIT) and Bengali (CC BY-SA data) Piper voices;
      added 2026-11-08 (MMS was never needed).
- [ ] Device checks: iPhone/iPad Safari memory with the 512 MiB prebuilt heap; Android WebView.
- [ ] Commit when the user asks (the working tree also holds the 2026-11-07 Persian/zoom work).

## Persian (cloud only) and RTL (2026-11-07, branch `fix/dark-mode-visual-depth`)
- [x] Registry: Persian `fa` (`rtl`, cloud only), `direction` and `local` flags, `isCloudOnly()`.
- [x] Enforce cloud-only in the first-run picker, `setTargetLanguage`, `initSettings`,
      `processing.ts`, `languageData.ts`, the three Settings panels and `CapabilityRow`.
- [x] RTL rendering: `directionForText` + `dir` on transcripts, questions, corrections and word
      pairs; `--font-persian`; `؟`/`،`/`؛` in sentence/clause splitting; ZWNJ kept in words.
- [x] Persian LLM evaluation/translation guidance and a Persian contrastive example.
- [x] Persian sample for Settings → Text size; preview waits for settings hydration.
- [x] Onboarding: no on-device voice for cloud-only languages; coach step forces cloud STT.
- [x] Docs (languages.md, supported-languages.md, README) and archive the shipped ideas.
- [x] Verify: check/build, persistence, locked rows, no install gate, RTL sample, no overflow.
- [ ] Run one real Persian take with live Groq + LLM + ElevenLabs keys.
- [ ] Check Persian on a real iPhone/Safari and on a device without Noto Naskh.
- [ ] Find local Persian STT/TTS models and re-enable `local` flags (active idea).
- [ ] Commit/push when the user asks.

## Global interface scale (2026-11-07, branch `fix/dark-mode-visual-depth`)
- [x] `zoom.svelte.ts`: 80–150% in 5% steps, device-local, applied before first render; 100%
      clears storage.
- [x] Settings → Learning → Interface scale: NeoRange slider, zoom keys, live percentage, reset;
      phone layout puts the track on its own row.
- [x] Root `zoom` with `--ui-vw`/`--ui-vh`; page/html/main height compensation and window-bar
      subtraction; fixed overlays use the divided viewport helpers.
- [x] Cap the iOS install card at `--ui-vh - 84px` with a scrolling body.
- [x] Verify desktop 80/100/125/150, iPhone 100/125/150, dark 125, controls/keys/reset, text-size
      editor, no overflow; check/build.
- [ ] Verify on real iPhone/iPad Safari, Firefox, Android WebView, and the Tauri desktop window
      bar at 125–150%.
- [ ] Drag the slider while the layout resizes and check each dialog at 150%.
- [ ] Deploy with `scripts/cf-deploy.sh` when the user asks; the live Worker still has the prior
      build.
- [ ] Commit/push when the user asks.

## iOS PWA live (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] Cloudflare Workers static assets deployed with `cf deploy --prebuilt` at
      **https://onspot.khizardevelops.workers.dev**; `scripts/cf-deploy.sh`, `.github/workflows/cloudflare.yml`,
      `static/_headers`; SPA fallback via `worker.config.json`.
- [x] Drop the Pages-only `_redirects` and `wrangler.toml`; Workers rejects that redirect as an
      infinite loop and applies the SPA fallback itself.
- [x] Drop the 26.5 MiB WebGPU-only ORT binary for Workers' 25 MiB asset cap; keep the 23.5 MiB
      WASM runtime.
- [x] Live verify: root/`/history/` 200, manifest, service worker no-cache, `_headers`
      (COOP/COEP/nosniff/referrer), 133 shell entries, SQLite WASM cached, offline History,
      iPhone 14 card.
- [ ] Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repository secrets for the CI deploy;
      set `VITE_GOOGLE_CLIENT_ID_WEB` and add the Worker origin to the Google OAuth web client.
- [x] Check/build/SPDX, deep-link registration, offline SQLite, update prompt/reload, iPhone 14
      dark, iPhone SE, iPad Pro, no overflow/errors.
- [ ] Optional cleanup: delete the empty legacy Pages project `onspot-4k1.pages.dev`.
- [x] Web app manifest, 192/512/maskable icons, 180 px Apple touch icon, light/dark theme colours,
      iOS meta and 28 launch images; `scripts/pwa-assets.sh` regenerates them.
- [x] Production web-only service worker (SvelteKit 3 `$app/service-worker`/`$app/manifest`/
      `$app/env`): shell precache, small-asset filter, WASM-on-first-use, offline shell with pinned
      base, no cross-origin API/model caching; `serviceWorker.register: false`.
- [x] Waiting-worker update card with Later/Reload; no automatic takeover.
- [x] iPhone/iPad install card plus permanent Settings → Learning section; local STT/voice stays
      available with a cloud nudge; installed state.
- [x] Pre-paint theme/status-bar meta and top safe-area padding.
- [x] Verify: check/build/SPDX, deep-link registration, offline deep link, update prompt/reload,
      iPhone 14 dark, iPhone SE, iPad Pro, no overflow/errors.
- [x] Live Chrome verification: root/`/history/`, manifest, service worker no-cache, `_headers`,
      deep links, 133-entry shell cache, SQLite WASM, offline History.
- [ ] Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repository secrets for the CI deploy;
      set `VITE_GOOGLE_CLIENT_ID_WEB` and add the Worker origin to the Google OAuth web client;
      then verify Safari on a Mac VM if possible.
- [ ] Real iPhone/iPad: install from Safari (Share → Add to Home Screen), full-screen launch,
      icon/name/splash, safe areas in portrait/landscape, keyboard, gestures, Back, silent switch,
      interruptions, export/restore, offline after a language-data download.
- [ ] Decide the GitHub Pages migration notice period; keep the old origin up and add the
      export-and-move notice; redirect only after the notice period the user agrees.
- [ ] Google Drive popup in the installed app; if broken, hide Drive there with an honest note.
      WebDAV CORS.
- [ ] Local Piper and Whisper on an iPhone: measure memory/speed; if Whisper is killed, mark it
      unavailable with the reason but never remove the local download option wholesale.
- [x] iOS notification honesty: `notificationsSupported()` is false on Apple touch devices, so
      Reminder Settings offers only the in-app nudge and never requests system permission.
- [ ] Screen Wake Lock during downloads, clean restart/Retry, free-space display, and Web Share
      export.
- [ ] Performance on a ProMotion iPhone/iPad and `crossOriginIsolated`/single-thread note.
- [ ] README iPhone/iPad install section, `docs/releases/`, and move the idea to the archive when
      actually shipped and verified.
- [ ] Commit/push when the user asks (branch remains uncommitted).

## Brand v2 (2026-11-06)
- [x] Move every v1 asset into `brand-assets/v1/` and repoint its users.
- [x] v2 in `brand-assets/v2/`: squircle and circle icons, mark, four logos, construction,
      VectorCraft source, geometry scripts, README.
- [x] Amended to monochrome: white for dark mode, black for light mode, no colour.
- [x] Glyph: one shape, `currentColor`, mark alone and in both outlines (for themed icons, favicons, print).
- [x] Glyph ground dips around bar 3 (minimal 0.25 m gap; bar stays solid).
- [x] Every SVG recolourable (`currentColor`, default ink as `color`); `source/finish_svgs.py` after each export.
- [x] In-app logo (header, welcome page) is the v2 squircle tile, light/dark by theme.
- [x] Applied everywhere (circle): desktop/iOS/Android icons, adaptive layers, installers, favicon,
      PWA icons and splash, Flatpak icon and branding, README header (`scripts/brand-assets.sh`).

## First-run onboarding + mode glare (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] `/welcome/` three-step guide: coach key (Groq / DeepSeek / ChatGPT / Claude gateway /
      custom), optional Groq speech-to-text, on-device vs ElevenLabs voice, summary.
- [x] Test the key on a temporary endpoint before saving; failed keys are never written.
- [x] ElevenLabs key only for cloud TTS; honest cloud-vs-device copy.
- [x] `onspot.onboarding.v1` done/skipped flag; first-run redirect only when no LLM and flag null.
- [x] Settings → Learning → Setup guide; Practice's LLM gate points to `/welcome/`.
- [x] `data-glare` on Practice follows the live mode: casual blue-green, exam red; a draft's mode
      switch changes it immediately, and a started session locks it.
- [x] Boost the exam strength (22/18/16%) over casual (14/12/10%) so red does not read dimmer.
- [x] Three large soft blobs drift slowly on transform-only animations (38/46/52s), stopped by
      reduced motion; moved low so they show beneath the cards.
- [x] Archive both ideas in `docs/planning/archive/ideas.md` (2026-11-06).
- [x] Verify with Playwright 29/29, light/dark/phone screenshots, check/build/SPDX.
- [ ] Verify a live key against each provider and a real ElevenLabs key.
- [ ] Try the guide on a real phone and desktop WebKit; check the first-run redirect there.
- [ ] Commit/push when the user asks (not done; branch remains uncommitted).

## Dark-mode depth + translation note header (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] Rebuild the dark surface ladder: page `#12110f`, card `#24211d`, inset `#1a1815`, key
      `#332e27`, well `#0d0c0b`; brighter border and text tokens.
- [x] Darken the dark paper texture (`PAGE.dark`, `KEY.dark`) so the page no longer renders near the
      card value.
- [x] Add subtle white catchlights to dark surfaces: `--shade-light` 0.20, `--glass-shade-light`
      0.18, lit glass-card top border, attempt-card top highlight, feedback card top light, header
      seams.
- [x] Raise the Feedback notebook to `#24211d` and its correction stock/hairlines.
- [x] Move a translation's tag and toggle onto the note header line; text below; own tag line per
      variant in Compare-all.
- [x] Restyle the note from the user's sticky-note mockup: washi tape, pastel paper, folded corner,
      tilt, dashed header, ink tab, regular Courier Prime, handwritten wavy controls.
- [x] Put "Each word" / alternatives at the far right (close X moved to lead the header); keep the
      longer "Hide each word" label on the same line at 390 px by hiding the decorative mark.
- [x] Replace the dashed/dotted stitched connector with one clean 1.5px line fading at both ends.
- [x] Stop the translation text being bold: import Courier Prime 400 and use it for translation lines.
- [x] Paginate the translations themselves: page 1 is the primary idiomatic translation, pages 2+
      are the alternatives, one at a time with a compact `‹ 1 / 4 ›` pager in the note header; default
      page 1, reset on view change/regeneration, wrap, constant note height; no pager for a single
      rendering.
- [ ] Look at the seeded note/pager screenshots with the user and tune copy or pager density if asked.
- [ ] Look at the seeded dark screenshots with the user and adjust the catchlight strength if asked.
- [ ] Verify on a real device / WebKitGTK; run a full-page automated contrast scan.
- [ ] Commit/push when the user asks (not done; branch is uncommitted).

## Planning ideas shipped (2026-11-06)
- [x] Settings → Learning capability guide (what onspot can and cannot improve).
- [x] Export one session's transcript and corrections as Markdown (History row + Practice session
      menu).
- [x] Language-data completion/failure notifications (toast; system notification when hidden).
- [x] Optional practice reminders (off by default; frequent ≈ daily, infrequent ≈ three days;
      in-app banner + best-effort system notification).
- [x] Word-for-word breakdown as horizontal pairs: source above rule above translation, each
      column centred; checked on desktop and at 390 px. Mobile keeps the same layout for now; the
      user will decide whether to revert phones to the earlier vertical list.
- [x] Archive the shipped items in `docs/planning/archive/ideas.md` (2026-11-06).
- [ ] Verify a real language-data download end to end: completion toast, error toast, and the
      system notification while the app is in the background.
- [ ] Verify a system reminder notification on a phone/desktop (permission granted, app hidden).
- [ ] Verify the Tauri `Export transcript` save dialog and the `.md` file on a desktop build.
- [ ] Decide whether the reminder should also be visible outside Practice (a small dot on History
      or Settings was not built).
- [ ] Commit/push when the user asks (not done; changes are uncommitted).

## Docs organisation (2026-11-03)
- [x] Split `docs/planning` into active `ideas.md` / `bugs.md` and mirrored history in
      `docs/planning/archive/`; moved fixed bugs and done/rejected ideas; updated `docs/README.md`.
- [x] Add `docs/planning/README.md` documenting the active/archive workflow for agents.
- [ ] Keep the active files current: when an idea ships or a bug is fixed, append it to the dated
      archive batch and remove it from the active file.

## Launch prep (2026-11-03)
- [x] README rewritten for non-technical learners: hook, Download CTA, download-vs-build split,
      French-first honesty, unsigned-build note; all dev details kept below.
- [x] Add an `[!IMPORTANT]` API-key banner and a two-minute Groq/ElevenLabs walkthrough at the top
      of the README, reinforced in the download and first-run steps.
- [x] Correct the five-minute recording claim (code caps at 60 s).
- [ ] Commit and push the README when the user asks.
- [ ] Fix the GitHub repo description typo ("langugae" → "language"; keep "inturn" as the author's
      wording) and add topics (language-learning, french, tauri, svelte, offline-first, privacy,
      whisper).
- [x] Draft release notes for v0.2.3 in `docs/releases/v0.2.3.md`. Published 2026-11-06 with new
      notes for v0.2.0–v0.2.2; release.yml now publishes `docs/releases/<tag>.md` itself.
- [x] Author CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, bug/feature/language issue templates
      and a PR template. Still to do: add `good first issue` / `help wanted` / platform labels.
- [ ] Enable GitHub Discussions with Announcements, General, Feature requests, Language requests
      and Development categories; pin a "Start here / known issues" post.
- [ ] Publish a language roadmap/status issue (French approved, Japanese in development, others
      demand-led) and a language-request issue for voting.
- [ ] Sign/notarize the Windows and macOS builds, or keep the README workaround prominent and add
      a troubleshooting page.
- [ ] Install and smoke-test every asset on real Windows, macOS (Intel + ARM), Linux (x64 + ARM)
      and Android hardware.
- [ ] Record a 30–60 s demo video/GIF (prompt → speak → feedback → hear the fix).
- [ ] Add a FAQ/troubleshooting page: getting a Groq key, microphone permission, model download,
      401/429 errors, SmartScreen/Gatekeeper, Android sideload, where data lives, backup/restore.
- [ ] Recruit 5–10 French beta testers and run a short task-based feedback script before any public
      post.
- [ ] Prepare a press kit: logo, screenshots, one-liner, 100/300-word blurbs, founder bio, links.

## Phone list after 0.2.2 (2026-11-02)
- [x] Phone bar in two rows; swipe up on the bar pulls Feedback up; stats tap-away + pin;
  slow-drag fixes; one playback speed button; text size per section; pop-up hides when its words
  are covered (state.md first entry; uncommitted).
- [x] Tried on the user's phone (Galaxy S24 FE): two-row bar, pull-up, stats tap-away and pin, speed
  button, text size all work; frame rates measured (state.md "120 fps pass").
- [x] APK icon: cause is the phone's Samsung Theme Park icon theme (state.md); the APK is right.
- [ ] User: re-apply/update the Theme Park icon theme (or let the assistant do it on the phone).
- [x] 120 fps pass: SVG noise textures → WebP/dropped, no fixed backgrounds, shade and sheet layers,
  sheet kept laid out, stack settles on `scrollend`; neo-snappy and textsize-v2 merged.
- [x] Language-of-instruction dropdown (all selects): portal, capped height, closes on pick.
- [x] Word meanings shifted by one: glosses keyed by word number; old saved meanings re-fetched.
- [x] Text size live canvas merged (state.md); worktree removed. Regression on :5173 after the merge:
  phone bar 32/32, gestures 34/34, speed 36/36, pop-up 25/25 + 11/11, live preview 122/122.
- [ ] Try the live preview on the phone (debug APK with everything is built:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`).
- [x] Insights rows overflowing on phones (grid-cols-1).
- [ ] Measure the desktop engines (WebView2, WebKitGTK, WKWebView) at their refresh rates.
- [x] Release 0.2.3 (tag `v0.2.3`, 2026-11-03): Latest, 15 files.
- [x] Release 0.2.4 (tag `v0.2.4`, 2026-11-07): Latest, 15 files, notes published once.
- [ ] Commit and push the `goto` `replace` fix (back.svelte.ts, TextSizeEditor.svelte) when asked.
- [x] GitHub has only `main` (feature branch deleted 2026-11-03).
- [ ] Delete the four old local branches (all contained in main)? Not asked yet.

## Every installer on x64 and ARM64 (2026-11-01)
- [x] release.yml: Intel Mac, ARM Linux (+ Flatpak), ARM Windows (.exe + .msi); test run green.
- [x] Merged to main and released as v0.2.1, then v0.2.2 (2026-11-02).
- [ ] Try the ARM and Intel builds on real hardware (none here).

## Automatic model choice + "Did you mean" changes toggle (2026-11-01)
- [x] Automatic (default) by languages, request size, per-minute and daily limits; verified (state.md).
- [x] Show/Hide changes in "Did you mean to say?".
- [ ] Measure model quality per language before approving a mid/low-resourced language (the trust
  levels in `AUTOMATIC_MODELS` are a judgement); consider Compound (70K TPM) once its JSON output
  is checked.
- [ ] Phone: the "Did you mean to say?" label wraps to two lines beside the two links.
- [x] Committed and pushed (30d0070..2742281); no tag yet.
- [x] Speaker button in a selection's meaning bubble (uncommitted; verified desktop + phone).
- [x] A held selection behaves as one unit for hover, click and tap; smaller speaker (uncommitted).
- [x] Pointer bridge from a selection to its bubble; readable dark-mode Feedback bookmark (uncommitted).
- [ ] User saw the selection bubble vanish while moving down to it; not reproduced in Chromium or
  Firefox. If it still happens, find out where (browser or desktop app/WebKitGTK).

## Desktop title bar + AppImage resize (2026-11-01)
- [x] Own thin title bar (WindowBar), `decorations: false`, macOS overlay traffic lights; AppImage
  forced to X11. Verified maximise/restore on Wayland and X11 paths via KWin (see state.md).
- [ ] User to click through the bar in the debug app (minimise, maximise/restore, close, drag,
  double-click, edge resize) and look at light mode; then commit and ship (v0.2.1?).
- [ ] Verify on Windows and macOS (CI builds only; no machine here).

## Brand: logo and app icon (2026-11-01)
- [x] Logo + app icon rebuilt in VectorCraft from the AI draft on a module grid (spec:
  `brand-assets/README.md`). Exports checked in VectorCraft's renderer and in resvg.
- [x] Wired in (2026-11-01): Tauri desktop + Android icons, favicon, header mark (macOS master on
  every platform, by the user's choice). Verified: `bun run check` 0/0; header at 1280 light/dark
  (tile on the 28px gutter, centred with the 32px keys, header height unchanged at 49px), favicon
  and image load (200), no overflow at 390px; Android masks simulated from the generated layers.
- [x] Favicon too small (user): web copy cropped to the tile (`app-icon-tile.svg`); header uses it
  at 28px. Re-verified: check 0/0, tile on the gutter, header 49px, served viewBox cropped.
- [x] Header mark still small (user): now 36px (the row's height; header stays 49px, centred with
  the keys). README shows the tile icon above the title.
- [x] Committed and pushed with the README icon beside the title and retaken Practice/History
  screenshots; released as v0.2.0.
- [ ] Not verified: a real Tauri build (Dock/taskbar/Flatpak icon) and an Android install.
- [ ] Decide whether `brand-assets/` is committed (nothing committed yet).
- [ ] Optional: horizontal lockup and a wordmark for light backgrounds ("spot" amber is too low
  contrast on Paper; needs a deeper amber).

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

## Cloud limits for five-minute takes (researched 2026-10-30; mostly implemented 2026-11-01)
- [x] Rate-limit pacing + Groq model rotation (`adapters/llm/pacing.ts`), long takes evaluated and
  translated in parts, hover meanings per section. See state.md and decisions.md (2026-11-01).
- [ ] `MAX_RECORDING_SEC` is still 60: raise it once long takes are confirmed end to end (the
  simulated 3/5-minute takes in `/dev/long-takes/` exercise everything after transcription).
- [ ] Cloud TTS of a 5-minute text in one request (below) is still open; on-device TTS now speaks
  long texts sentence by sentence (agent work, 2026-11-01).
- [x] (superseded) Decide how a 5-minute take is evaluated. `MAX_RECORDING_SEC` is still 60 although the README
  promises up to five minutes. At 5 min (1 200-word cap) one evaluation needs ~15k output tokens
  plus a ~1.5–2.3k-token prompt, which exceeds the free-tier 8k TPM (GPT-OSS/Qwen) and Compound's
  8 192 max completion. Options: per-segment evaluation, translations on demand only, or Dev tier.
- [x] Live provider limits: `x-ratelimit-*` headers and `Limit N, Used U, Requested M` from 413/429
  bodies (incl. OTPM) feed the pacing, which pre-checks every request. (`/models` metadata not kept.)
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
- [x] Run the Tauri `.sqlite` export/import round trip once on a desktop build:
      `bun run test:portability:desktop` (real buttons, native Save/Open dialogs, marker restored).

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
- [x] Run the desktop (Tauri) export and import once for real: `test:portability:desktop` covers
  the dialog save, native read, staged confirm and restore; the SQLite bytes are the same
  `VACUUM INTO` snapshot the browser check validates.
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
- [x] macOS bundle job failed in release.yml (v0.1.0): whisper.cpp's ggml uses `std::filesystem`
  (macOS 10.15+) and Tauri builds for 10.13 by default. Fixed 2026-11-01 with
  `bundle.macOS.minimumSystemVersion: "10.15"` (Tauri sets `MACOSX_DEPLOYMENT_TARGET` from it);
  verified by a manual release.yml run on main (see state.md).
- [ ] Linux AppImage aborts with EGL_BAD_PARAMETER on Arch (bundled WebKit); consider dropping it or
  building it on a newer base; .deb/.rpm work.
- [ ] Optional: default the web build (GitHub Pages) to Cloud processing, so first visitors are not
  pointed at the on-device data download.
