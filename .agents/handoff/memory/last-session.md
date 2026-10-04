# Last Session

## 2026-10-04: whisper.cpp WebGPU spike (branch spike/whisper-webgpu)
- `migration` snapshot committed (4b0c82a), spike branched from it.
- Toolchain: emsdk 6.0.11 + whisper.cpp clone in /mnt/data/not_synced/dev-cache/.
  `tools/whisper-webgpu/build.sh` + `binding.cpp` (C exports, JSPI, streaming model loader via
  EM_ASYNC_JS so the 190 MB file never sits whole in JS or the WASM heap). Output goes to
  `src/routes/model-lab/vendor/whisper-webgpu/` (gitignored) — NOT static/: Vite serves static
  files without COOP/COEP, and the pthread workers then hang forever at module start.
  Needs `-DGGML_OPENMP=OFF` (OpenMP symbols don't link in wasm).
- `/model-lab/` gained a 4th card (whisper.cpp · WebGPU · small q5_1) with a backend readout;
  `whispergpu.worker.ts`, shared `modelCache.ts` (fetchCached / streamCached).
- Results in docs/benchmarks/stt.md; Android phone (S24 FE) check: WebGPU blocklisted by Dawn.
- Headless Chromium needs `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`
  for an adapter. GPU memory on the Intel iGPU is only visible via /proc/<gpu-pid>/fdinfo
  `drm-total-*` (sample only the GPU process — scanning every fd starves the driver).

## 2026-10-04: model lab page
- User wanted to try the STT variants themselves. Added `src/routes/model-lab/` (+page.svelte,
  whispercpp.worker.ts): language picker (OFFERED_LANGUAGES), load/unload per engine
  (unload terminates the worker to free WASM memory), record / upload / French eval clip,
  sequential runs with time, rtf and WER (spaced languages with a reference only); TTS section
  generates each voice of the language (preload first so timing is synthesis only, optional
  approved profile). No stores/DB imported. `@transcribe/shout` + `@transcribe/transcriber`
  re-added as devDependencies for it.
- Browser-verified on :5173 (headless Chromium): Piper Tom generated audio; whisper.cpp q5_1
  loaded in its worker and transcribed an 8 s French clip correctly (rtf ~22 — it always
  decodes a full 30 s window). No TTS alternative runtime exists (Piper is ONNX-only).
- Note: uncommitted SvelteKit 3 migration (`$lib` → `#lib/....js`, `$app/tsconfig`) from the
  user/another tool is in the tree; `svelte-check` currently fails on tsconfig because of it.

## 2026-10-04: SvelteKit 3 migration (branch `migration`, uncommitted)
- `npx sv migrate sveltekit-3 --tasks all --confirm --no-install` (needs a clean tree: the user's
  uncommitted handoff edits were stashed and restored). It moved config into `vite.config.ts`,
  deleted `svelte.config.js`, rewrote `$lib` → `#lib/*.js|.svelte` in ~45 files, added the
  package.json `imports`, and the tsconfig. Manual: tsconfig vendor exclude, `repomix/bundle.mjs`
  resolves `#lib`, Svelte/Vite/vite-plugin-svelte minimums. MIGRATION_TASKS.md reviewed (goto
  targets all internal, no `page.url` mutation, no invalidateAll, no CORS reliance) and deleted.
- Verified: `npm run check` 0/0, `npm run build`, `vite preview` on :4173 in Chromium 1243:
  /, /history, /insights, /settings render, rail nav works, crossOriginIsolated, 0 console errors.
  Not verified: dev server (user's :5173 instance was left alone), real takes, Tauri, Android.

## 2026-10-03: multi-agent UI/UX + bug audit and fixes (committed as `4bc2d94`)
- Session end: the dev server Claude started on :5173 was killed for low system memory; the user
  restarts it. The user committed the work as `4bc2d94`.
- Five parallel sub-agents, each owning a file set: shell/global, Practice, History+Insights+DB,
  Settings, STT/TTS/LLM adapters+workers. `npm run check` 0/0; final
  Chromium pass over / /history /insights /settings at 1280 and 390: no console errors, no overflow.
- Highlights: restore rejects non-onspot `.sqlite` files (used to wipe data); migrations and
  correction replacement are atomic on web (Tauri still per-statement); LLM/Groq/OpenAI calls
  time out (120s) with readable errors; brace-safe JSON extraction; silent takes rejected before
  STT/LLM; Practice Cancel aborts evaluation; recording start/stop/session-switch races fixed;
  STT worker load dedupe + idle-release race; Language-data Cancel only kills the downloading
  worker; settings saves are queued diffs; card keyboard handler no longer swallows inner
  buttons; PermissionsPrompt only on Practice; neo toast `unregister` page error worked around
  (`NeoNotificationProvider stack={false}`); PaperTexture renders sequentially (startup freeze);
  `deleteAttemptAudio` so session delete frees cached read-backs; Insights double-listed patterns,
  case-split labels and counts from deleted takes fixed; "0:60" durations fixed.
- Untested at runtime: STT worker changes (need the 299 MB model), migration rollback, legacy JSON
  restore changes, silence threshold (-46 dBFS) on a real mic.
- Not fixed (deliberate): light `--muted-foreground` is 4.25-4.49:1 on rail/inset/control
  surfaces; phone hamburger overlays the top-right of scrolled content; plain transcript words not
  keyboard-reachable; cached TTS reports durationSec 0.
- First-run LanguagePicker not appearing is intentional (French default, see earlier sessions).
- Follow-up (user requests, browser-verified):
  - Recording is gated on a configured LLM (`llmConfigured` in `stores/llm.ts`: Groq/DeepSeek need
    a key; custom needs URL + model). Practice swaps Start speaking for "Add API key" →
    `/settings/#ai-provider` (SettingsSection now sets `id`), shows a notice, and
    `startRecording()` refuses with an error as a second guard.
  - Wrong-language takes: the evaluation schema asks for `spokenLanguage`; `normalizeEvaluation`
    replaces the corrections with one grammar error "Answered in X instead of French" covering the
    whole transcript (so it is never a "Clean take" and Insights counts it). Foreign words inside
    French are now errors per the prompt. Limit: local Whisper is forced to French and may
    translate English speech into French text, which no LLM check can see.
  - User's Firefox log `NoModificationAllowedError`: a second tab cannot open the OPFS DB. Now
    retried ~3.5s and explained in a toast + Practice error (see known-issues.md).
  - Attempt cards: list inset 8px/12px (was 16/28), 8px between cards, composer inset matched,
    elevation 2/1 (was 3/2), cards rest one inset below the top (`restTop`), thin scrollbar.

## 2026-10-01: docs/ reorganised into subfolders
- `docs/README.md` is the index. `planning/` (ideas.md, bugs.md — bugs split out of ideas),
  `architecture/` (languages.md, supported-languages.md), `benchmarks/` (unchanged),
  `research/` (model_problem.md, model-vetting.md = old plan.md), `reference/groq_free/` (was
  supported_providers/), `prompts/` (unchanged), `scratch/` (sandbox.md). Redirect stubs
  approved-tech.md / groq-models.md deleted. All references in docs, handoff (not archive) and
  code comments were updated; a link check found 0 broken paths.

## 2026-10-01: model_problem.md
- User is unhappy with Transformers.js STT RAM (~1.9 GB). Wrote `docs/research/model_problem.md`: the
  problem, every local + cloud model with purpose/specs/benchmarks, known vs suspected causes,
  replacement gates, rejected candidates, research leads. Todo added at the top of
  `docs/planning/ideas.md` ("optimisation") for the user's manual research; mirrored in tasks.md.

## 2026-09-30: whisper.cpp vs Transformers.js STT check (rejected)
- Question from `docs/planning/ideas.md`: does Transformers.js double RAM/disk vs GGUF, and should we use
  wllama? wllama runs GGUF LLMs only — not applicable. Benchmarked whisper.cpp instead.
- New dev-only route `src/routes/stt-bench/` (no stores, not in nav): runs the product STT worker
  over all scored eval clips, mirrors results to `window.__bench`; `&auto=1`, `&limit=n`.
  whisper.cpp engine code was removed after the run and `@transcribe/*` uninstalled.
- Results (details in docs/benchmarks/stt.md + runtime.md): Transformers.js reproduced 5.5% WER,
  rtf 1.81 on eval2, ~2.4 GB browser PSS loaded. whisper.cpp q5_1 9.1% / rtf 14.6, q8_0 6.8% /
  rtf 22.7, ~0.6 GB. Decision: keep Transformers.js (decisions.md).
- Driver (scratchpad, not committed): playwright-core `launchServer` + Chromium 1243, PSS summed
  over the browser pid tree from /proc. Gotcha: `pkill -f "<pattern>"` also kills the calling
  shell when the pattern is in its own command line (exit 144).

## 2026-09-25: Android pipeline + mobile UI/UX fixes
- Toolchain (no system changes): self-contained rustup (1.98.1, android targets) + Temurin JDK 21
  in `/mnt/data/not_synced/dev-cache/`; NDK 28.2 from the SDK. `scripts/android.sh` +
  gitignored `scripts/android.local.env`; npm scripts `android:*`. `src-tauri/gen/android` is now
  tracked (root .gitignore only ignores gen/schemas; keystore/jks/local env ignored).
- Config: RECORD_AUDIO/MODIFY_AUDIO_SETTINGS in the manifest; `app.security.headers` COOP/COEP
  (delivered, but **Android WebView never becomes crossOriginIsolated** — no SharedArrayBuffer,
  WASM single-threaded; engine already falls back); Cargo `[profile.release]` s/lto/1 cgu/abort/
  strip; release signingConfig from keystore.properties + isShrinkResources.
- MainActivity: native system-bar/cutout/IME insets padding (WebView 133 reports no CSS
  safe-area insets for Android 15+ edge-to-edge); theme windowBackground = paper colour per
  day/night. XML comments must not contain `--`.
- Verified on the API 36 x86_64 emulator: app runs (Chrome 133 WebView, Tauri SQL DB),
  mic → Android runtime dialog → live track; status bar fixed; Back behaviour below.
- Mobile fixes (shared code, also web on phones): PopMenu `onScreen` floating options
  (offset/flip/shift/size, 12px margin; nav menu had been cut off the right edge, translate menu
  off the left) incl. submenus; `@skeletonlabs/floating-ui-svelte` 0.3.9 added explicitly
  (deduped with neo). Feedback is a bottom sheet + scrim at ≤640px (grid keeps the 36px handle).
  Compact composer (equal action grid, short data notice). `pointer: coarse` touch targets (44px
  icon buttons, tabs stretch to track, text buttons ≥40px). Permissions prompt title counts rows.
  Reopened sessions restore their prompt text (`sessionPrompt()` in practice.ts; was blank).
- Android Back: `src/lib/platform/backButton.svelte.ts` — `closeOnBack(isOpen, close)` stack
  using Tauri `onBackButtonPress` only while something is open (menus, phone Feedback sheet,
  delete/restore/regenerate dialogs); otherwise default Back. Verified on device.
- Release: `npm run android:build` → signed arm64 APK (see commands.md).
- CI: `.github/workflows/android.yml` (GitHub Actions) builds the signed arm64 APK on push to
  main; needs the three ANDROID_* repo secrets (see commands.md). Nothing committed/pushed yet.

## 2026-09-25 (later): language data size is what's actually missing
- The "~399 MB" Japanese figure was only the label (`languageDownloadBytes` sums everything).
  The download already reused French's Whisper (Transformers.js cache is keyed by URL). Proven in
  Chromium: FR install then JA install fetched 0 Whisper bytes, 19.8 MB dictionary + 39.7 MB voice.
- `languageData` state now carries `pending` {stt, voice, storage, transfer} from the cache check
  (`voiceAssets()` in `adapters/tts/assets.ts` gives per-asset on-device and transfer bytes;
  `JAPANESE_G2P_TRANSFER_BYTES`). The progress bar is weighted by the missing parts only.
- Settings → Language data shows "Adds about X to this device · about Y to download", notes when
  the speech model is shared, and "Everything is on this device" when installed. Verified 3 states.
- `docs/architecture/supported-languages.md`: per-model on-device/download size table and install-cost table.

## 2026-09-25: Japanese language support (candidate)
- Spec asked for jpreprocess-WASM G2P feeding the existing Piper engine. Findings: no browser
  build of jpreprocess exists on npm; the official Piper JA voice (hi_fi_captain) needs Piper
  1.7's own OpenJTalk scheme and is CC BY-NC-SA. Used **piper-plus 0.7.0** (MIT): its Rust
  OpenJTalk/jpreprocess phonemizer compiled to WASM (NAIST-JDIC inside) + its VITS models, as a
  second engine in the same TTS worker.
- Registry: `LanguageVoice.engine` ('piper' | 'piper-plus'), `modelLanguage`; language `locale`
  + `writing` ('spaced' | 'unspaced'); JAPANESE entry (whisper-small q4 `japanese` — same
  weights as FR; voices CSS10 [default], Mera [Apache-2.0], Tsukuyomi-chan [corpus terms]),
  all `candidate`. `OFFERED_LANGUAGES` = LANGUAGES in dev / APPROVED in prod; picker, Settings,
  settings store, `getLanguage`/`requireLanguage` and the worker voice list use it.
- TTS: `adapters/tts/assets.ts` (one source for voice/G2P URLs, used by adapters and the
  language-data readiness check — it previously hard-coded the rhasspy base), `japaneseG2p.ts`
  (unpkg download → Cache API → SHA-256 check → init; jsDelivr 403s files this size),
  `vendor/piper-plus-wasm/` (glue patched so Vite never bundles the 60 MB .wasm),
  `PiperPlusAdapter.ts` (our cachedFetch/progress/ORT session; feeds lid, prosody_features,
  zero speaker_embedding width from `inputMetadata` + mask [1,1]; piper-plus padPhonemeIds /
  adjustScalesForShortInput / trimPaddingByDurations / trimEosRegion; throws if JA G2P missing).
- Transcript: `utils/words.ts` — Intl.Segmenter('ja') + re-join non-particle hiragana
  inflections (食べました); French regex byte-identical. Sentences split on 。！？; fitText counts
  CJK as double width.
- LLM: `adapters/llm/languageGuidance.ts` (Japanese evaluation rules, translation rules +
  contrastive example, CEFR→JLPT note), wired into prompt.ts and translationPrompt.ts (and
  therefore translate.ts).
- Verified: all 3 voices speak in Chromium, CSS10 in Firefox; TTS→Whisper(ja) round trip
  (smoke only, not scored); in-app: JA listed as candidate, 3 voices, download 120 s → ready
  after reload, Settings preview plays; Practice in JA; prompts render without placeholders;
  build has no 60 MB wasm; check 0/0. Harmless build warning from piper-plus's unused Chinese
  dictionary `new URL("../../assets/")`.
- Docs: `docs/architecture/supported-languages.md` (per-language stack, user request), `docs/architecture/languages.md`.

## 2026-09-25: attempt-card "ghost" corners
- Cause: the card (NeoCard `rounded` → 32px) sat in `.attempt-slot` (`rounded-[22px]`) whose
  `content-visibility: auto` clips painting to the slot box — the card's shadow was cut along the
  slot's 22px curve, giving a hard, differently-rounded shadow corner.
- Fix: one radius (`--attempt-radius`, 22px) for card, shadow, selection outline and focus ring
  (ring moved from the slot to the card). The slot keeps `content-visibility` but is padded by the
  shadow's reach (`--slot-pad` 16px / 24px ≥640px) with matching negative margins (1rem rhythm
  unchanged). Because containment makes the slot the card's offset parent, AttemptStream now
  reads sizes from `surfaceOf(slot)` and positions from `cardTop(slot)` (= slot.offsetTop +
  padding) — spacer, tall threshold, arrival, fallback conveyor, select/arrival scroll targets.
- Verified: corner crops light/dark (clean, concentric), Practice 1280/390 layout, 6-take session
  opens on the newest take and clicking take 2 lifts it to the top; check 0/0.

## 2026-09-25 (latest): download bar redesign; Zen restore resolved by the user
- User: clearing Zen's cache fixed the `.sqlite` restore "Unknown failure" (so it was the live
  profile's storage state, not the code).
- `LanguageDownloadBar.svelte`: was a frosted `.sheet` (page content showed through → "clipping"),
  neo's progress-bar margin glued the track to the title, heavy raised track shadow, uneven
  padding. Now an opaque `--card` panel (hairline, `--shadow-float`), 3-column grid (40px icon ·
  body · 36px cancel), body `gap: 8px`, and a 6px recessed `--well` track. NeoProgressBar's
  `class` lands on the INNER `.neo-progress`; the wrapper `.neo-progress-bar.neo-track` carries
  margin/border/shadow and needs a higher-specificity override. Verified light/dark/390px.

## 2026-09-25 (later): Zen "Unknown failure" hunt, startup permissions, sass warnings
- User's toast reads literally `Unknown failure` (a Gecko DOMException, not app/sqlite text).
  NOT reproduced: copied the user's real `fs/` (OPFS) from `~/.zen/wlpthvid.Default (release)/
  storage/default/http+++localhost+5173` into test profiles and restored in Playwright Firefox 155
  AND the real Zen 1.22.2b (driven via puppeteer-core + WebDriver BiDi, `--new-instance`,
  prefs via `extraPrefsFirefox`): normal, over existing data, persist granted mid-flow, tight
  quota (fixedLimit) granted/denied, two tabs (second tab gets NoModificationAllowedError) — all
  behave. Remaining difference is the live profile/session. Restore errors now name the failing
  step + DOMException name and `console.error` the full error (`RestoreError` in export.ts) —
  ask the user for that text.
- sqlite-wasm leaks one empty `.opfs-sahpool-sync-check-*` file in the OPFS root per start in
  Gecko (removeEntry refused); user had 850. The worker deletes them before installing the VFS.
- `PermissionsPrompt.svelte` (layout, after settings, not with LanguagePicker): at launch asks,
  in one click, for persistent storage (Firefox family only — Chromium decides silently) and the
  microphone (remembered in `localStorage onspot.permissions.microphone` because Firefox keeps
  reporting "prompt" for per-visit grants). Always closes after Allow; refusals → toast with how
  to fix. "Not now" = sessionStorage for this launch. Verified Firefox allow/deny + Chromium.
- vite.config: `css.preprocessorOptions.scss.silenceDeprecations: ['if-function']` (neo's sass).
- Verified: restores Firefox ×2 / Chrome ×2 OK, check 0/0, build OK with 0 deprecation lines.
- Harness notes: puppeteer+Zen can report a 0×0 window (clicks fail) — use Playwright Firefox for
  interaction tests; Zen runs are fine for programmatic flows.

## 2026-09-25: Firefox/Zen `.sqlite` restore — quota, rollback, clear errors
- **Cause (reproduced in headed Playwright Firefox 155):** Firefox short-writes OPFS once the
  site is at its storage quota; sqlite-wasm reports that as `Unknown write() failure.` /
  `SQLITE_IOERR`. Firefox's best-effort limit is per *site* (all `localhost` ports share it) and
  scales with free disk. The user's real browser is Zen (`~/.zen/wlpthvid.Default (release)`):
  localhost:5173 861 MB + localhost:5174 978 MB (stale model caches from the old port), `/home`
  98% full (9.8 GB free) → the localhost group is over its allowance. Chrome's quota differs.
- **Data-loss bug fixed:** `replaceDatabase` unlinked the current DB before writing the backup, so
  a failed write left an empty database. The worker now copies the current DB to memory first;
  on failure it writes it back (`rolledBack`), or, if that also fails, returns it and the page
  downloads `onspot-rescue-*.sqlite`. Errors cross the driver as `DatabaseImportError`
  (`types.ts`: `storage`, `rolledBack`, `rescue`).
- **Restore flow (`importSqliteBackup`):** calls `navigator.storage.persist()` inside the confirm
  click (Firefox only prompts on user activation; boot-time persist never prompted) without
  awaiting it (it settles only when the prompt is answered); pre-checks
  `quota - usage >= max(0, backup - current DB) + 1 MB`; if short and not persisted, toasts to
  allow persistent storage and waits up to 60s for the answer; otherwise `StorageFullError`
  (`utils/storage.ts`) explains the Firefox localhost allowance and what to free, "Nothing was
  changed". Error toasts last 15s.
- Verified (Firefox headed, `dom.quotaManager.temporaryStorage.fixedLimit` + storage prompt
  testing prefs): normal restore ×2 OK; tight quota + denied → clear message, marker session kept
  across reload; tight quota + granted (quota 11.7→58.6 MB) → restore OK; forced mid-write
  failure → rolledBack, data intact after reload. Chrome restore ×2 OK. check 0/0, build OK.
- User action still needed in Zen: allow persistent storage when asked during restore, and/or
  clear site data for localhost:5174; the disk is nearly full.

## 2026-09-25: accent border on selected buttons/toggles
- User rule: every selected button/toggle gets a primary (theme accent) border; selected rail key
  = accent icon + accent border; controls with their own selection colours are exempt.
- app.css: `[aria-pressed=true] | [aria-checked=true] | [aria-current=page] | .is-selected` on
  buttons/links/radios/neo buttons → `border-color: var(--primary) !important` (beats neo's
  `.neo-borderless`), and `.neo-tab.neo-active { --neo-tab-border-color: var(--primary) }`.
  Never keyed off `.neo-pressed` (also set transiently on every click). `.custom-selection` opts
  out: PaperSegmentedControl (Exam red/Casual teal) and the Feedback severity tabs.
- Hooks added: history Regex/Case `aria-pressed`, search-options toggle / feedback category
  filter / translate trigger (when a translation shows) `.is-selected`; AudioBar speed/loop
  toggles got a transparent border so the accent can show. Rail keys already had
  `aria-current="page"` + primary icon colour.
- Follow-up: inactive rail icons were `--on-control` (itself teal-tinted), so the accent on the
  current section didn't stand out. Inactive rail/phone-menu icons are now neutral
  `--muted-foreground` (hover `--foreground`); only the current section is `--primary`.
- Follow-up 2: right after clicking a rail key its icon showed neo's hover ink (darker, ~L 0.43)
  instead of the accent, while the pointer stayed on it. The active key now pins `color` and
  `--neo-btn-text-color`/`--neo-text-color-hover|active|hover-active` to `--primary` (and its
  children). Verified click/hover/leave in Chromium + Firefox, light + dark. Also: the dev server
  can miss writes in this synced folder — `touch` edited files if the browser shows old code.
- Verified light + dark: rail active, options toggle, Regex on / Case off, Settings active tab,
  translate trigger, segmented control unchanged; no page errors; check 0/0, build OK.

## 2026-09-24 (latest+1): Start speaking contrast, zero-delay interactions
- **Start speaking had white text on pale card stock** in light mode: the global raised-key rule
  in app.css (0,4,1) out-ranked the button's scoped gradient (0,4,0). Added the opt-out class
  `.solid-action` (excluded from the key rules); the record button uses it and
  `color: var(--primary-foreground)` (light text on deep teal in light, dark on bright teal in
  dark). The contrast scan missed it because the button only renders once local data is ready —
  test by `setSetting('sttMode'|'ttsMode','cloud')` in the throwaway profile.
- **Delays:** every neo element and pseudo-element has `transition-duration: 70ms !important;
  transition-delay: 0s !important` (tabs' slide keyframes 120ms). `$lib/neo`: `quickPop`
  (90ms in / 50ms out) in `quickTooltip`; `quickSelect` for NeoSelect; `quickCollapse` 120ms;
  `quickSubmenu` passed by PopMenu as `menuProps.tooltipProps` — NeoMenu hands its root tooltip
  settings to submenus, so click-only root settings had made submenus unopenable. Page switch is
  a 90ms fade in, no outro. Measured: menu open 78ms, close 106ms, submenu hover 69ms, select
  101ms, button/menu-item transitions 70ms. Contrast scan still clean; theme toggling still OK.

## 2026-09-24 (latest): theme switch crash + light-mode text contrast
- **Crash (reproduced):** toggling light→dark threw `Cannot read properties of undefined (reading
  'unregister')` in NeoThemeProvider and unmounted the app (soft block). Cause: neo 1.2.0's
  provider re-runs its setup `$effect.pre` when a prop changes; the cleanup `destroy()`s the
  theme (removes `neo-*` attrs, `ready=false`), so the provider unmounts all children mid-view-
  transition. Fix: the provider gets a constant `initialTheme` (resolved synchronously before
  first render) and `NeoThemeSync.svelte` (child of the provider) applies switches with
  `useNeoThemeContext().update({ theme })`. Verified 3× toggles in Chromium and Firefox, OS
  scheme light and dark: app stays mounted, attrs in sync, no page errors.
- **Contrast:** couldn't reproduce literal white text; measured with a WCAG scan (every visible
  text node vs its composited background, all pages + open menus/tooltip/toast/select) and fixed
  what was < 3:1: neo's light-mode secondary/hover/active text tokens mix toward white → mapped
  (light and `--neo-dark-*` slots) to `--muted-foreground`/`--foreground` and per-theme
  `--ink-hover/--ink-active` (darker on paper, lighter at night); disabled text 70%; light
  `--faint` #7f7669, light `--warn` #94600f, dark `--faint` #8a8276; locked Exam/Casual keeps
  legible text (scoped disabled-text token, inactive at 0.7 opacity). Result: 0 findings in both
  themes. Scanner: /tmp/opencode/pw/contrast.mjs `<theme> <os-scheme> <toggles>`.

## 2026-09-24 (later): neo components — speed, depth, distinct surfaces
- User: animations had "such a huge delay"; components should pop in/out more (stronger concave/
  convex); need their own shade/paper so they don't blend in; must be right in light and dark.
- **Delay root causes:** NeoTooltip waits 500ms rest + 100ms; neo transitions 0.3–1s; NeoCollapse
  300ms; and a 1.2.0 bug — NeoTooltip ignores the "click" open reason, so NeoMenu only opened via
  its 500ms hover. Fixes: `src/lib/neo.ts` presets (`quickTooltip`, `quickMenu`, `quickCollapse`)
  spread into usages; new `PopMenu.svelte` (NeoMenu that opens on click through the trigger's
  attached `toggle()` — setting `open` from outside desyncs NeoMenu's internal state and breaks
  outside-press/select closing); global neo `transition-duration: 110ms` (tabs 180ms) in app.css;
  AttemptCard disclosures and EQ state transitions shortened. Measured: tooltip 79ms, menu 53ms.
- **Depth:** `src/neo-depth.css` is GENERATED from neo's shadows.scss (top-left) with every rem
  offset × `--neo-depth` (1.7 light / 1.6 dark). Shadow colours are explicit warm tokens per theme
  (`--shade-dark/-light`, `--glass-shade-*`) mapped to both neo light and `--neo-dark-*` slots.
- **Surfaces:** raised keys (non-flat/tinted/glass buttons, raised inputs/selects) = `--key`
  card stock, lighter than paper, with a new `--paper-key` texture (third PaperTexture in the
  layout, fine fibre, blended multiply/screen); wells (inset buttons/inputs, sliders, tab tracks)
  = `--well`, darker; tab tracks forced inset, active tab = raised key (label lifted above neo's
  opaque slide layer); cards = frosted sheet colour + hairline; tooltips/dialogs/notifications =
  `--card`. Menu list-item content carries `.neo-button` and is excluded.
- Verified: check 0/0, build OK, screenshots all pages light/dark/phone, menu open/close paths
  (2nd click, outside, Escape, select + reopen, attempt/translate/session/phone menus), no errors.

## 2026-09-24: UI library switched from shadcn-svelte to @dvcol/neo-svelte
- User request: "remove the svelte-shadcn and instead fully use this [neo-svelte] and all of its
  components ... properly implement it throughout the app". Installed `@dvcol/neo-svelte@1.2.0`
  (latest npm; GitHub master is an unreleased 2.0 with cascade layers — its docs don't all apply)
  and `sass-embedded` (the theme provider imports `.scss?url`). Removed `src/lib/components/ui/`,
  `components.json`, `$lib/utils` `cn`/index, and deps `bits-ui`, `tailwind-variants`,
  `tw-animate-css`, `clsx`, `tailwind-merge`, `@internationalized/date`. Tailwind stays for layout.
- Foundation: `+layout.svelte` wraps the app in `NeoThemeProvider {theme} remember={false}
  reset={false}` (theme follows the app toggle). `app.css` has a neo token bridge on
  `html[neo-theme-root]` (neo colour/text/background tokens → app palette, both light and
  `--neo-dark-*` slots), `--neo-shadow-margin: 0`, and a `revert-layer` fix for neo's unlayered
  h1–h6 rules. Rail keys/new/theme are NeoButtons in NeoTooltips; phone menu is NeoMenu.
- Migrated in 4 parallel groups: Settings (+ settings/*, VoicePreview, new `SettingSelect.svelte`
  NeoSelect wrapper), Practice (+page, AttemptCard, PaperSegmentedControl → NeoTabs, props
  unchanged), FeedbackPanel/LanguageDownloadBar/RestoreDatabaseButton, History/Insights/Toasts
  (NeoNotificationStack; `toast()` API unchanged, `Toast.durationMs` added)/LanguagePicker
  (NeoDialog). Mapping: Button→NeoButton, Card/Item→NeoCard, Badge→NeoPill, Dropdown→NeoMenu,
  Collapsible→NeoCollapse (bound open), Tabs/ToggleGroup→NeoTabs, Toggle→NeoButton toggle,
  Separator→NeoDivider, Tooltip→NeoTooltip, Progress→NeoProgressBar, Input→NeoInput,
  key InputGroup→NeoPassword, Select→NeoSelect, Slider→NeoRange, AlertDialog→NeoDialog+NeoButtons.
- Visible change: the voice EQ faders are now horizontal NeoRange rows (NeoRange has no vertical
  mode; rotating it breaks drag maths). Response graph kept.
- Verified: `npm run check` 0/0, `npm run build` OK, Playwright on the running :5173 with the
  user's Sep 23 backup imported: Practice/History/Insights/Settings at 1280 light/dark and
  390 phone, no console/page errors; per-group interaction tests (selects, tabs, EQ keyboard/
  click/dblclick reset, dialogs open/cancel/Escape, restore invalid-file toast, feedback filter,
  history search/sort persistence, toasts). Not verified: LanguageDownloadBar visuals (would start
  the 363 MB download), LanguagePicker (only shown with no language), Tauri.
- Noticed, not caused by this change: a reopened session whose prompt record is missing shows an
  empty "Your prompt" (`practice.ts` ~761).

## 2026-09-24: SQLite import (restore the .sqlite backup)
- User complaint: the app exports a `.sqlite` database but only imports legacy `.json`; the native
  format must be importable too. Added `importSqliteFile()` to `IDatabaseAdapter` and both
  adapters, plus `importSqliteBackup()` in `utils/export.ts` (SQLite-header check, then
  `initSettings()` + `hydrateLatestSession()`).
- Web: the SQLite worker now keeps the SAH pool, closes the open `OpfsSAHPoolDb`, imports the
  file with `pool.importDb('/onspot.db', bytes)` and reopens it; `init()` then migrates the
  restored schema. Desktop: `TauriSqlAdapter` closes the sqlx pool, overwrites
  `$APPCONFIG/onspot.db` via the fs plugin, removes stale `-journal`/`-wal`/`-shm` sidecars and
  reopens. Capability gained scoped `fs:allow-write-file`/`fs:allow-remove` entries for those
  paths.
- UI: new `RestoreDatabaseButton.svelte` (file input + AlertDialog confirm, since the import
  replaces rather than merges). Wired into Settings → Storage row **Restore database** and both
  buttons in History's empty state. The legacy `.json` restore stays as the merge path, and its
  wrong-format error now points at Restore database.
- Verified with Playwright reuse of the running `:5173` dev server (throwaway profiles, app's own
  modules imported for seeding): 17/17 — seed → export (file checked with sqlite3) → replace local
  rows → import via the UI → data/settings restored, reload-safe, invalid file rejected with the
  database untouched; plus 7/7 — History empty-state buttons, cancel, and write-after-import.
  `npm run check` 0/0, `npm run build` OK, `cargo check` OK. Not runtime-tested: the Tauri import
  path (same standing gap as the Tauri export).
- Trap for future tests: on the app origin the File System Access pickers exist, and
  `browser-fs-access` decides its modern-vs-legacy path from `'showOpenFilePicker' in self` — a
  Playwright download fallback needs that property removed too (simpler: take export bytes from
  the adapter, as this test does).
- **User-reported trap (Firefox): the confirm dialog never went away.** bits-ui 2.19's
  `AlertDialog.Action` does not close the dialog (documented; only `Cancel` closes). On a failed
  import nothing navigated, so the modal stayed and blocked the app. `RestoreDatabaseButton` now
  closes `confirmOpen` explicitly at the start of `restore()`; the same fix was applied to
  VoicePreview's regenerate dialog (the Practice delete dialog already closed explicitly).
  Re-verified in Playwright **Firefox 155** with the user's real
  `~/Downloads/onspot-backup-2026-09-23.sqlite`: 7/7 (dialog closes on success and failure,
  5 sessions restore, failed import leaves data intact), plus Chromium 19/19 and 8/8.
- **Follow-up (2026-09-24): web restore failed with `Unknown write() failure.`** for the user
  (actually Zen Browser, a Firefox fork). That string is sqlite-wasm's xWrite short-write guard;
  it came from the raw-image `SAH.pool.importDb()` write path. Web import was reworked to
  `sqlite3_deserialize` (main becomes the backup in memory) + `VACUUM INTO '/onspot.db'` +
  reopen — only ordinary VFS writes, no large raw write. Verified in Playwright Firefox:
  real backup parity (5|11|14|14|16|14, `integrity_check` ok, no orphans) and a hand-built v5
  database imports and migrates to v6 (`prompts.language` backfilled to `fr`). The user's live
  Zen OPFS database was inspected while diagnosing: 14.8MB, healthy, 5 sessions / 71 audio assets;
  their Sep 23 backup is 2.2MB. Keep Playwright Firefox installed at `/tmp/opencode/pw`.

## 2026-09-20: critical refresh data rehydration
- **Recovery executed:** `/home/khizar/Downloads/onspot-export-2026-09-18.json` was merged into
  the real Google Chrome `Default` profile for `http://localhost:5173`. Verified 5 History cards,
  Practice reopening “Favorite city” with 2 takes, and the same state after reload/relaunch; no
  page errors. The source backup remains unchanged.
- The SQLite/OPFS database was retaining rows, but `initPractice()` only seeded prompts; every
  newly loaded JavaScript context therefore presented an empty Practice store until a session was
  explicitly opened from History. Boot now opens the newest saved session and hydrates all of its
  attempts/corrections. Initialization is single-flight and resets after a transient failure.
- Removed the `pagehide` worker termination added earlier: it could kill an in-flight write and
  broke a bfcache-restored page by leaving the singleton adapter pointed at a dead worker. Browser
  teardown releases its worker/OPFS handles itself.
- Vite dev is pinned to strict `localhost:5173`; it now fails rather than silently starting on a
  fresh-origin `:5174` database. History catches DB errors, offers Retry, and distinguishes an
  actually empty device store from a load failure. Its empty state has a direct `.json` restore
  picker; both it and Settings immediately hydrate Practice after importing.
- Browser proof with the recovered backup: Practice restored “Favorite city” and its two takes
  on first load, browser reload, and full Chromium restart; History retained all five sessions;
  no page errors. `npm run check` is 0/0 and the production build succeeds.

## 2026-09-20: persistence recovery, language default, reusable paper control
- **Persistence:** A real same-profile OPFS restart retains data. The failure mode is switching
  browser profile/origin/runtime, plus a possible rapid-reload access-handle race. The DB factory
  now requests durable browser storage, releases its worker on `pagehide`, retries web startup
  failures up to three times, and clears a failed singleton promise for the next action.
- **Recovery:** Settings → Storage now offers a non-destructive *Restore .json* for legacy
  format-1 exports; it merges sessions/prompts/attempts/corrections/recordings/settings and opens
  History. Browser regression restored the saved 5-session / 11-take backup; History still held
  5 cards after a reload and a complete browser relaunch, with no page errors. Raw `.sqlite`
  import is still a separate open task.
- **Startup:** Settings falls back to `DEFAULT_LANGUAGE_ID` (French) for fresh, corrupt and legacy
  no-language data. The app no longer displays the first-run picker or a permanent “Checking
  language data…” state when French is the only approved language.
- **Control:** `PaperSegmentedControl.svelte` replaces the Practice mode switch and is reusable.
  Its Tab utilities cannot override the control's radii: default parent 14px / convex child 10px;
  sm 11px / 8px; lg 16px / 12px. The key slides with a 160ms ease-out (no spring, scale or press
  bounce). Its texture uses `background-attachment: scroll`, not `fixed`, preventing a texture
  snap. Exam's red / Casual's teal tint and centred all-sides glow belong to the selected raised
  key; the board folds inward around it and light mode has no white top-left highlight.
- The existing data-isolated dummy UI route is now explicitly reachable from Settings → Storage →
  **Open UI sandbox**.

## 2026-09-20: mobile navigation disclosure
- Phone layout (<=640px) no longer converts the desktop rail into a 60px bottom bar. The rail is
  `display:none`; the app grid has one full-height main row. A fixed 44px hamburger in existing
  top chrome opens a shadcn menu for New session, Practice, History, Insights, Settings and theme.
  It is an overlay, not a grid participant. Practice's header is 52px and reserves only horizontal
  room for it. Verified at 390×844: main height is 844px, rail is hidden, the menu is fixed and
  there are no page errors. The bottom Feedback summary remains app content, not a navbar.

## 2026-09-20: paper-switch and feedback disclosure cleanup
- PaperTexture retains the already painted sheet until its replacement is ready and prewarms the
  light and dark page/rail variants at the current size. The deliberate 800ms idle delay and URL
  reset on an appearance change were removed, eliminating the untextured light/dark switch flash.
- On phones, a closed Feedback panel is a 36px handle instead of the previous 58px row.
- Feedback, correction rows, and Session stats are each one disclosure target. The chevron is now
  inside its corresponding target—not a second button—and their inherited hover-surface animation
  is disabled. `npm run check` reports 0 errors and 0 warnings after these changes.

## 2026-09-20: missing session-data diagnosis
- The web app has no shared backend or sync layer yet: `OpfsSqliteAdapter` opens a browser-profile
  and exact-origin-local OPFS database (`onspot-pool` / `/onspot.db`). A different browser profile,
  host, port, or cleared site storage is therefore a fresh empty database; History correctly shows
  “No sessions yet”.
- The active `http://localhost:5173` build was checked in a fresh Chromium profile: OPFS initializes,
  no database/runtime errors occur, and the empty History state is expected for that new origin.
- A recoverable legacy JSON backup exists at `/home/khizar/Downloads/onspot-export-2026-09-18.json`:
  5 sessions, 11 attempts and 14 corrections. The product currently exports SQLite only and has no
  import/restore UI, so it cannot load that backup automatically. Phase 3 sync and SQLite import
  remain open tasks.

## 2026-09-19 (final): frosted sheets, page laid on the rail
- Sheets are frosted (translucent + backdrop blur) instead of textured; the sheet texture render
  was removed. The stitched binding was rejected by the user; the page is now a rounded sheet
  overlapping the rail with a soft edge shadow (bottom corners on phones). Phone header hides the
  redundant mode label. Verified 9/9, 18/18, 14/14.

## 2026-09-19 (latest): sheets, rail wells, stitched binding, Insights
- Cards are now `.sheet`s (smooth writing-paper texture rendered by Paper Shaders and published
  as `--paper-sheet`, hairline edge, layered shadow): shadcn Card base, History, Feedback
  corrections, Insights, composer (opaque now), language picker, download bar.
- Rail: keys in debossed wells, current page raised teal key; stitched binding + gutter shadow
  between rail and page (top edge on phones); old active indicator bar removed.
- Insights: sheet stat/pattern cards, shared heading style, count chips + chevrons.
- Feedback tab dots removed. Verified 14/14, 18/18, 9/9; Settings suite 33/37 (4 obsolete
  neumorphic-History assertions).

## 2026-09-19 (later): compact Practice + adaptive transcript
- Transcript font 24px → 15px floor by length (short 24, ~530 chars 18, 3-min take 15 and grows).
- Chips instead of rows for alternatives/breakdown; tighter card padding; 32px header buttons.
- Feedback: neumorphic severity channel with sliding knob, content-sized tabs, filter key beside
  it, playback moved to the header. Verified 18/18 + 14/14 (+ History 9/9 earlier).

## 2026-09-19: History by day + sort; feedback tab overflow
- History: day groups, sort by date (newest/oldest, remembered), sheet cards instead of
  paper-on-paper neumorphism (visual distinction + no fixed-background scroll glitches).
- Feedback panel: "Suggestions" overflowed its tab at the 330px minimum width; tabs now span the
  row and the category filter lives with the summary action icons. Verified 9/9 History checks,
  14/14 Practice/Settings checks.

## 2026-09-18 (round 4): colour hierarchy + crumpled paper
- New palette and hierarchy (see rules/style.md): warm paper / kraft rail / warm-white sheets /
  sea-glass controls / teal selected / brick-ochre-moss semantics; dark mode is warm charcoal.
  shadcn Button (outline/secondary/ghost) and Toggle variants now use the control/selected
  tokens; rail keys, segment tracks, feedback tab track, mode switch use them too.
- Texture re-tuned to gently crumpled paper (crumples + wrinkles, grain/fibre ~0.1, no drops,
  no laid rows). Verified 37/37 + 14/14.

## 2026-09-18 (round 3): paper, not plastic
- User: convex keys on the paper looked gimmicky; wanted the pressed depth *in paper*, and the
  Practice header textured. Page texture now published as `--paper-page`; `.paper-surface` cuts
  surfaces from the same sheet. Header, conveyor lip, composer fade, History cards, mode knob and
  rail keys are paper; relief is emboss/deboss shadows only. Verified 14/14 + 37/37.

## 2026-09-18 (round 2): shadcn, live EQ, SQLite export, paper + neumorphism
- EQ is 4 bands (Body 500 Hz added) + separate Volume, on shadcn `Slider`; curve from Web Audio
  `getFrequencyResponse`. Settings rebuilt on shadcn Card/Field/InputGroup/ToggleGroup/Item/Toggle.
- Voice preview tunes **live**: raw clip once, shared processing chain, no regeneration per tweak.
- Export writes the whole database as `.sqlite` (recordings + every cached TTS clip).
- History: neumorphic session cards; Regex/Case options folded behind a toggle by the search box.
- Practice: neumorphic Exam/Casual switch; feedback sidebar content now fills its column.
- Paper Shaders paper texture behind the app and in the rail (rendered once, cached as WebP);
  rail buttons are neumorphic analogue keys.
- Verified: `npm run check` 0/0, `npm run build` OK, `cargo check` OK; Playwright 37/37 +
  12/12, export contents verified in a fresh browser; read-back DSP bit-identical to before.
  Not runtime-tested: the Tauri export path. I accidentally broke the user's running dev server's
  dep cache by starting a second `vite dev`; fixed by touching `vite.config.ts` (see commands.md).

## 2026-09-18: Settings redesign from the prototype
- Implemented the good parts of `prototype/to-be-implemented/Settings.html` without copying it:
  titled cards per section, label-left/control-right rows with dividers, info boxes, a sliding
  segmented General/Advanced control, a key input with show/hide, a Voice & audio card that
  holds engine, voice, the Equalizer and the preview (Play + Loop), and a Storage card.
- The graphical EQ plots the real filter response (not a decorative spline): faders sit at
  200 Hz / 1.2 kHz / 3.2 kHz on a log axis, Volume is a separate output fader.
- Added: Transcription asks for a Groq key when cloud STT is used with a non-Groq LLM provider
  (previously there was no way to enter it); "Replay to hear changes" badge when the preview is
  still playing audio made before a tuning change; model select widened so labels don't truncate.
- Verified: `npm run check` 0/0; headless Chromium 24/24 (section order, 4 faders, arrow keys,
  pointer drag, double-click zero, curve crest meets the Presence thumb, persistence across
  reload, General hides/nudges/Adjust re-opens, reset, key reveal, cloud STT key logic, cloud TTS
  note, Loop on/off, no overflow and no label overlap at 390px, no console errors). Light, dark and
  390px screenshots reviewed. Audio generation with a tuned voice was not re-run this session
  (DSP path unchanged).

## 2026-09-18: Advanced default + page export tooling
- Settings opens with **Advanced** selected (`showAdvanced = $state(true)`); no scroll-into-view
  on load, and bits-ui skips the Collapsible's mount animation when it starts open.
- New `npm run bundle` (`repomix/bundle.mjs`) exports any page, several pages, or any
  folder/file/glob with repomix, tracing local imports. See commands.md for flags. The app shell
  (`+layout`) is opt-in (`--layout`) since it drags the practice store and every adapter into
  every page. `bundle:ui` is unchanged.
- Verified: dry runs for every page, `--depth 0/1`, globs, folders, bad target and bad flag
  errors; real repomix runs wrote `repomix/settings-bundle.xml` (103 files, 79k tokens) and
  `settings+history-bundle.md`; both are gitignored (test outputs deleted). `npm run check`: 0/0.
  The Advanced default was not browser-tested (one-line state change).

## Outcome
Added the multilingual foundation the product needs to grow beyond French, delivered the first-run
language choice and the manual, cancellable language-data download, applied per-voice TTS cleanup,
and ran the requested visual cleanup across Practice, feedback, and navigation.

## Follow-up: translation surface colour
- Translation panels (idiomatic/literal/word-for-word, alternatives, word breakdown) were using
  the neutral `--surface-2`, nearly the page background. They now use a soft brand tint with a
  brand ring, verified in light and dark; the tall-card suite's surfaces check now filters
  visible panels because the collapsed word-breakdown shares the class.

## Follow-up: advanced audio controls
- Settings now has an in-page General/Advanced segmented toggle. Advanced reveals a Voice audio
  section in the same flow (Collapsible + scroll-into-view); general sections stay visible and
  active while it is hidden.
- Per selected voice: Volume, Bass (200 Hz), Presence (1.2 kHz) and Treble (3.2 kHz) sliders in
  ±12 dB steps, plus Reset to approved sound. Values persist per voice id in the DB and layer on
  top of the approved processing profile.
- `synthesizeSpeech` includes the tuning in the cache key, so tuning changes generate new audio
  and returning to the default reuses the already-cached audio. The preview store's selection key
  includes the tuning too (a stale-replay bug the browser test caught).
- Browser-verified (`verify-advanced-audio.mjs`, 26/26): toggle behavior, hidden values persist,
  reset, cold neutral generation (~49s), tuned regeneration (~5s), neutral cache reuse (instant).
  The language-ui (28/28) and tall-card (13/13) suites still pass.

## Follow-up: Settings voice preview
- Added a Voice preview card in Settings → Speech for whichever mode/voice is selected, reading
  the language's `preview` sentence. First play generates and caches; replay is served from the
  DB cache and reuses the live blob URL; Regenerate sits behind a confirm dialog.
- Browser-verified end to end (`verify-tts-preview.mjs`, 15/15): cold generation 45s / 8.9s of
  audio with no console errors, replay in ~0.7s without regeneration, "Cached" after a page
  reload in 1s, cancel keeps the cache, confirmed regenerate bypasses it (15s with the voice
  already resident).

## Follow-up: long takes and depth
- Compare-all translations now stack vertically at full card width (the product speaks for 60s–5min;
  vertical space is the axis it has).
- Cards taller than `max(480px, 75% viewport)` are automatically kept flat — the scroll-driven exit
  conveyor no longer rotates a long card away while the learner is reading inside it. Every slot is
  resize-observed and only the card that changed size is re-evaluated; the rAF fallback skips tall
  slots too. (Svelte prunes a runtime-added `.tall` selector unless it is `:global(.tall)`.)
- Card depth: light page `#f1efe9` / dark page `#0b0b0d` against white / `#19191d` cards, with
  explicit borders and stronger `--shadow-card`; correction cards use `bg-card` + border +
  `shadow-sm`.
- The panel's visible title is now **Feedback** (previously "Coach notes").
- New headless suite `verify-tall-cards.mjs`: 13/13 (vertical stacking, tall class, no animation,
  flat after 900px scroll, luminance separation, border, Feedback label, no errors). The earlier
  `verify-language-ui.mjs` still passes 28/28.

## Language system
- New `src/lib/languages/index.ts` is the source of truth: each `LanguageDefinition` carries an
  approved STT model, approved Piper voices (with per-voice processing profiles and approval
  records), seed prompts, and evidence links. Only approved languages reach the picker and worker.
- `LanguagePicker.svelte` appears on first run (gated on `settingsReady` to avoid a flash). The
  saved value is the language id; legacy `'French'` values are normalised on load.
- `stores/languageData.ts` checks the per-origin caches, then `downloadLanguageData()` sequences
  Whisper weights and the selected voice into one weighted 0–100 figure. Cancel terminates the
  model workers; the next attempt recreates them.
- `LanguageDownloadBar.svelte` is layout-level, so progress and Cancel survive route changes.
  Settings → Language has the target-language select and the Download/Cancel/status card.
- Practice shows the required gate before the first session and links to
  Settings → Language data; cloud-only setups skip the gate.
- TTS output runs through a declarative EQ/compressor/limiter/normalizer (`utils/audioEffects.ts`).
  Piper Tom has the listening-test correction; the other voices stay raw.
- Prompts, STT language/model, TTS voice set, and LLM evaluation/translation prompts are all
  parameterized by the selected language. DB migration v6 adds `prompts.language` and backfills
  legacy rows as French.
- `docs/architecture/languages.md` documents the approval rule and the add-a-language recipe.

## Bug fixes and visual cleanup
- **Tabs looked unselected because bits-ui emits `data-state`, not `data-active`.** Feedback
  severity tabs and the Practice Exam/Casual switch now tint their selected state correctly
  (All neutral pill, Errors red, Warnings amber, Suggestions teal, Exam red, Casual teal).
- Feedback tabs are four equal columns with full labels (no more “Suggesti…”).
- Correction rows are bordered cards; the expanded explanation has an internal separator.
- Session stats are a closed-by-default Collapsible (36px collapsed) that expands to four cells.
- Attempt header is a single row: meta left, actions right.
- Translation shows no variant label when a single view is selected.
- Practice composer has zero outer bottom padding and is flush with the window bottom.
- Rail is 56px; purple is gone (`--brand-2/3` are cyan/sky); all Sparkles/`✨` icons removed.
- Groq's curated model list matches the 2026-09-14 probe (GPT-OSS, Compound, Qwen) and Settings
  auto-refreshes `GET /models` when a key is present.
- Coach notes keeps its name.

## Verification
- `npm run check`: 0 errors, 0 warnings.
- `npm run build`: successful static production build.
- Headless Chromium (`/tmp/opencode/pw/verify-language-ui.mjs`, 28/28 checks): picker on first
  run, Continue, practice gate, Settings language select + Download + Cancel restore, 56px rail,
  single-row card header, collapsed stats hidden + expandable, equal tab widths, distinct selected
  tab colour, untruncated Suggestions, bordered correction cards with internal separators, no
  single-view translation label, distinct mode colours, zero composer bottom padding, no runtime
  or console errors. Dark-theme screenshots also checked.

## Next work
- Phase 3 BYOC sync remains the next feature phase.
- A real cold-cache download + local practice run (Whisper + Piper + LLM) still needs doing.
- The next language needs its own human quality pass before it can be added to the registry.
