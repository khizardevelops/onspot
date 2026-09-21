# Last Session

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
- `docs/languages.md` documents the approval rule and the add-a-language recipe.

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
