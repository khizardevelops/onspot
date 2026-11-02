# State

## Current State

**120 fps pass on the phone (2026-11-02, committed 37d2c0d; user: "no less than 120 fps … the whole app,
on all platforms"):** measured on the user's Galaxy S24 FE (Android 17, 120 Hz) with a debuggable
build (`scripts/android.sh build --apk --debug --target aarch64`, installs as
`app.onspot.desktop.debug`), Playwright `connectOverCDP` through `adb forward tcp:9333
localabstract:webview_devtools_remote_<pid>`, real touch via `adb shell input swipe`, and traces
counting `Display::DrawAndSwap` (frames shown), `RasterTask` and `Paint`. Takes for it: a backup
exported from the :5173 test profile (`long-takes.sqlite`) restored through Settings → Data
(DataTransfer into the hidden file input). Scripts: session scratchpad `device/` (audit.mjs,
experiment.mjs, inject.mjs, restore.mjs, cdp.mjs). Causes found and fixed:
- Inline SVG `feTurbulence` backgrounds re-rendered on every frame their surface moved (sheet drag
  33–37 fps, 1,400 raster tasks per drag). The two all-over grains (Feedback panel `--grain`,
  timeline paper) measured under 1 grey level on their papers and were dropped; the tape and
  bookmark textures are WebP tiles now (`src/lib/textures/`, rendered by `scripts/textures.sh` from
  their SVG sources with resvg, 2x). No `data:image/svg+xml` noise is left in `src/`.
- `background-attachment: fixed` (`.paper-surface` on main/AppHeader/WindowBar, neo keys and wells,
  `.paper-grain`) repainted the page on every scroll frame (Settings 500+ raster tasks per fling).
  Paper surfaces are transparent now (the layout's fixed `.paper-page` shows through); keys and
  wells draw `--paper-key` at `--paper-key-size: 100vw 100vh`, attached normally.
- The phone shade fades with swipes: `will-change: opacity`. The phone Feedback sheet stays laid out
  below the screen when closed (`translate: 0 calc(100% + 24px)`, `will-change: translate`), slid
  by a transition; from `display: none` its first frame stalled 70–110 ms.
- `will-change: translate` (what SheetMover sets) measured best: 120 fps, 24 ms GPU per drag.
Results (before → after the textures; sheet/bg-fixed changes measured by injection): sheet slow drag
37 → 119 fps, swipe dismiss 69 → 120, pull-up 62 → 116–119, Settings fling 111 (6 missed) → 120
(0 missed, 0 repaints), takes and Feedback list ~120 before and after. Menu opening was 83–93 fps
(neo keys and the bar repainting under it); the neo-snappy merge below and the bar's transparency
address it; not re-measured on the phone yet (phone disconnected; final debug build pending).
Desktop engines (WebView2, WebKitGTK, WKWebView) not measured; the causes are engine-independent.
Merged build on the phone: takes slow scroll, Feedback list, sheet drag/dismiss, timeline swipe,
Settings scroll all 119–120 fps with 0–2 late frames; pull-up 115–118. Remaining "gaps" were idle,
not work (no thread busy): the menu's first frame after a tap (~22 ms, then steady 7–8 ms frames),
and the "takes fling", which scrolls inside the long card (`.stack-card-body`, not the stage): scroll
events every ~8 ms in steady 17–22 px steps until the card's end, then Android's edge stretch, where
the 35/75 ms present gaps are (nothing scrolls). Separately, `AttemptStream` now settles the stack
on `scrollend` where the engine reports it (Chromium, Android WebView, WebView2), its 120 ms
no-scroll timer only as a fallback; checked on :5173 (a 200 px nudge was gliding by 120 ms, locked
on a card by ~290 ms). The audit's "missed" count includes idle gaps: read them with `gaps.py` or
`fling-log.mjs` (session scratchpad `device/`) before calling them jank. The display is adaptive
(60 Hz idle, 120 Hz in motion); 120 Hz is the ceiling on this phone.

**Merged from helper worktrees (2026-11-02, committed 37d2c0d):** `textsize-v2` (2476ca3: Settings → Text
size is a live preview card, real AttemptCard with a `preview` prop, sizes per layout × take length,
store `onspot.text-size.v2` migrating the old key; 41 checks) and `neo-snappy` (4af1e6e: neo
transitions limited to opacity/transforms, motion tokens in app.css and neo.ts, instant press under a
finger via `gestures/pressFeedback.ts`, no sticky hover/focus look on touch, so the bar's Feedback key
no longer looks pressed after its sheet is swiped away; dialogs 300 → 160 ms). Merged with `git
merge-file` per file (base ddafa30); worktrees and branches removed.

**Text size live preview (2026-11-02, committed 37d2c0d; helper branch `textsize-canvas` 835bd77,
merged with `git merge-file` per file onto the main tree; user: "a dummy canvas which is an exact
replica as if the user is doing a session … i dont like … all the cards … in a tight box"):**
Settings → Text size is one line, "Open live preview", the sizes not at 100% and two resets. The
preview (`/settings/text-size/`) is the real Practice screen: Practice's body is now
`components/PracticeScreen.svelte` (`routes/+page.svelte` only renders it) taking a session through
`stores/practiceSession.ts` (the learner's, or `textSize/sampleSession.ts` with `live: false`, which
turns off recording, playback, providers and the database); AttemptStream, AttemptCard and
FeedbackPanel read it from context; AppHeader has `preview`. Tap a part → ring + floating control
(`textSize/TextSizeEditor.svelte`: part menu, A− % A+, reset, Done), per layout × take length, live
and app-wide; Done/Back/Escape behave. Helper's checks 122/122 on its server (layout matched a real
seeded Practice page to the pixel; DB counts unchanged). The bookmark textures' relative paths were
corrected for the move. Not on a phone yet.

**Insights rows ran off the right edge on phones (user, on the debug copy):** the pattern columns'
grid had no column definition below `sm`, so its one implicit `auto` column grew to the longest
one-line (`truncate`) pattern title (414 px in a 384 px window on the long test takes), pushing every
row's count and chevron and the section header off screen. `grid-cols-1` (minmax(0, 1fr)) fixes it;
checked at 360/390/700/1280 px on :5173 (no element past the edge, titles truncate) and on the phone
by injecting the same rule. Existing bug, shown by longer titles; the user's release data is short.

**Selects (user: language of instruction list "too big … clips … under some component"):**
`quickSelect` (neo.ts) renders the list as a portal with `height: { max: 'min(320px, 50dvh)' }`
(neo's own prop; a floating-ui size middleware was overridden by neo's inline max-height), and
`SettingSelect` closes the list on a pick (neo kept it open while focus was on the option) and
returns focus to the field. Checked at 390 and 1280 px: 320 px, scrolls, on top, closes on pick.

**Word meanings shifted by one (user: "à : university", "suis : in"):** meanings were a plain list
matched by position; one word skipped by the model moved every later meaning. The prompt asks for
`{"glosses": {"1": …}}` and `alignedGlosses` places them by number (a list only if its length is
exact). Saved meanings move to a new key (`glossKey` prefix `numbered:`), so old, possibly shifted
ones are fetched again. Real Groq calls (gpt-oss-120b and 20b) on two takes: every word aligned.

**APK icon cause (2026-11-02):** the phone uses a Samsung Theme Park icon theme
(`current_sec_appicon_theme_package=com.samsung.android.themedesigner_2026-10-08…`), which drew and
kept its own icon for `app.onspot.desktop` from the first install (Tauri's default icon). Settings →
App info shows it too; new versionCodes and reinstalls don't change it. The APK is right (every
density checked). Fix is on the device (re-apply/refresh the icon theme or switch icons to
default); not changed without the user.

**Phone bar, pull-up, stats pin, smooth sheet drag, one speed button, text sizes, pop-up under
covers (2026-11-02, committed 37d2c0d; the user's list after 0.2.2):**
- Phone bar in two rows (`AppHeader`: with `below`, the navigation menu starts the second row, so
  row 1 is the heading alone). Practice: the prompt full width on top; menu, New prompt, Takes,
  Feedback, Session and the main action (`mainAction` snippet; record/stop/setup/cancel) last.
  Desktop unchanged (`desktopActions`).
- Swipe up on the bar pulls Feedback up with the finger (`gestures/swipeToOpen.ts`, mirror of
  SwipeToDismiss; `onPullStart` sets `coachOpen` + `flushSync()` so the sheet is measured and
  placed at `100%` before it paints; `.pulled-open` turns off the sheet's rise and the scrim's
  fade-in). Starting on a button does not press it; sideways does nothing.
- Slow-drag flicker: the sheet waited 10 px then jumped (now moves from where the drag began);
  the browser's own scroll threshold (~8 px) beat ours (10 px), so a slow drag scrolled/stretched
  the list too (now every move heading out is cancelled from the first one, and the sheet's list
  has `overscroll-behavior: none` below 1024 px); every move repainted the textured sheet (now
  `will-change: translate` while moving, placed once per frame). Shared by both swipes in
  `gestures/sheetMotion.ts` (`SheetMover`, settle constants). Headless can't show the device's
  rendering; not yet checked on a phone.
- Session stats: a tap elsewhere in the panel puts them away (`onclickcapture`; on the cards it
  only does that, toolbar controls still act). Pin button in the stats header
  (`stores/statsPin.svelte.ts`, localStorage `onspot.feedback.statsPinned`): pinned = docked under
  the list (position relative), open from the start, kept open by taps elsewhere.
- Playback speed (by a parallel agent): `PlaybackSpeed.svelte`, one button showing the speed with
  three ticks; tap cycles 0.75 → 1 → 1.25, arrows/wheel step without wrapping, number rolls.
- Text size per section (parallel agent): Settings → Learning → Text size
  (`settings/TextSizeSettings.svelte`, `stores/textSize.svelte.ts`, localStorage
  `onspot.text-size`, per device like the theme): Prompt, You said, Did you mean to say?,
  Explanation, Translation, Feedback; 85–160 %; `--text-scale-<id>` on :root, used as
  `calc(size * var(--text-scale-x, 1))`; AttemptCard's peek heights read `textScaleOf`.
- Word pop-up stayed over a buried card (parallel agent): it was a held selection's label;
  floating-ui `hide` only sees clipping, and a buried card is covered, not clipped. `WordGloss`
  now hides while `elementFromPoint` at the anchor's first line is not the anchor (inert pile
  cards never hit) and places again in the next frame (the stack poses cards a frame after the
  scroll). Selection anchors carry their line boxes (`rangeAnchor`).
- Verified on :5173 with everything merged (CDP touch at 390 px, desktop 1280 px, light/dark):
  bar/pull-up/drag/stats 32/32, the earlier gesture suite 34/34, speed button 36/36, text size
  25/25, pop-up repro 25/25 and selection behaviours 11/11; `bun run check` 0 errors; SPDX ok.
  Test gotcha: on the user's long-running :5173 server, hot-reloaded modules carry `?t=` URLs, so
  a script's `import('/src/lib/…')` gets a second, empty instance (empty stores; a second DB that
  reports "already open in another tab"); import the URL from
  `performance.getEntriesByType('resource')` instead.
- Noticed, unchanged: on phones a tap on the faded last line of a folded "You said" excerpt does
  not put a held selection away (same before).

**Release v0.2.2 (2026-11-02):** `93518c8 Release 0.2.2`; `main` fast-forwarded to it and both
branches pushed with the tag. A test run on the feature branch first (Desktop release 41363245612,
all 9 jobs; Android 41363248479) and its Windows artifacts checked: the setup.exe's NSIS
header/sidebar BMPs, the MSI's WiX banner/dialog and product icon are byte-identical to the repo's,
the exe's 256 px icon is icon.ico's. Then Desktop release 41383490174, Android (tag 41383490173,
main 41383490333) and Pages 41383490350 all green; the release has all 15 files (x64 + arm64 exe/
msi, x64/aarch64 dmg, amd64/arm64 deb, x86_64/aarch64 rpm, AppImage, flatpak, and
`onspot-0.2.2-93518c8-arm64.apk`, versionCode 10017).
**APK icon (user, after installing: "still doesn't have the app icon"):** the released APK is right:
aapt2 shows `mipmap-anydpi-v26/ic_launcher.xml` = background `#151412`, foreground and monochrome
mipmaps, and their PNGs are pixel-identical to the repo's (legacy ic_launcher too). Not seen on the
device (no adb connection). Likely device-side: Android 13+ themed icons on (the launcher then
draws the monochrome mark tinted, new in 0.2.2), a launcher icon cache, or an older debug build
(`app.onspot.desktop.debug`, Tauri's default icon) beside the release app. Waiting on a screenshot.
**Branches:** `feature/language-delivery-mode` = `main` (93518c8); the four older local branches
(`feature/byoc-sync`, `feature/native-speech`, `migration`, `spike/whisper-webgpu`) are all
contained in main. Offered to delete them all (and the remote feature branch); not yet answered.

**Installers branded (2026-11-02, committed a1900cf, released in 0.2.2; user: "make sure all of
these installers use the app icon and brand assets"):** v0.2.1's setup .exe still had NSIS's own icon and blue sidebar, the
MSI WiX's stock images, the DMG a plain window, the .deb/.rpm/AppImage menu entry the old
"Learn to speak French… desktop-first" comment (Cargo description), and the Flatpak metainfo the
old teal brand colours. Now: `scripts/brand-assets.sh` renders everything from `brand-assets/`
(tauri icon; Android adaptive foreground = the mark alone at m = 2.5 dp inside the 66 dp safe
circle, plus a monochrome themed-icon layer; installer images `src-tauri/icons/installer/` from
`brand-assets/installer/*.svg`). tauri.conf.json: NSIS installer/uninstaller icon = icon.ico,
header/sidebar BMPs; WiX banner/dialog BMPs; DMG background + positions; shortDescription,
longDescription, homepage; bundle.icon starts with the 512 px icon.png (Tauri takes the first PNG
as the Linux window icon, which was 32 px) and adds 64x64. Flatpak installs 32–512 px + the
scalable SVG; metainfo branding Light #FFC24D / #714D1D. Verified locally: config passes Tauri's
schema; a real `tauri build --bundles deb` has 32/64/128/256/512 icons, the new Comment,
Description and Homepage; the Flatpak build commands run against it; appstreamcli and
desktop-file-validate pass; aapt2 compiles and links the adaptive icon (minSdk 24). NSIS/WiX
verified in the built installers (see Release v0.2.2); the DMG window and the icon on a phone not.
**APK on releases:** Android signing secrets set 2026-11-02 (see below).

**Phone gestures and Back (2026-11-02, committed a44b657, released in 0.2.2; user: Feedback sheet "collapsable via swiping
it down", "supports all of these touch swips and mobile gestures", "the setting page and other page
also needs a back button"):** touch-only gesture classes in `src/lib/gestures/` (touch events,
following `TouchWordSelection`; no library: neo's NeoDrawer handles only its dialog with handle
drags, and a pull-down from a list at its top needs the first touchmove cancelled).
`SwipeToDismiss`: Feedback sheet below 1024 px (grip, drag from the toolbar or from the list at
scrollTop 0, closes past 30% or a 0.4 px/ms flick, shade fades), the stats sheet (down) and the
timeline paper (right). `SwipeBetweenTabs`: Feedback severity filters and the Settings tabs
(passive; ≥56 px, 2:1 sideways, ≤600 ms; skips inputs, sliders, sideways scrollers and
`[data-swipe-ignore]`). Back: `navigation/back.svelte.ts` counts onspot pages behind via
`afterNavigate` (a reload restarts at 0). The AppHeader Back key on every page but Practice, and
Android Back, both close the topmost `closeOnBack` entry (`closeTopmost()` skips closed ones), then
go back in history, or go to Practice with `replaceState` when nothing is behind. Insights' open
pattern and the stats sheet close on Back. Left out on purpose: swipe on centred dialogs/menus
(Back closes them), swiping between main sections (clashes with Android's edge Back), swipe actions
on History rows (accidental deletes); dev pages have no shared header. Verified with Playwright and
CDP touch, 34/34, on the worktree's server and again on :5173 after merging; `bun run check` 0
errors. Real Android device not yet checked.

**Every installer for x64 and ARM64 (2026-11-01, feature branch 94f072e..5b1ca79, not on main):**
release.yml builds `windows` + `windows-arm` (.exe/.msi; ARM cross-built on windows-latest),
`macos` (Apple Silicon) + `macos-intel` (macos-15-intel), `linux` + `linux-arm` (ubuntu-22.04-arm:
.deb/.rpm/.AppImage with the AppImage checks; the Arch start is x64 only), and a Flatpak matrix
(x86_64 on ubuntu-latest, aarch64 on ubuntu-24.04-arm). Windows ARM C toolchain: ggml refuses MSVC
on ARM, and the VS generator rejected ClangCL (cmake crate adds -T host=x64), so it uses
msvc-dev-cmd amd64_arm64 + `CC/CXX_aarch64_pc_windows_msvc=clang-cl`, `CMAKE_GENERATOR=Ninja`,
`CMAKE_SYSTEM_NAME/PROCESSOR`, and `CXXFLAGS_aarch64_pc_windows_msvc=/EHsc` (Ninja drops CMake's
MSVC defaults). Verified: run 41335725335 all 9 jobs green, artifacts onspot_0.2.0_{x64,arm64}
-setup.exe / _en-US.msi, _{aarch64,x64}.dmg, _{amd64,arm64}.deb, -1.{x86_64,aarch64}.rpm,
_{amd64,aarch64}.AppImage, _{x86_64,aarch64}.flatpak. Not run on real ARM/Intel hardware.

**Hear a selection (2026-11-01, uncommitted):** a selection's meaning bubble (`WordGloss`) has a
speaker button that reads the selected words aloud with `speakText` (target voice). Only the
studied-language tracks pass `speak` (`AttemptCard.meaningsOf` → `Transcript`/`CorrectedPassages`);
`MeaningLabel.words` carries the selection as written. The button keeps the selection (mouse:
`mousedown` preventDefault; touch: taps inside `.word-gloss` don't put the finger's selection
away). Verified: desktop drag-select → ElevenLabs request "allé à la plage", selection kept;
phone long-press select → "mes amis. Il" played, selection kept; light and dark.
A held selection is one unit until put away (user, 2026-11-01): hovering its words shows its meaning
(again, after the other track's label took over), other words of that text show nothing, and a
click/tap on its words keeps it and shows its meaning without playing a word
(`TranscriptMeanings.holdsWord`/`reshowSelectionAt`, `WordDragSelection` `keepsSelection`, the
touch put-away skips its words). Speaker is a 13 px icon in a 20 px button (36 px invisible tap
area on touch), so the bubble is only as wide as the meaning plus the icon. Verified desktop and
phone step by step (unit-check.mjs in the old readme-shots scratch folder).
The selection's bubble takes the pointer (`holds-pointer`) with an invisible bridge over the 6 px
gap on the side it opened, and pressing it keeps the selection (mousedown preventDefault on the
bubble), so the pointer can travel from the words to the speaker (checked in Chromium and Firefox
by a 1 px mouse walk; could not reproduce a despawn in either before the change).
Feedback bookmark, dark mode: darker kraft (`#4f412b`), faint glow/crease, icon at full opacity;
worst-spot contrast 2.7:1 → 5.8:1 (pixels at 4x, glyph edges excluded). Light unchanged.

**Automatic model choice (2026-11-01, committed 699079b):** Settings → LLM → Model defaults to
Automatic (`AUTOMATIC_MODEL = 'auto'`); `stores/llm.ts` resolves it to `automaticModels(provider,
level)` (fallbacks = the rest), `pacing.ts` picks by preference + room (`hasExpectedRoom`:
known Groq limits for the detected plan, live/ledger daily use). `groqPlanOf`/`GROQ_HOST`/
`groqKnownLimits` now live in `usage/publishedLimits.ts`. Monitor: `candidateWarnings` (only a
problem every candidate shares). "When a model is busy" and `GROQ_ROTATION_MODELS` are gone.
Verified: candidate lists and levels; choice under simulated daily spend (120B spent → 20B for
evaluations, phrases still fit 120B); migration (safeguard → auto; an explicit 120B survives
reload); one real Groq call through Automatic (120B, 102 tokens); no banner; Settings light/dark,
390 px. "Did you mean" Show/Hide changes toggle done by a parallel agent (verified light/dark,
1280/390, all four states).

**Desktop title bar + AppImage resize fix (2026-11-01, committed 30d0070):** the system title bar is off
on Windows/Linux (`decorations: false`); `components/WindowBar.svelte` (only when `currentRuntime()`
is `desktop`) is a 28 px bar of page paper with minimise/maximise-restore/close, a drag region and
double-click to maximise; `main.under-window-bar` is `100dvh - --window-bar-height`. macOS:
`src-tauri/tauri.macos.conf.json` keeps native traffic lights (overlay, hidden title; the bar pads
72 px). Window permissions added to `capabilities/default.json`. `src-tauri/src/display_backend.rs`
runs the AppImage on X11. Verified on KDE Plasma 6 (debug build against the dev server): native
Wayland and the AppImage/X11 path both maximise and restore with the page filling the window;
close-up of the bar in dark mode. Not verified: button clicks, drag and edge resize by real input
(KDE's Remote Control prompt blocked xdotool), light mode on the desktop, Windows, macOS.

**Release v0.2.0 (2026-11-01):** tag pushed; Desktop release (Windows .exe/.msi, macOS .dmg,
Linux .AppImage/.deb/.rpm, Flatpak), Android (tag and main) and Pages all green. The APK was not
on the release then: android.yml only publishes a signed APK and the repo had no signing secrets.
**Signing secrets set (2026-11-02, user's choice):** `ANDROID_KEYSTORE_BASE64`/`_KEY_ALIAS`/
`_KEY_PASSWORD` from the local keystore; the v0.2.1 Android run was re-run and published
`onspot-0.2.1-12d6176-arm64.apk` (43 MB), signer CN=onspot SHA-256 9556…5cbf = the local key, so
it installs over the existing app. Every `v*` tag now publishes the signed APK. iOS
skipped (user's choice; no Apple signing). The Flatpak installs fine; Bazaar's UI hung after a
successful install (its own bug), Discover started a redundant second install.

**Brand (2026-11-01, uncommitted, `brand-assets/` untracked):** logo and app icon rebuilt from the
user's AI draft (`brand-assets/ai-generated-logo.png`) on exact geometry in VectorCraft
(`brand-assets/onspot-brand.vectorcraft`; artboards App icon, Logo, Construction). Exports:
`app-icon.svg`/`app-icon-1024.png` (mark only, macOS 1024/824 grid, continuous corner r 185.4),
`logo.svg`/`logo-1024.png` (mark + monoline "on spot" wordmark on the tile), `construction.png`.
All ratios and the palette (Ink/Cream/Light/Amber/Paper, tied to app.css tokens) are in
`brand-assets/README.md`. **In use (user's choice: the macOS-grid master on every platform):**
`src-tauri/icons/` and the Android launcher icons regenerated with `tauri icon … --ios-color
'#151412'` (Ink fills the margin on Android/iOS; new: `icons/64x64.png`, `icons/ios/`, Android
`mipmap-anydpi-v26/` + `values/ic_launcher_background.xml`); favicon and `AppHeader` brand mark
(36 px, the header row's height) are `static/app-icon.svg` = `brand-assets/app-icon-tile.svg`, the icon cropped to its tile
(the user found the margined favicon too small); the Vite `favicon.svg` and the teal "o" are gone. The project README
shows `brand-assets/app-icon-tile.svg` above the title (renders on GitHub only once `brand-assets/`
is committed). The header mark
lives in the navigation group, so on phones it folds away with the navigation, as the "o" did.

**Long-take testing (2026-11-01):** visiting `/dev/long-takes/` (dev builds only) opens the
simulated session in Practice, adding it on first visit (found again by its `session-long-takes-`
id prefix, so no duplicates). It holds two simulated takes from `src/lib/dev/longTakes.json` (generated by `scripts/simulate-long-takes.py`:
3 min/436 words/10 mistakes, 5 min/697 words/12 mistakes, `{wrong|right}` marks keep transcript,
correct version and corrections consistent). Measured before the long-take work: desktop 5-min
card 2469px of content in a 791px card (explanation at 2294px), phone 4630px (6.3 screens),
"You said" and "Did you mean" each 44 lines (desktop) / 95 lines (phone) at the 15px floor.
Done since (uncommitted, 2026-11-01):
- **Cards:** one fold button per section cycles hidden → part → full ("part" = 6 lines of transcript,
  5 of explanation; only offered when the text is ≥1.4× that). "You said" starts at part; the
  explanation and "Did you mean" start full. "Did you mean" shows only the fixes in their sentence
  (`utils/correctedPassages.ts`: word diff of transcript vs correct version, clause-trimmed context,
  nearby passages merged, `[…]` between them), with a "Whole text" / "Fixes only" toggle. Words the
  correct version drops are shown struck through where they were said (`<del class="dropped-words">`
  in Transcript.svelte; was a bare caret the user found cryptic). The follow-up question has hover,
  tap and selection meanings. 5-min take: desktop content 2469 → 951px, phone 6.3 → 1.85 screens.
  Open questions for the user: keep the fold on "Did you mean"? Short takes default to fixes only?
  Fold state isn't remembered. A feedback-panel click doesn't scroll to its mark.
- **Feedback panel width:** desktop panel narrows to the narrowest width that keeps every card and
  the header laid out as at full width (`utils/narrowestWidth.ts`, binary search on min/max-width
  in one frame); today's `clamp(330px, 31vw, 440px)` is the max, 330 the min, shrinks only by ≥12px.
  The header toolbar sets a ~385px floor. Checked in Chromium only, not WebKitGTK.
- **Linux packaging:** `@tauri-apps/cli` 2.12.4 (fixes the AppImage EGL abort: tauri#15976, bundled
  libwayland 1.20), `bundleMediaFramework: true` (no audio at all without it), category Education.
  Flatpak: `packaging/flatpak/` repackages the release .deb on GNOME 51 (app id
  `app.onspot.desktop`, not Flathub-valid); new `flatpak` job in release.yml; `packaging/smoke-test.sh`
  and `packaging/appimage/check.sh` (keep mode 755). AppImage tested on Arch/Fedora/Ubuntu 22.04
  containers and here. In progress: MediaRecorder can't record WebM/Ogg with GStreamer < 1.24.9
  (AppImage, Ubuntu 22.04/24.04 .deb), so a WebCodecs Opus recording fallback in `utils/recorder.ts`.
  Build release AppImages on Ubuntu 22.04, not Arch. Test artefacts in
  `/mnt/data/not_synced/dev-cache/linux-packaging/`.
- **Hover/selection meanings:** the bubble shows meanings only (no French); the word's own meaning
  is a second line only when it differs from the expression's. Selections are always translated
  as selected (only `origin: 'selection'` phrases are reused), never with an expression gloss.

**Rate limits and long takes (2026-11-01, uncommitted):** every LLM call goes through
`adapters/llm/pacing.ts` (see decisions.md). Measured live on a free Groq key: the 3-minute take
evaluated in 2 parts (6 corrections, ~13 s); 6 translation parts paced across models. Qwen 3.8
has a free-plan OTPM of 1,000 (only in refusals), so it only takes small requests. `allam-2-7b` is
on the key but not a fit; Qwen 3.6 404s. Hover meanings: `TextGlosses.sections` records fetched
sections (absent = saved whole, covers all words); `SqlDatabaseAdapter.parseWordGlosses` keeps it.
Selections send only their sentence ±1 as context (`phraseContext`).

**UI follow-ups (2026-11-01, uncommitted):** "Fixes only" is a numbered list; the partial view is a
scroll window without a scrollbar (fades at the edges with more text); the translation note has a
✕; hover meanings close when the text scrolls (selection labels hide off-screen via floating-ui
`hide`); feedback cards are compact, one header row, no severity icons, on aged index stock per
severity (rose/straw/sage oklch, low chroma) with the take cards' paper texture and worn edges.
Dropped words show struck through in "Did you mean" (Transcript `dropped-words`).

**Recording fallback (2026-11-01, agent):** `utils/recorder.ts` records through WebCodecs Opus
(mediabunny) when MediaRecorder can't record WebM/Ogg (WebKitGTK 2.50 + GStreamer 1.20 in the
AppImage). Open question from that agent: with system WebKit 2.54 + GStreamer 1.28 (Arch, the
user's desktop app) MediaRecorder WebM takes decoded short (0.8–1.0 s of 3 s) with a container sine
source; check one real take in the desktop app, and prefer WebCodecs on WebKitGTK if it reproduces.

**On-device speech of long texts (2026-11-01, agent, uncommitted):** Piper ran a whole 700-word
text in one ONNX run (`std::bad_alloc`). Now `speech/tts/textPieces.ts` splits it (sentences;
clauses/word runs past 250 chars, 100 for Japanese; ~28 MB of WASM memory per second of speech in
one run) and `speechPieces.ts` speaks the pieces (shared with the two-voice explanation), streamed
after the first piece; stored as before. `phonemize.ts` reuses one compiled eSpeak program
(120–250 ms → 15–35 ms per call). OOM maps to "This text is too long for the on-device voice."
Fixed after (same day): `WorkerPiperAdapter` sends requests one at a time, listened ones first
(`SpeechPriority`; background holds back 1.2 s after each listened piece; tapping a clip being
prepared makes it listened via `LivePieces.markListened`/`join`), and ends the worker after 90 s
idle (WASM memory only grows; the worker's own idle release and `disposeAll` are gone).
Preparation waits for `settingsReady` (it used to start on the default on-device mode before the
learner's settings loaded) and stops at the next piece when no longer allowed (`signal`,
`isStoppedClip`). Settings chosen while loading are saved (`persistChosenWhileLoading`).
`processPcm` caps clips at -1 dBFS (`PEAK_CEILING`): the compressor-based limiter let stored
clips peak ~1.2; now ~0.85–0.88.

**Pushed 2026-11-01 (user request):** `main` = `feature/language-delivery-mode` at 73cda9e. CI all
green: GitHub Pages (build + deploy), Android APK, and a manual Desktop release run on main
(41289629260: verify, Linux incl. the AppImage checks on Ubuntu and Arch, macOS with the 10.15
minimum, Windows, Flatpak). No tag, so nothing was published; the next `v*` tag publishes all of it.

**README screenshots (2026-11-01, user request):** `docs/screenshots/` holds practice, phone (two
screens side by side, transparent gap) and History, dark and light; the old-UI French and Japanese
shots were removed. Made from real takes through the app (on-device French voice reading French with
deliberate mistakes into a fake microphone → Groq Whisper → evaluation), in a scratch profile with
ElevenLabs answered by a silent clip. Script: scratchpad `readme-shots/` (`gen-audio.mjs`,
`record.mjs`, `shoot.mjs`); desktop 1440×900 @2x downsized to 2160 px, phone 390×844 @2x,
pngquant. Regenerate them after visible UI changes.

**UI speed (2026-11-01, user request "make this app the fastest", done by an agent):** page
switches froze 0.3–0.8 s in production while the new page was built. Fixes: neo menus exist only
while open (`quickMenu.unmountOnClose`, `neo.ts`); Settings capability rows build their contents on
first open (`CapabilityRow.svelte`; the LLM row's model refresh now runs then too); the stack builds
only cards within reach (`isWithinReach` in `cardStack.ts`) and the rest one per idle moment, newest
first (`AttemptStream.svelte`), and shows the newest card without measuring (its scroll offset is
0); `PaperTimeline` tracks its size with `bind:contentRect` + scroll events instead of reading
layout, slide 220 ms; the page fade is a CSS animation (`+layout.svelte`). Desktop Feedback panel:
absolutely placed, slides by transform in 180 ms while its grid column changes in one step;
`--feedback-content-width` is a non-inheriting `@property` set only on the grid, the panel and the
bookmark (inherited, each change restyled 7,760 elements). Measured (production, click → page shown):
Chromium Settings 311 → 201 ms, Practice 347 → 210; Firefox 637 → 316, 652 → 325; Feedback toggle
drops 1–3 frames (was 4–11). Looks unchanged (≤0.04% pixels). Not measured on WebKitGTK, Android or
a real phone. Scripts/results: scratchpad `agent-perf/`.

**Released v0.1.0 (2026-11-01):** https://github.com/khizardevelops/onspot/releases/tag/v0.1.0 —
signed arm64 APK (built locally from the tag, uploaded with `gh release upload`), Linux .deb/.rpm/
.AppImage and Windows .exe/.msi from release.yml; macOS bundle job failed (not investigated). The CI
.deb binary runs on Arch with system WebKit; the AppImage aborts here with "Could not create default
EGL display: EGL_BAD_PARAMETER" (bundled Ubuntu 22.04 WebKit; known Tauri AppImage issue on rolling
distros), noted in the release. Pages live at https://khizardevelops.github.io/onspot/. Push over
SSH (`git@github.com:khizardevelops/onspot.git`): the gh token lacks the `workflow` scope, so HTTPS
pushes of workflow changes are refused. CI was broken by the gitignored model-lab vendor import
(now an `import.meta.glob`).
**Published (2026-11-01, user request):** the app builds for GitHub Pages at
`https://khizardevelops.github.io/onspot/` (`.github/workflows/pages.yml`, on push to main):
`BASE_PATH=/onspot` (vite.config.ts → SvelteKit `paths.base`, and `__BASE_PATH__` for the
phonemizer in the worker); links/`goto` use `pageHref()` (`src/lib/pages.ts`: base + trailing slash,
`trailingSlash: 'always'`); 404.html = index.html for deep links. Pages cannot send COOP/COEP, so it
is not cross-origin isolated (cloud mode unaffected; on-device models single-threaded). Verified
locally with a Pages-like server: first visit, deep link, cloud setup, a real take. Releases: tag
`v*` → release.yml (Linux .deb/.AppImage/.rpm on ubuntu-22.04, `GGML_NATIVE=OFF`; also Windows,
macOS) and android.yml (publishes only when signing secrets exist; they are set since 2026-11-02,
so a tag publishes the signed APK itself).

**Language of instruction (2026-11-01, user request):** Settings → Language → "Language of
instruction" (`settings.instructionLanguage`, default `en`; `INSTRUCTION_LANGUAGES` in
`languages/index.ts`, 21 languages, never the studied one). It replaced the per-target
`translationTarget` field: every LLM prompt gets the name via `teachingLanguages(settings)` in
practice.ts; the prompts' English worked examples get a note to answer in the chosen language.
Translation sets carry `instructionLanguage` (missing = English; `translationsCurrent` regenerates
on a change); hover meanings are keyed per language (`glossKey`: English keeps the plain hash, so
saved meanings stay). Explanation voices are keyed by instruction language (only `en` has voices);
other languages get "No on-device <X> voice yet" and cloud explanation audio. Instruction-language
text uses `dir="auto"` (Arabic/Persian/Urdu). Verified with Spanish: explanation, follow-up
translation, correction explanation, translation and hover meaning all in Spanish.
**Install fixes:** the explanation-voice row has its own Install button (the footer one only showed
while practice was blocked), the download bar names what it installs, Install skips parts already
installed, and `cachedFetch` now awaits the cache write and stores from memory when Chromium refuses
the streamed `Cache.put` ("encountered a network error", seen for Lessac every time).

**On-device explanation audio, two voices (2026-11-01, user decision):** explanations are spoken on
the device by the English voice the learner picks (Settings → Text-to-speech → "English voice";
candidates Ryan/Lessac US, Alan/Alba UK, `approval: candidate`, auditioned from hosted
`samples/speaker_0.mp3`, nothing downloaded to compare) for the English, and the selected target
voice (`settings.ttsVoice`, or the attempt's) for every tagged target-language span and the
follow-up question. `explanationSpeech.ts` splits (`parseExplanation` highlights → target voice),
runs each piece through its voice (English through the target voice's loudness chain without EQ),
trims edge silence, resamples to 48 kHz, pauses by the punctuation at each join, and feeds pieces
to `playPcmStream` (WebCodecs Opus → WebM appendOnly → MSE) as they finish; stored whole as Opus.
The worker keeps two voices resident (LRU). The English voice is its own language-data part
(`installed.explanationVoice`); practice does not wait for it. Measured in Chromium: first sound
4.5 s with both voices cold, 1.0 s warm; 15 s explanation stored as 60 KB.
**Prepared clips (on-device only):** after a take, when a card becomes active, and for the opened
session (newest first), every clip is made ahead: explanation → follow-up → correct version → what
was said → each correction's read-back; one at a time; never while the voice is not installed
(it would start a download). Play and prepare share option builders, so they hit the same stored
clip. Follow-up section centred.
A tap on an explanation that is being prepared joins it live (`LivePieces`; a tap that lands
while the preparation is still checking storage waits for it to start, `liveExplanation`). Voices are
warmed while the learner records (`warmLocalVoices`, installed voices only). During the start-up voice
check the explanation is not reported unavailable (it flickered "not installed").
Built apps, end to end (seeded take via `plugin:sql`, the app's own Install, the Explanation button):
Linux release (WebKitGTK, single-threaded WASM: Tom loads in 8.4 s, Ryan 4.6 s, Tom rtf ~0.8)
streamed, first sound 12 s cold, 0.8 s when already prepared; Android emulator streamed, first sound
13.6 s cold, Install 127 MB (64 + 63). Warm voices: 1.0 s (Chromium).
**Pending:** the learner picks the English voice by listening; then mark it `approved` in
`languages/index.ts` and record it in `docs/benchmarks/tts.md`.

**Streamed read-back + cheaper hover meanings (2026-10-31, user request):**
- Attempt tracks (`playAttemptText`, `stream: true`) stream from ElevenLabs `/stream` (opus_48000_32):
  `streamingPlayback.ts` tees the body; one copy is repackaged Ogg→WebM (Mediabunny,
  ReadableStreamSource → EncodedPacketSink → EncodedAudioPacketSource → WebM appendOnly,
  0.25 s clusters, no re-encode) into a MediaSource on the shared `<audio>` (speed/loop/seek kept;
  `durationchange` updates the length when the stream ends); the other copy is collected whole and
  stored even if playback stops or switches (credits are spent at request time). Pending entry stays
  until stored, so a second request waits for the file. Falls back to whole-file where MSE lacks
  WebM Opus. Measured: first sound 365 ms vs 1.7 s for the whole clip (stand-in server); the real
  `/stream` sent its first Ogg chunk at 1.1 s.
- Hover meanings: fetched only after the pointer rests 300 ms (a sweep costs nothing); per text
  (`ensureWordGlosses(attemptId, text)`), not both texts at once; a selection is translated
  directly (waits only for a word-meaning request already in flight), and selections survive the
  later word-meaning save (`hasWordMeanings` = words fetched, not just selections). Verified with
  mocked LLM replies.
- Tested in the built apps: Linux release (WebKitGTK 2.54: MSE WebM Opus yes, records WebM Opus,
  stand-in first sound 0.3–0.9 s, real ElevenLabs 1.1 s, stopped stream still stored) and the
  Android 16 emulator debug APK (WebView Chrome 133: same support; stand-in 0.9 s, real 1.8 s;
  the first run after install took 12.8 s, first-launch work). Not tested on a physical phone.

**Cost and speed pass (2026-10-31, user request; verified with real Groq calls):**
- Audio is Opus everywhere: recordings (24 kbps; an 11 s take = 26 KB, was ~350 KB as WAV upload),
  ElevenLabs `opus_48000_32` stored as it arrives ("Bonjour." 3.2 KB vs 16.8 KB MP3 vs ~90 KB WAV
  as stored before), OpenAI-compatible `opus` (WAV fallback per server), Piper/WAV clips encoded to
  Opus before storage (3 s: 129 KB → 12 KB). Playback no longer waits for the DB write.
- `synthesizeSpeech` registers each clip as pending before awaiting, so concurrent requests pay once.
- Evaluation: fixed system prompt first (cache hit of 256 tokens seen on Groq on a different take);
  translations only requested when `translationMode` ≠ off (default off), else null + on demand.
  Measured: 2,485 → 2,079 prompt tokens; visible output ~25% smaller on a short take; 7.4 s → 2.2 s.
- `preloadWords` (unused, one paid request per word with cloud TTS) deleted.
- Settings shows ElevenLabs credit cost per model (Multilingual v2 = 1/char, Turbo v2.5 = ½).
- Not done (offered): converting already-stored WAV clips; an explanation auto-play toggle;
  streaming TTS. Groq free tier is 8,000 TPM (~2–3 takes a minute).
- New dep: `mediabunny` 1.61.6 (MPL-2.0, exact pin; 96 KB lazy chunk).

**Touch screens: own word selection, no platform selection; no scrollbars on phones (2026-10-31,
user request):** Android's handles and Cut/Copy menu came up on every long-press meant to translate
words. On `(hover: none) and (pointer: coarse)` app.css sets `user-select: none` +
`-webkit-touch-callout: none` on html (inputs/textareas/contenteditable stay selectable).
`TouchWordSelection` (wordSelection.ts) replaces it in transcripts: long-press a word (400ms; >10px
movement first = scroll), drag to grow by words (touchmove non-passive, preventDefault while
selecting), lift → `meanings.showSelection` translates; touchend preventDefault stops the lift
playing the word; a tap anywhere (`click` capture) clears it; one finger selection across all
transcripts. The selection is app state (`marked` + `markedByTouch` in Transcript.svelte), never the
document selection. Correction buttons opt into `user-select: text` only off touch screens; a double
tap no longer selects on touch screens. Mouse selection unchanged (still the document's, copies).
Scrollbars: the global `::-webkit-scrollbar` styling made Chrome/WebView draw a solid 10px strip;
on touch screens and ≤640px every element gets `scrollbar-width: none !important` + hidden webkit
scrollbar. Desktop keeps its scrollbars. Verified with CDP touch events (long-press/drag/lift/tap/
swipe) in phone emulation; real-device check pending (needs a new APK).

**Edge-to-edge cards on phones (2026-10-31, user request):** at ≤640px the stack cards have no side
inset (only `env(safe-area-inset-*)`), square corners (`--attempt-radius: 0`) and no tilt
(`--card-tilt: 0`; `cardPose` now writes `rotate(calc(<tilt>deg * var(--card-tilt, 1)))`, so the
stage decides). The card's own 16px padding keeps the text off the edge; the tape, the drop and the
shrunken buried card tell the cards apart. Desktop unchanged (inset, ±0.4° tilt, 6px corners).

**Two-row Feedback header on phones (2026-10-31, user choice):** at ≤640px the header wraps: the
filter name (on its tape), stats and close on row one; the severity filter spans row two with four
equal segments (83px each at 390px). Every label fits ("All feedback", "Suggestions", …) at 390 and
360px. Desktop keeps one row; the icon-only name below a 340px panel now applies only above 640px.
Options considered: filters down the hole margin (rejected: re-widens the margin), name above the
cards.

**Narrower Feedback margin (2026-10-31, user request):** binder holes 7px at 4px from the edge, red
margin line at 20px, content from 28px (was 10px/12px holes, line at 32px, content at 44px), giving
the correction cards and header 16px more width.

**Phone bar without the session line (2026-10-31, user request):** the phone's second bar row no
longer shows "session · language · level · mode" (user: useless, takes space); it keeps the small
buttons on the right, and the level/progress while recording or processing. Desktop keeps the line.

**Android release APK built (2026-10-31):** `bun run android:build` → signed (CN=onspot, v2),
arm64-v8a, `app.onspot.desktop` 0.1.0 (versionCode 1000), 44.8 MB, at
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. It first
failed in the Tauri CLI's version check: `@tauri-apps/plugin-http` 2.8.3 / `plugin-opener` 2.7.2 (npm)
vs the Rust crates 2.7.0 / 2.5.5 (crates.io had nothing newer). The npm packages are pinned to
`~2.7.0` / `~2.5.5` in package.json; the app's `@tauri-apps/api` stays 2.11.1 (matches `tauri`
2.11), the plugins carry their own nested 2.12.4. Unpin when newer Rust crates are published.

**Rejected JSON replies are repaired or retried (2026-10-31, user bug report):** Groq answered HTTP
400 `json_validate_failed` for a complete translation reply with one stray quote (`…}]"}}`) and the
raw error reached the user. `chatCompletion` (json mode) now reads `failed_generation`, repairs it
with `adapters/llm/jsonRepair.ts` (stray quote between closing brackets, trailing commas; only when
plain parsing fails, and only kept if the result parses) and returns it; if it cannot be repaired it
retries the request once, then throws "…'s reply wasn't valid JSON. Please try again.".
`extractJson` uses the same repair as its last resort (local servers do not validate).
`jsonrepair` (npm) was tried first and cannot fix this slip (it reads the quote as a new key).
The translation heading is just "Translation" (the "of what you meant to say" note was removed on request).

**Compact display type on phones (2026-10-31):** "You said" / "Did you mean to say?" use
`COMPACT_TRANSCRIPT_FIT` (max 19px, 120px fill target, line-height 1.45) when the text column is
under 480px, instead of 24px / 190px / 1.6, so one sentence takes ~140px instead of ~230px and a
typical take fits a phone screen without scrolling inside the card. Reading text (explanation,
translations, 15px) is deliberately not reduced: below that it gets harder to read for little gain.

**Translations are of the correct version (2026-10-31, user request):** idiomatic, literal,
word-for-word and the word breakdown translate `correctedText` ("Did you mean to say?"), never the raw
transcript (which can be nonsense); for an error-free take the two are the same text. The evaluation
prompt says so; `generateTranslations(text)` is given `correctedText || transcript`;
`TRANSLATION_SET_VERSION = 3` (db/types). Older (v2, transcript) sets are not shown: choosing a view
regenerates, and with translations on by default only the active card refreshes itself (one call,
not one per card).
Speak button: 34px round on phones, 32px on desktop.

**Phones: the bar is at the bottom (2026-10-31, user request):** at <=640px `AppHeader` takes
`order: 99` (every page is a flex column), with a top edge and upward shadow and
`env(safe-area-inset-bottom)` padding; `viewport-fit=cover` is set and `main.app-page` pads
`env(safe-area-inset-top)` on phones. Menus flip upward on their own (`onScreen`). Practice's notice
strip sits just above the bar; the phone timeline rises from just above it; toasts and the
language-download card are raised to clear it. Round icon buttons: neo gives `.neo-icon` a
`margin: 0 5px 0 -5px` and packs it left whenever the button has a children snippet (even an
empty one), so icon-only round buttons reset both (measured centred to 0px).

**One bar on Practice: the composer is gone (2026-10-31, user request):** the prompt and its
controls live in the top bar. The heading is the prompt (serif, up to two lines) with a session line
under it (session title · language · level · mode). Actions: idle → New prompt (icon) + Start
speaking (or the setup button); recording → live level + timer, Discard, Stop & analyze; processing
→ status + progress, Cancel. The prompt stays visible while recording. Then a divider, Exam/Casual
(hidden while recording/processing) and the session menu. `AppHeader` folds the navigation into ☰
whenever the bar is under 900px wide (`@container app-header`), so a window shared with the Feedback
panel gives the prompt room; it also takes a `below` snippet for a second row inside the bar, which
Practice uses on phones (row 1: prompt + round mic/stop + ☰; row 2: session line, or level/progress,
then New prompt, timeline, Feedback, menu). Setup, usage and error notices are a slim strip under
the bar (`.bar-notices`). Measured: bar 49px (one-line prompt) / 67px (two lines) on desktop, 85px
on phones (was header + composer ≈ 158px desktop, 108px phone); takes run to the bottom edge.

**Feedback header, stats, bookmark polish (2026-10-31, user critique):** the header is one toolbar:
filter name (serif, opens the by-type menu; becomes a filter icon below 340px of header width), a
neo `NeoTabs` segmented control with equal 34px segments of icon + inline count (no floating
badges; empty counts faded; active segment raised in its severity colour), a divider, then stats and
close as identical flat `NeoButton`s. All controls share `--toolbar-height` (32px, or the 36px touch
floor) and one centre line; nothing overflows at 1024px, 1280px or 390px. The session-stats sheet
is the darker notebook paper and its cards are white card stock with an edge, a lit top and a
layered shadow. The bookmark tab is manila card stock (SVG grain and fibres, crumple shading, a
crease, deckled outer edge, fold shade, paper drop shadow) with the error count in Caveat "red
pencil". The follow-up is framed by four teal corner marks (⛶) joined by a faint dotted line (1px, lighter teal, stopping short of the corners); all background gradients in `ExplanationText.svelte` (user request).
The filter name sits on a strip of light crepe masking tape (`.filter-name::before`: SVG crepe
creases across it + grain + sheen; the user found the first, flat version too dark and textureless; torn ends,
-1° tilt, overhanging into the gaps so it costs no width) so its text is not crossed by the ruled
lines. The paper timeline uses its own `--timeline-margin` (14px, or the page gutter if smaller)
instead of the 28px page gutter; cards keep 16px from it.

**Feedback panel follow-up (2026-10-31, superseding the first bookmark):** the bookmark is a **paper
index tab** (construction paper with `--paper-key` grain, cut outer corners, typewriter error count;
blush with errors, sage when clean) attached to the sidebar's left edge (`right: var(--feedback-width)`,
`z-index` under the sidebar). Open, it is tucked behind the sidebar (`translateX(105%)`, inert);
collapsed, it pokes out 30px. Desktop: the sidebar keeps its width and its grid column animates to
0, so it slides out whole (inert, shadow off) and the tab rides the edge then pops out (200ms delay,
slight overshoot); tucking is a quick 240ms. Tablets: the panel is hidden when closed and the tab
tucks off the right edge. Phones: no tab (top-bar button). The panel casts a shadow onto the takes
(left on desktop, upwards on tablets). The paperclip is gone. The severity filter is neo-svelte
`NeoTabs`/`NeoTab` (inset track, neo's raised active tab, 32px round keys) with `NeoBadge` counts
in the corners. neo puts `tabProps.class` on the tab wrapper and other props on the inner button;
passing `class` to `NeoBadge` replaces its positioning class (`neo-badge-pill`), so the badge is
styled through `.neo-badge-pill`; `slide`+`pill` drew no indicator at this size, so plain tabs.

**Feedback panel as a notebook page (2026-10-31, from the user's `feedback-bar.html` mockup + guide):**
`FeedbackPanel.svelte` rewritten (markup and styles; filtering, transcript linking, details, stats
logic kept). Notebook paper with grain, a red margin line at 32px and binder holes; content from
44px. A pinned card-stock header (blue rules, margin line, deep shadow, CSS paperclip) holds the
current filter's name (fades on change; it opens the by-type menu: All / Grammar / Register /
Fillers / Style), an inset icon-only filter track (All, Errors, Warnings, Suggestions; count badges;
`role="radio"`, aria-labels with counts), the stats toggle and close (rail icon on desktop, chevron
below 1024px). Corrections are white 4px cards with masking tape, one-line "wrong → right", gloss,
and an expandable details strip (explanation highlights rendered via `parseExplanation`, never raw
tags). Session stats are a bottom sheet inside the panel (`translateY(100%)` closed, zero layout
space) with one row of four white cards, Courier Prime values. Closed panel: a handle (rail on
desktop, 36px bar on tablets). The panel's own playback buttons were dropped (the take card has
them). Also fixed: the composer's prompt could not shrink at tablet widths (Start speaking ran off
the edge at 820px).

**Scroll direction, translations, tilt (2026-10-31, user requests):**
- *The pile scrolls the way text does.* Scroll top = newest take on top; scrolling down lifts the
  top card up into the slot and uncovers older takes, scrolling up drops newer ones back
  (`stackPosition` uses `1 - scrollTop/range`; `scrollTopForCard` mirrors it). Inside a long card
  the wheel first scrolls its text the same way, so one direction everywhere. The paper timeline is
  newest first (`rows`, `rowOf`), so its ink dot also moves down. A new take: the stage is put back
  on the previous newest card, then the new one drops onto it at scroll 0.
- *Translations* are a yellow sticky note on the card (`.card-translation`, see decisions.md), with a "Translation" label row like the other tracks, a
  definition grid with margin labels (stacked on phones), the idiomatic alternative as an "or …"
  line, `.pencil-link` text toggles (app.css; also the follow-up's Show English), and "Each word" as
  a dotted-leader vocabulary list in CSS columns. `.translation-surface` and `.inline-chip` are gone.
- *Tilt* within ±0.4° (`CARD_TILTS_DEG = [-0.3, 0.35, -0.2, 0.4]`).
- *Translation note rows (user follow-up):* each variant is a ruled row on the note (`ul.translation-rows`,
  CSS subgrid: tag | text | toggle), the label a solid amber tag, its toggle on the row's first line
  at the right ("+1 alternative", "Each word"), rows underlined so a toggle reads as its row's. Phones:
  tag and toggle share the first line, text below. The word list spans the note in up to 4 columns
  and skips punctuation-only entries. Follow-up: a dashed rule separates it from the explanation and
  "Show English" sits right after the "Follow-up" label.
- *Card gap* under the header: `clamp(24px, 5vh, 44px)` on desktop (was up to 80px), 16px on phones;
  the tape still has room above the card.

**Paper cards, page gutter, compact bar and the phone layout (2026-10-31, user requests):**
- *Index cards:* `AttemptCard` is paper (`elevation 0`, no glass): warm card stock + `--paper-key` grain,
  6px corners, aged inset edges, a red rule under the header (`.index-card-header`) and faint blue
  rules on the body (`.index-card-lines`, they scroll with a long take). `AttemptStream` splits each
  pile card into a shell (pose, shadow, tape) and `.stack-card-body` (clip + inner scroll), so the
  masking tape (`.card-tape`, torn `clip-path`, leans alternately) sits outside the clip.
- *Gutter:* `--page-gutter` (28px, 12px at <=640px, app.css) is the edge margin for the top bar, the
  cards, the timeline and the composer; their edges line up.
- *Compact bar:* AppHeader 48px desktop / 46px phone, 32px nav keys, 15–16px titles; Exam/Casual
  uses `size="sm"`.
- *Phones (<=640px):* top-bar buttons for the timeline (`Layers`, `data-timeline-toggle`, opens the
  paper hanging from the stage top, current take scrolled into view) and Feedback (count badge; the
  closed panel is `display: none`, no 36px handle); Exam/Casual moved into the ⋯ menu while the
  session can still change mode, and the subtitle always shows the mode; the composer is one row
  (prompt + round New-prompt and mic buttons, no eyebrow), recording is one row too. Measured: bar
  46px, composer 62px (was 158px), cards 368px wide, stage the full 844px.
- *Touch floor:* `--touch-target` 36px (was 44px) and 34px plain buttons, by user request ("buttons
  too big"); segmented controls follow it.
- *Feedback tabs:* labels had `line-height: 1` + `overflow: hidden`, cutting off descenders; now 1.35.

**Top bar instead of the navigation rail (2026-10-31, user request):** the 56px vertical rail is gone;
`components/AppHeader.svelte` is one bar each page renders at its top: logo, New session, Practice /
History / Insights / Settings keys and the light/dark toggle on the left, then the page's heading
(`title`, or a `heading` snippet) and its own controls (`actions` snippet). Practice renders it above
the attempt stack only (replacing the session header), so the Feedback panel keeps its full height;
History, Insights and Settings moved their h1 into it. At <=640px the keys fold into the ☰ menu at the
end of the bar (no floating overlay any more). The theme moved to `stores/theme.svelte.ts`
(`theme.current`, `applyTheme`, `toggleTheme`); the rail's paper texture, `--rail-bg` and
`--page-edge-shadow` are gone. Dev pages (model lab, STT bench, UI sandbox) have no bar.
**Timeline hover fixed + phones:** the hover area (`.timeline-sheet`) never moves, only
`.timeline-lift` inside it slides and scales, so the pointer can no longer fall off the moved
element and loop. Hover expansion only under `@media (hover: hover)`; touch opens it with a tap
(`open` state), a tap on a take jumps and closes, a tap outside closes. Phones show a 26px strip and
cards leave 38px for it.

**Attempt card stack + paper timeline (2026-10-31, user request from a stationery HTML demo):**
`AttemptStream.svelte` is no longer a scrolling list. The stage scrolls through a track one
stage-height per take while a sticky deck holds absolutely-positioned cards; `cardStack.ts` turns
the scroll offset into a stack position (`scrollProgress → position S → activeIndex + fraction F`,
the demo's math) and poses each card: the next take drops in from behind the header
(`translateY(-150%) → 0`, always sharp), the card it lands on stays crisp until F > 0.35, then sinks
to the buried pose (20% down, 0.92 scale, 8px blur, 0.8 brightness, 0.5 opacity). Cards tilt
-0.5/0.8/-0.3/1deg. Only the top card and three buried ones are painted. When scrolling stops (120 ms),
the stack **locks onto a card** in the direction of travel (a move over 10% of a card goes on, a
nudge falls back), so it never rests half-dropped and one wheel notch = one card; **the card on top
is the selected take** (Feedback follows it). A take taller than the stage is capped and scrolls
inside itself, only while resting on top. `PaperTimeline.svelte`: aged-paper strip (torn edge,
tape, red margin line, Caveat + Courier Prime via @fontsource) at the stage's right edge; ticks + a
red ink playhead that follows S; hover/keyboard expands it to take numbers and transcripts; click
jumps (`scrollTo smooth`). Hidden when the stage is under 560px wide (phones). Arrival drops the new
take over 1050 ms, animated in stack positions so a composer resize mid-drop cannot derail it.

**Spoken explanation + three-track attempt card (2026-10-30, branch `feature/language-delivery-mode`):**
each card has three tracks, each with a play button and its text: **You said** (the transcript,
spoken by the target voice), **Did you mean to say?** (`correctedText`: the learner's own sentence
with mistakes fixed, natural but faithful; the row is hidden and a "Correct" pill shown when it has
the same words) and **Explanation** (new `attempts.explanation`, migration 7: compact coaching in the
language of instruction with `<wrong>/<right>/<key>/<ask>` highlight tags, see
`adapters/llm/explanation.ts`). The explanation auto-plays after a take. The separate `naturalSpeech`
rewrite and the `summary` are retired (columns kept for older app versions; summaries copied into
`explanation`). **Explanation audio is cloud-only for now** (user decision: cloud-first; local voices
only speak the target language) — with Local TTS the button is dimmed and explains why. The Feedback
panel no longer shows the summary; its header plays the correct version.

**ElevenLabs voices (2026-10-30):** free plans cannot use Voice Library voices via the API (402). The
picker lists library-copied voices only when the plan is known to be paid (restricted keys cannot
read it); a 402 at speech time is remembered per key, the voice switches to premade Alice
`Xb7hH8MSUJpSbSDYk0k2` with a toast and the reply is retried; the stale hard-coded ids are gone.

**Word-granular selection (2026-10-31):** in "You said"/"Did you mean", a word is the smallest
selectable unit (`components/wordSelection.ts`). Mouse: press-and-drag selects whole words (the
browser's letter selection is prevented on mousedown; the native selection is set with
`setBaseAndExtent` on word boundaries, so it draws and copies normally), double-click selects one
word, Shift+click extends; the click that ends a selection doesn't play the word. Touch keeps the
platform long-press handles and snaps them out to whole words once dragging pauses.
The selection is drawn as a **highlighter stroke** (2026-10-31): `Transcript.svelte` tracks the selected
word range live on `selectionchange` (`selectedWordRange`), puts `marked`/`mark-start`/`mark-end` on
the word and gap tokens (gaps are now `<span>`s, always, so the DOM under a live selection never
changes), and hides the native `::selection` colour while marks show. Translucent yellow band with soft
edges and a faint streak, pooled ink at the start, chisel-slanted ends via `clip-path` inside a
margin/padding overrun that cancels out (no text moves); muted amber in dark theme.

**Phrases (2026-10-30):** the gloss call also returns *expressions* (words that only make sense
together: "pommes de terre", "tout à fait", "il y a"), validated (2–6 words, in range, no overlaps).
Hovering a word in one highlights the whole expression; the label shows the expression's meaning and
the word's own meaning on a second line. Any range can be selected with the browser's own selection
(drag, double-click, long-press handles) and is translated in context (`translatePhrase`), saved with
the take (`TextGlosses.phrases`, origin `selection`). Logic in `components/transcriptMeanings.svelte.ts`.

**Hover translations and follow-up audio (2026-10-30):** hovering (or tapping, on touch) a word in
"You said" / "Did you mean to say?" shows its in-context meaning. The first hover fetches meanings for
all of the take's words in one LLM call (`adapters/llm/glossary.ts`, aligned to `glossWords()` =
the transcript's word tokens), saved as `attempts.word_glosses` (migration 9, keyed by text hash),
so later hovers are instant and offline. One floating label app-wide (`WordGloss.svelte`, on
`<body>`, `@floating-ui/dom`). The follow-up question has its own play button (track `followUp`),
which also works with Local TTS since it is in the target language.

**Follow-up question (2026-10-30):** the LLM returns `followUp: { question, translation }` (migration 8,
`attempts.follow_up` JSON) instead of an `<ask>` tag in the explanation. The card shows a Follow-up
block under the explanation; the translation (language of instruction) is hidden behind a
"Show English" chip. The explanation audio ends with the question; the translation is not spoken.
Older takes' `<ask>` question is lifted into the same block (no translation).

**Usage monitor (2026-10-30):** Settings → **Usage** tab (`#usage`) shows, per step, what is left:
Groq per model (tokens/day, requests/day, tokens/minute; Whisper audio/day, /hour, requests/day),
ElevenLabs per account (characters, refill date), DeepSeek balance, OpenAI live headers, local =
no limits. Each meter names its source (account API / live headers / refusal / counted on this
device vs Groq's published limits) and turns into "≈ N takes / read-alouds / minutes left". Practice
shows one notice line when something is low or used up. Code: `src/lib/usage/`; design in
`docs/architecture/usage.md`. Browsers cannot read Groq/OpenAI rate-limit headers (CORS), so the web
build counts; Tauri reads them live (unverified at runtime).

**Per-step processing + ElevenLabs (2026-10-25, branch `feature/language-delivery-mode`):**
Settings has two tabs — **Learning** (language, level, mode and the three processing rows) and
**Data** (storage, export/restore, cloud sync). Speech-to-text, the LLM and text-to-speech each have
their own **Local / Cloud** switch and inline disclosure; there is no global preset:
- Speech-to-text: Local Whisper or Cloud Groq Whisper.
- LLM: a cloud LLM or a local OpenAI-compatible server (LM Studio/llama.cpp/Ollama); key optional;
  Tauri uses the HTTP plugin so local servers need no CORS.
- Text-to-speech: Local Piper, Cloud ElevenLabs, or an OpenAI-compatible speech API (OpenAI/local).
  Both cloud providers keep separate keys/models/voices.
`stores/processing.ts` is the single requirement model for the three row statuses, the footer and the
Practice gate; `languageData.ts` downloads only the required local parts (cloud-only = no speech
download). The first-run picker asks for the three Local/Cloud choices after the language; the old
Balanced/Cloud/Private presets are removed. Settings keeps tabs/details mounted (`class:hidden` or a
`0fr` grid) because neo 1.2.0's `NeoSelect` throws `state_unsafe_mutation` when it unmounts;
transient **model** lists use a text input + fetched chips, and voices use the `VoicePicker` modal.
Browser-verified: independent rows,
all-cloud vs all-local/mixed downloads, gate routing, ElevenLabs/OpenAI switching and persistence,
keyless local LLM (mock server), 390px layout. Not verified: a live ElevenLabs key, a real local LLM
server, and the Tauri desktop runtime for the local-server path.

**Voice pickers and row layout (2026-10-25 bug pass):** the three voice pickers open a dedicated
modal (`components/settings/VoicePicker.svelte`): compact trigger with the selected name and one
detail line, then a searchable, scrollable list with a pinned footer (Preview, Refresh, Done) that
fits a 390×600 viewport. Options carry a detail line (Piper size/rate, ElevenLabs
language/accent/gender/age/use case, OpenAI voice character); built-in ElevenLabs ids are named and
account voices load automatically when a key exists. Arrow keys/Home/End walk the list; the search
field focuses only on a fine pointer so phones do not open the keyboard unasked. Detail text uses a
foreground/muted mix so the 12px line clears AA on the tinted selected row (7.65–9.93:1).
`CapabilityRow` pins its controls (`flex: 0 0 auto`) and lets the text column shrink
(`min-width: 0`), so the chevron stays inside the card at every width from 320 to 1440.
`initSettings()` no longer reverts a choice made while the database was still loading.

**BYOC sync (2026-10-25, branch `feature/byoc-sync`):** Phase 3 is implemented. Settings →
Cloud sync supports **Google Drive** (app-private `appDataFolder`; desktop loopback PKCE, web
Google Identity Services) and **WebDAV** (browser `webdav` package with server CORS, native
Tauri HTTP otherwise). Sync is manual and whole-database: both sides are compared first, upload is
safe, and using the cloud copy always asks because it replaces local data. Change detection uses a
device-local monotonic revision (`src/lib/adapters/db/revision.ts`) bumped by every adapter write,
not file hashing — SQLite images are not byte-stable. Downloads go through
`importSqliteBytes()`, so the existing header/schema checks, quota pre-check and rollback apply;
Tauri additionally gets a schema-text check. Desktop OAuth callback parsing has Rust tests.
Web-verified against a local WebDAV server: upload, no-op, remote conflict, cloud restore,
keep-device upload, corrupt-remote rejection. A live Google account was not available, so Drive is
code-complete but runtime-unverified. iOS is still deferred (`docs/architecture/platforms.md`);
Windows `.exe`/`.msi` and macOS/Linux bundles are produced by
`.github/workflows/release.yml`. Source files now carry AGPL SPDX headers
(`bun run spdx` / `spdx:check`).

**SvelteKit 3 (2026-10-04, branch `migration`):** Kit 3 / adapter-static 4 / Vite 8.3; config is
in `vite.config.ts`; imports are `#lib/...` with extensions. See decisions.md.

**2026-10-03 audit:** a multi-agent UI/UX/bug pass landed fixes (commit `4bc2d94`) across shell, Practice,
History/Insights/DB, Settings and the speech/LLM adapters; see last-session.md for the list and
what remains runtime-untested. Follow-ups the same day: recording is gated on a configured LLM
provider (`llmConfigured`), wrong-language takes are flagged as one error, attempt cards use
minimal insets, and a DB lock held by another tab is retried ~3.5s then explained.
**Japanese (2026-09-25):** candidate language (dev builds only): whisper-small q4 `japanese`,
piper-plus voices with OpenJTalk/jpreprocess WASM G2P in the TTS worker; see
`docs/architecture/supported-languages.md` and last-session.

**UI library (2026-09-24):** every component is @dvcol/neo-svelte (NeoThemeProvider in the root
layout, token bridge in `app.css`); shadcn-svelte, bits-ui and `src/lib/components/ui/` are gone.
Older notes below that name shadcn primitives describe the pre-migration implementation.

The **onspot** product UI and core practice pipeline are implemented. The current Practice view
uses an Apple-inspired glass-and-gradient shell, a scroll-driven stack of attempt cards with a paper
timeline (the card on top is the selected take), compact severity filters, and progressively disclosed feedback/translation detail.
Local Whisper, SQLite, and now Piper TTS all run in workers; the UI thread is kept for interaction.
All four inception phases are implemented; a real local Whisper + LLM end-to-end proof, a live
Google Drive run, and the Piper Tom EQ/loudness pass remain verification/polish work.

**Persistence boundary (diagnosed 2026-09-20; SQLite restore added 2026-09-24):** the web build
persists only to OPFS for its exact browser profile and origin. It neither discovers data from
another port/profile nor syncs it. A fresh profile at `http://localhost:5173` initializes
successfully but is empty. A legacy JSON backup at
`/home/khizar/Downloads/onspot-export-2026-09-18.json` contains 5 sessions / 11 attempts
/ 14 corrections. The Settings storage card restores that legacy JSON format by merging it into
the current local DB; it does not erase unrelated data. It now also imports the `.sqlite` backup
this app exports: `Restore database` replaces the whole local database from the file (OPFS
`SAH.pool.importDb` on web, close + overwrite `onspot.db` on desktop), migration-runs it, reloads
settings and reopens the newest session. The user can still need a restore when changing browser
profile, origin, or web ↔ desktop runtime, because no sync service exists yet; the `.sqlite`
backup is now the complete, one-file way to move between them. Web boot also asks the browser for
durable storage and releases its OPFS worker at `pagehide`; transient startup failures retry rather
than poisoning the DB singleton. The user can still need a restore when changing browser profile,
origin, or web ↔ desktop runtime, because no sync service exists yet. `initPractice()` now
rehydrates the newest stored session and its attempts/corrections on every fresh app context;
previously the DB was populated but Practice always looked empty after refresh. Vite is strict on
`:5173` to prevent an unnoticed port change from selecting a fresh OPFS origin. History reports
database startup failures separately from a genuinely empty store and provides Retry plus a
direct legacy `.json` restore. Importing from History or Settings hydrates Practice immediately.
The legacy backup was restored into Google Chrome's real `Default` profile on 2026-09-20 and
verified across reload/relaunch: 5 History sessions and the newest 2-take Practice session load.

**Paper segmented control (2026-09-20):** `PaperSegmentedControl.svelte` is the reusable
Exam/Casual-style control. It owns Tabs' radius/padding (default 14px outer folded board / 10px
convex key), uses a `scroll`-attached paper texture so translation cannot snap a fixed texture,
and slides directly in 160ms with no spring/press scale. The selected key—not merely its text—is
semantically tinted (`error` red for Exam, `brand` teal for Casual) with a centred halo on all
four sides. Its board is inset/folded; the key's lower/right contours stay outward. No white
top-left highlight is used in light mode. Settings links to `/ui-sandbox/`, an isolated dummy-data
interactive UI lab that imports no product stores or services.

**Mobile shell (2026-09-20; superseded 2026-10-31: the ☰ menu is now inside AppHeader):** at <=640px the desktop rail is fully hidden and no bottom
navigation row exists. `+layout.svelte` provides one fixed 44px hamburger overlay in the existing
top chrome; its disclosed shadcn menu contains New session, all routes, and theme. It does not
participate in the grid, so `<main>` gets the full viewport height (browser-verified: 844px of an
844px phone viewport). Practice reserves horizontal—not vertical—space for that overlay and uses
a 52px compact header. The collapsed Feedback strip remains product content, not navigation.

**Immediate paper theme changes and feedback disclosures (2026-09-20):** `PaperTexture.svelte`
does not clear its active texture on a light/dark parameter change; it keeps it visible until the
replacement resolves, while `+layout.svelte` prewarms both appearance variants for page and rail.
Feedback's mobile closed handle is 36px. Its top header, correction rows, and stats row have one
trigger apiece with their chevron inside; no generic hover background/transition remains on those
disclosure controls.

The earlier model-selection lab is complete. Its approved STT/TTS choices and evidence live in
`docs/benchmarks/`; do not re-litigate them without new evidence.

## Language system (2026-09-15)
- `src/lib/languages/index.ts` is the single source of truth for supported languages. Each
  `LanguageDefinition` carries the STT model, the approved Piper voices, per-voice audio
  processing profiles, seed prompts, and an `approval` record (who tested it, when, evidence).
  Only `approval.status === 'approved'` languages are offered; French is the only one.
- First run shows `LanguagePicker.svelte` (gated on `settingsReady` so returning users do not see
  a flash). The choice is persisted as `targetLanguage` (`''` until chosen; legacy `'French'`
  values are normalised to `'fr'` in `initSettings`).
- Downloads are deliberately manual: Practice shows a gate telling the user to open
  **Settings → Language data** and click Download. `stores/languageData.ts` runs
  `preloadLocalSTT` then `preloadLocalVoice`, reports one combined 0–100 figure, and
  `cancelLanguageDownload()` terminates the workers mid-flight. `LanguageDownloadBar.svelte` is
  mounted in the layout, so the progress bar and Cancel follow the user across routes.
- TTS output is post-processed per voice (`LanguageVoice.processing` +
  `src/lib/utils/audioEffects.ts`): high-shelf EQ, compressor/limiter, makeup gain, peak
  normalization. Piper Tom carries the listening-test correction; the other voices are raw.
- **Settings layout (2026-09-18, from `prototype/to-be-implemented/Settings.html`).** Five titled
  shadcn `Card`s: Language (selects + language-data `Item`), AI provider (BYOK) (provider → key →
  model + Refresh → note/links `Item` with Test connection), Transcription (asks for a Groq key
  when cloud STT is on and the LLM provider is not Groq), Voice & audio (engine, voice,
  Advanced-only Equalizer, Voice preview), Storage. Rows are shadcn `Field` (responsive
  orientation); keys use `InputGroup` with show/hide; General/Advanced is a `ToggleGroup` styled as
  a sliding segmented control (Advanced default). Blocks live in `src/lib/components/settings/`.
- **4-band EQ + volume.** Bass (200 Hz low shelf), Body (500 Hz peaking, Q 1), Presence (1.2 kHz
  peaking), Treble (3.2 kHz high shelf), ±12 dB, plus a separate Volume output fader.
  `AudioProcessingProfile.body` / `VoiceTuning.bodyDb` are new; `tuningSignature` appends Body only
  when non-zero, so audio cached before Body existed keeps its key. `VoiceEqualizer.svelte` uses
  the shadcn `Slider` (vertical, `thumbPositioning="exact"`), plots the response from Web Audio's
  own `BiquadFilterNode.getFrequencyResponse` on a 100 Hz–8 kHz log axis (0 dB = approved sound),
  and names each thumb for screen readers via a small action.
- **Shared processing chain.** `createProcessingChain()` in `utils/audioEffects.ts` builds the EQ,
  approved compressor, makeup, normalization, volume and limiter as Web Audio nodes. `processPcm`
  renders it offline for read-backs (bit-identical to the previous implementation, verified);
  the Settings preview runs the same graph live.
- **Live voice preview.** `stores/ttsPreview.ts` synthesizes the preview sentence once **raw**
  (`synthesizeSpeech({ raw: true })`, cache signature `raw`) and plays it through the live chain
  in its own `AudioContext` at 22.05 kHz. Moving a fader calls `chain.setTuning` (smoothed
  `setTargetAtTime`) — no regeneration. Loop is the preview's own `source.loop`; Pause suspends
  the context; leaving Settings stops it. Cloud previews play unprocessed.
- **SQLite export.** Settings → Storage → Export .sqlite writes the whole database: every table,
  recordings and all cached TTS audio (`audio_assets`), settings, schema version. Web:
  sqlite-wasm `sqlite3_js_db_export` in the OPFS worker, saved with `browser-fs-access` (native
  Save-as where supported, download otherwise). Desktop: `VACUUM INTO` a temp file, read with
  `@tauri-apps/plugin-fs`, saved via `@tauri-apps/plugin-dialog`. API keys (localStorage) and
  downloaded models (Cache API) are not included. The old JSON export is gone.
- **SQLite import.** Settings → Storage → Restore database and History's empty state accept the
  `.sqlite` export back. `importSqliteBackup()` (utils/export.ts) checks the 16-byte SQLite
  header, calls `importSqliteFile()` on the adapter, then `initSettings()` +
  `hydrateLatestSession()`. Web: the worker makes the connection's main database the backup with
  `sqlite3_deserialize()`, `pool.unlink('/onspot.db')`, rewrites it with `VACUUM INTO`, then
  reopens — deliberately avoiding `pool.importDb()`, whose large raw OPFS write short-writes on
  some Firefox-family browsers (`Unknown write() failure.`). Desktop: the SQL pool is closed, the
  imported bytes overwrite the plugin's `onspot.db` in the app config dir, stale
  `-journal`/`-wal`/`-shm` sidecars are removed, `init()` reopens and migrates.
  `RestoreDatabaseButton.svelte` owns the file picker and an AlertDialog confirm because the
  import replaces (not merges) local data; its Action handler closes the dialog itself (bits-ui
  2.19 `Action` does not). The legacy JSON restore still merges separately. Browser-verified:
  Chromium 19/19 + 8/8, Firefox 7/7 + 7/7 (real-backup table parity and integrity, v5→v6
  migration, export → wipe → import, settings reload, invalid-file rejection, post-import
  writes/export); the Tauri path awaits a runtime test.
- **Paper texture.** `components/PaperTexture.svelte` wraps `@paper-design/shaders` (vanilla
  `ShaderMount`, same params→uniforms mapping and image prep as their React wrapper). It renders
  once, snapshots to WebP, disposes the WebGL context and caches the image in the Cache API
  (`onspot-paper-v1`, keyed by size bucket + DPR + params); later loads use no WebGL. The layout
  shows a soft page paper behind everything and a laid (ribbed) paper in the rail, per theme.
  Page surfaces (practice grid/stage, composer fade, feedback panel) are translucent so it shows.
- **Sheets & page (2026-09-19).** Cards are frosted `.sheet`s; the page is a `page-sheet` laid on
  the rail (see rules/style.md). The earlier stitched binding and sheet texture are gone.
- **Colour hierarchy (2026-09-18).** Paper → deep paper (rail) → sheet (cards) → inset →
  control (sea-glass, all neutral buttons) → selected/primary (teal) → semantic; documented in
  `rules/style.md` and at the top of the `:root` block in `app.css`. Paper texture is gently
  crumpled (no heavy grain).
- **Paper surfaces & relief (no plastic gradients).** The page texture is published as
  `--paper-page` on `<html>`; `.paper-surface` (app.css) paints it with `background-attachment:
  fixed`, so any surface is cut from the same sheet and lines up with the page. Used by the
  Practice header, the composer fade (masked), History session cards, the
  Exam/Casual knob and the rail keys. Relief tokens: `--paper-emboss(-hover)`, `--paper-deboss`,
  `--paper-press-tint` (plus `--neu-raised*`/`--neu-pressed*` for larger cards). Rail keys are
  page-paper tiles on the ribbed rail, embossed; the current page is debossed and shaded. The
  mode switch is a debossed channel with an embossed paper knob and a glowing indicator.
- **History.** Sessions are grouped by calendar day (Today, Yesterday, weekday within a week,
  then full date; `Intl.DateTimeFormat`) with a count per day, and sorted by start date via a
  shadcn DropdownMenu (Newest / Oldest first, remembered in `localStorage`
  `onspot.history.sort`). Cards are sheets (`bg-card`, border, `--shadow-card`), no motion and no
  fixed-attachment background (that made scrolling glitchy). Regex / Case sensitive are shadcn
  `Toggle`s folded behind an options toggle next to the search box.
- **Feedback panel.** Header: title trigger · count · recording + natural-version buttons ·
  chevron trigger (summary gets the full width). Severity tabs are the Exam/Casual control: a
  sea-glass channel (50px) with one sheet knob that slides to the measured active tab, count on
  top, label + indicator light below. Tabs size to content (40–104px), so "All" is narrowest; a
  container query tightens labels under 250px. The category filter is a 40px control key beside
  the channel. Styles reaching shadcn elements must be `:global(...)`.
- **Attempt card.** Transcript font adapts to length: `utils/fitText.ts` (area model, no DOM
  measuring) picks 15–24px so text fills ~190px before the card grows; Source Serif, line-height
  1.6. Natural alternatives / Word breakdown are chips on the translation label row (compare
  view) or floated into the first line (single view) — never their own row. Tighter padding.
- **Practice feedback sidebar.** The column wrapper inside `.coach-content` (a row flex box) now
  has `w-full`; before, it shrank to its content and left an empty strip.
- **shadcn registry vs bits-ui 2.19.** The current registry emits `data-vertical:` /
  `data-horizontal:` classes; bits-ui emits `data-orientation`. Newly added components (slider,
  toggle-group, field, item, input-group) were patched to `data-[orientation=…]`. Do **not** add a
  global `@custom-variant data-vertical` — it silently activates inert classes in the older
  tabs/separator components (e.g. forces the Feedback tabs to 32px).
- **`AlertDialog.Action` does not close the dialog in bits-ui 2.19.** Handlers must close the
  bound `open` state themselves (see `mem:decisions.md`); `Cancel` still closes on its own.
- STT/TTS/prompts/LLM prompts are all parameterized by the selected language. Nothing is bundled;
  every model is fetched from its public host by the user's device. `docs/architecture/languages.md` tracks the
  approval system and the add-a-language recipe.

## Product shape (from `docs/prompts/inception.md`)
- SvelteKit + `@sveltejs/adapter-static` (`fallback: 'index.html'`) → pure client-side SPA.
- Tauri v2 desktop wrapper (.exe first, cross-platform ready).
- Tailwind CSS v4 (layout) + @dvcol/neo-svelte 1.2.0 components (shadcn-svelte removed
  2026-09-24; see decisions.md "UI library").
- AGPL-3.0.
- Record 30–60s spontaneous French → transcribe (local Whisper / Groq) → LLM evaluates →
  read corrected phrasing back (local Piper / cloud TTS).
- Hybrid DB behind `IDatabaseAdapter`: Tauri SQL (`@tauri-apps/plugin-sql`) on desktop,
  `@sqlite.org/sqlite-wasm` (OPFS, in a Worker) on web.
- BYOK LLMs (Groq, DeepSeek) and BYOC sync (Google Drive PKCE, WebDAV, local `.sqlite`).

## Decided models carried into the product
- **STT: `onnx-community/whisper-small` q4, 299 MB, 5.5% aggregate WER** (WASM). WASM, not
  WebGPU. Whole reasoning in `memory/decisions.md` and `docs/benchmarks/stt.md`.
- **TTS: Piper Tom (M, medium)**, 64 MB, 44 kHz. `Piper UPMC` (jessica/pierre) and
  `Piper Siwis` are the alternates. Listening-test decision, 2026-09-13.
- Cloud fallbacks per inception: Groq `whisper-large-v3-turbo`, OpenAI-compatible LLMs.

## Build status
- [x] **Phase 1 — scaffold, headers, DB abstraction.** Done and browser-verified.
- [x] **Phase 2 — speech + AI pipeline.** Mic capture, STT Web Worker, cloud adapters, LLM
  evaluation, TTS read-back and the record→transcribe→evaluate→persist orchestration.
  STT and Piper worker plumbing are browser-verified; a full local transcription + evaluation
  still needs the 299 MB download and an LLM key.
- [x] Phase 3 — BYOC sync. Google Drive (app-private folder; desktop loopback PKCE, web Google
  Identity Services) and WebDAV, as whole-database snapshots with explicit conflict prompts.
  Local export/import already existed; sync reuses its restore safety path. Browser-verified
  against a local WebDAV server; a live Google account still needs a run.
- [x] Phase 4 — product UI. Practice, Settings, History (search + regex/case, replay, rename,
  delete), Insights, toasts, click-to-pronounce, session-locked mode, per-attempt translation
  variants, clickable transcript↔feedback correction marks, and the attempt stack are done.

### Current attempt-card UX
- `AttemptStream.svelte` is a stack of index cards (see the 2026-10-31 note at the top and
  `components/cardStack.ts`). The old scroll-driven 3D conveyor, its rAF fallback, the floor spacer
  and the `tall` class are gone. Reduced motion: cards swap places at the halfway point (no sliding
  or blur) and programmatic scrolls jump.
- **Tall cards scroll inside themselves.** A card is capped to the stage
  (`max-height: 100% - --card-gap - --card-floor`) and gets `overflow-y: auto` only while the stack
  rests on it (`restsOn`), so the wheel never scrolls a card that is still moving; at its end the
  wheel chains to the stage and the next card drops.
- New attempts drop onto the pile over 1050ms (eased, in stack positions). From an older card the
  stage first jumps back to the previous newest card, then drops the new one. The component stays
  mounted when the list is empty. Wheel, touch, or pointer input cancels programmatic motion.
- Every attempt with translation data has a labelled **Translate** menu. It explains and selects
  Idiomatic, Literal, Word-for-word, or all three views.
- **Compare all three stacks the three variants vertically**, full card width, each with its
  label. This is deliberate: takes run 60s–5min, and vertical scrolling is the abundant axis.
- Translation output is the translation text alone; variant explanations live only in the menu.
  All menu choices are enabled. Choosing a variant on an old/versionless record regenerates the
  full strict v2 translation set through the configured LLM and saves it on that attempt for reuse.
- Translation v2 keeps idiomatic, literal, and word-for-word structurally distinct. It can also
  save 0–2 idiomatic alternatives and an ordered word/morpheme breakdown. Alternatives and the
  breakdown stay collapsed beneath the primary translation until the learner requests them;
  regeneration is a secondary action inside the Translate menu.
- **The card on top is the selected take** (`activeAttemptId` follows the stack when it locks). This
  replaced "scrolling never selects": in a stack only one card is readable. Buried cards are `inert`
  inside; clicking one that peeks out (or a timeline entry) brings it to the top. A
  `ResizeObserver` on the stage keeps the same card on top across resizes.

### Current feedback and shell UX
- `FeedbackPanel.svelte` uses shadcn Tabs for **All / Errors / Warnings / Suggestions**, with the
  count over each label, and a shadcn Dropdown Menu for Grammar / Register / Fillers / Style.
- **The tabs' selected state depends on `data-state="active"`** (what bits-ui sets), never
  `data-active`; the old `data-active:` classes silently did nothing and made every tab look
  unselected. Selected colours: All = high-contrast neutral pill, Errors = red tint,
  Warnings = amber tint, Suggestions = brand tint. Equal grid columns with `!` utilities.
- Session stats live in a Collapsible footer, **closed by default**, 36px collapsed, expanding to
  four small stat cells.
- Correction rows are bordered cards; the expanded explanation sits inside the same border behind
  an internal separator, so it never reads as a second card.
- The feedback panel (visible title **Feedback**; previously "Coach notes") is a shadcn
  Collapsible. Desktop closes it into a 64px review rail; viewports below 1024px start with a 58px
  summary bar and expand it to 42% of the available app height. Choosing an inline transcript
  correction reopens the panel automatically.
- Empty replacements are deletions: the original is struck through and labelled **Remove**. No
  misleading arrow is rendered. The LLM prompt explicitly requires `replacement: ""` for this
  case, and `correctionTitle()` removes redundant category/severity labels.
- Corrections are shadcn Collapsibles with animated explanations; AttemptCard uses shadcn Card,
  Badge, Button, Dropdown Menu, Collapsible, Separator and Tooltip primitives. The attempt header
  is a single row: `Take n · duration · words` left, actions right.
- Settings uses shadcn Select for all choices; the native `<select>` controls are gone and each
  trigger has a programmatic accessible name.
- (Historical) the app rail was 56px on desktop; removed 2026-10-31 for the top bar.

### Visual cleanup (2026-09-15)
- The purple accent is gone: `--brand-2`/`--brand-3` are cyan/sky in both themes, so gradients run
  teal → cyan instead of teal → violet. Mode switches tint their selected trigger (Exam red,
  Casual brand).
- **Cards have real depth against the page.** Light `--background` is `#f1efe9` against white
  cards; dark is `#0b0b0d` against `#19191d`. Attempt cards carry an explicit border plus the
  stronger `--shadow-card`; correction cards use `bg-card` + border + `shadow-sm`.
- The feedback panel's visible title is **Feedback** (was "Coach notes"; component and internal
  `coach-*` class names are unchanged).
- No Sparkles/`✨` icons anywhere; empty states use Mic/Check/MessageSquareText.
- Practice composer has zero outer bottom padding and sits flush against the window bottom.
- A single translation view renders its text without the redundant variant label; labels appear
  only in "Compare all three".
- Translation surfaces (variants, word breakdown, all three comparison panels) carry a brand tint
  (`color-mix(--brand 8%, --card)` plus a 20% brand ring) instead of `--surface-2`, which was
  almost identical to the page background and read as an accidental colour mismatch.

### Phase 1 implemented

SvelteKit migration (was a root-level Vite + Svelte app):
- SvelteKit 3: config lives in `vite.config.ts` (`sveltekit({ preprocess, adapter })`, no `svelte.config.js`) + `@sveltejs/adapter-static` 4 (`fallback: 'index.html'`, pure SPA).
- `src/routes/+layout.ts` with `ssr=false`, `prerender=false` → single `index.html`.
  Do **not** set `prerender=true`: it emits a second index.html the fallback overwrites.
- `src/app.html`, `src/app.css` (Tailwind v4 + `@tailwindcss/vite`), self-hosted
  `@fontsource` fonts (no font CDN — privacy).
- Design tokens: shadcn contract (`--background`, `--primary`, ...) plus onspot's own
  (`--brand`, `--warn`, `--good`, `--glow-*`). shadcn's `--accent` is the subtle hover
  surface, **not** the brand; the brand is `--brand`.
- `components.json` for shadcn-svelte; `cn()` in `src/lib/utils/cn.ts`.
- COOP/COEP set by a custom middleware plugin in `vite.config.ts` because SvelteKit's Vite
  plugin discards `server.headers`/`preview.headers`. Verified: `crossOriginIsolated === true`.

Tauri v2:
- `src-tauri/` generated by `tauri init`, identifier `app.onspot.desktop`, crate `onspot`.
- SQL plugin registered; `capabilities/default.json` has `sql:default` + `sql:allow-execute`.
- `src-tauri/.cargo/config.toml` pins linker `gcc` (Arch triple mismatch). `cargo check` clean.

Database layer (`src/lib/adapters/db/`):
- `types.ts` — `IDatabaseAdapter` + models (Prompt, Session, Attempt, Correction, AudioAsset,
  Setting, SyncMetadata) and the low-level `SqlDriver`.
- `schema.ts` — versioned migrations (v1), shared by both runtimes.
- `SqlDatabaseAdapter.ts` — all CRUD written once over `SqlDriver`; aliases rows to camelCase;
  corrections stored as a JSON array; `export`/`import` are a portable SQL dump.
- `TauriSqlAdapter.ts` — `@tauri-apps/plugin-sql`; translates `?` → `$1` (plugin's documented
  SQLite syntax).
- `OpfsSqliteAdapter.ts` + `sqlite.worker.ts` — `@sqlite.org/sqlite-wasm`, OPFS SAH-pool VFS in
  a Worker. Verified loading in headless Chromium.
- `index.ts` — `getDatabaseAdapter()` factory on `window.__TAURI_INTERNALS__`.

Lab UI (`src/App.svelte`, `src/lib/components/*`) was archived to
`.agents/handoff/archive/lab-ui-2026-09-13/`; the adapters, `lib/tts`, `lib/utils` and
`lib/types.ts` were kept. The prototype supersedes that UI.

### Phase 2 implemented (partial)

Adapter layout now matches the inception:
- `src/lib/adapters/stt/` — `BaseAdapter`, `engine` (device probe, download progress,
  `whisperTranscribe` sequential windows, `windowedTranscribe`), `WhisperAdapter`,
  `MoonshineTinyFrAdapter`, `WebSpeechAdapter`, `CustomHFAdapter`, `registry` (`sttRegistry`),
  and the new **`GroqWhisperAdapter`** (BYOK cloud STT; encodes 16 kHz PCM to WAV and POSTs it).
- `src/lib/adapters/tts/` — `BaseTTSAdapter`, `PiperAdapter` (4 French voices), `registry`
  (`ttsRegistry`), `cachedFetch`, `phonemize`, `roundTrip`, and the new **`OpenAITtsAdapter`**
  (BYOK cloud TTS, decoded to PCM).
- `src/lib/adapters/llm/` — `client` (OpenAI-compatible chat completions), `providers`, `prompt`
  (evaluation schema/rules), `translationPrompt` (shared strict translation semantics), `evaluate`
  (tolerant JSON extraction/normalization), and `translate` (focused retroactive regeneration).
- `src/lib/utils/wav.ts` — mono Float32 → 16-bit WAV.
- `src/lib/stores/settings.ts` — DB-backed preferences (level, exam, mode, stt/tts mode, LLM
  provider/model, voice). `src/lib/stores/secrets.ts` — **localStorage** API keys, deliberately
  never in the synced DB.

LLM JSON includes `{ correctedText, naturalSpeech, translations, summary, corrections[],
vocabulary[], connectors[] }`. `translations` v2 contains idiomatic, optional idiomatic variants,
literal, word-for-word, and (for focused regeneration) an ordered word breakdown.
Corrections use the 4 DB categories (`grammar`/`register`/`filler`/`style`); vocabulary upgrades
are intended to be persisted as `style` suggestions and connectors as `register`/`filler`, so the
prototype's insight columns keep working without new categories.

### Phase 2 continued: capture, worker, orchestration

- `src/lib/workers/stt.worker.ts` — **the local model now runs off the UI thread.** Handles
  `ping` / `load` / `transcribe`, relays `createDownloadProgress` and `onDeviceResolved`, and
  moves PCM in by transfer. This closes the lab's #1 open item.
- `src/lib/adapters/stt/WorkerWhisperAdapter.ts` — main-thread proxy implementing the
  `BaseSTTAdapter` contract. `dispose()` terminates the worker.
- `src/lib/adapters/stt/service.ts` — `transcribeFrench()` chooses local worker or Groq;
  `preloadLocalSTT()`; `sttDiagnostics()` (the worker `ping`).
- `src/lib/adapters/tts/service.ts` — `synthesizeFrench()` (worker-hosted Piper or OpenAI) → WAV
  URL; `listLocalVoices()`. Piper loads lazily in `tts.worker.ts`, serializes inference, transfers
  PCM without copying, keeps one voice resident, and disposes sessions after 90 seconds idle.
- `src/lib/utils/recorder.ts` — `VoiceRecorder`: MediaRecorder + live RMS level for the
  waveform, decode to 16 kHz mono on stop.
- `src/lib/utils/wav.ts`, `src/lib/utils/base64.ts` — WAV encoding and audio (de)serialisation.
- `src/lib/practice/prompts.ts` — 8 seed prompts, seeded into the DB on first run.
- `src/lib/stores/practice.ts` — the orchestration: prompt → record → transcribe → evaluate →
  persist Session/Attempt/Corrections/AudioAsset → speak `naturalSpeech`. Maps vocabulary and
  connectors into correction rows. `openSession()` reloads a past session.
- DB **migration v2**: `attempts.natural_speech`, `attempts.summary`.

### Phase 4 started: product UI

- `src/routes/+layout.svelte` — paper textures, theme provider, `initSettings()`; navigation is
  in `AppHeader.svelte` (rail removed 2026-10-31).
- `src/routes/+page.svelte` — Practice: prompt composer, live waveform + 1:00 timer, STT
  progress, transcript with correction highlights, feedback panel and session stats.
- `src/routes/settings/+page.svelte` — level/mode, BYOK provider + keys, an **enum-backed model
  dropdown** with "Refresh model list" and **"Test connection"** buttons plus provider guidance
  links, local/cloud STT and TTS, Piper voice. No target-exam field.
- `src/routes/history/+page.svelte` — session list; opens a session into Practice.
- `src/routes/insights/+page.svelte` — stat cards, recurring-pattern columns, and a
  per-pattern occurrence detail with a jump back into the session.
- `src/lib/insights.ts` — cross-session aggregation (style suggestions excluded from patterns).
- `src/lib/components/Toasts.svelte` + `src/lib/stores/toast.ts` — transient feedback.
- shadcn-svelte components installed under `src/lib/components/ui/` (button, card, input,
  label, textarea, badge). The registry imports `$lib/utils`; `src/lib/utils/index.ts` re-exports
  `cn` plus the registry's `WithElementRef`/`WithoutChildren` helper types.
- `src/lib/components/Transcript.svelte` — tokenizes the transcript and tags each word with its
  correction, so marks link to the feedback panel and every word is individually pronounceable.
  (Replaces the earlier, deleted `utils/highlight.ts` string-wrapping approach.)

### Dev tooling
- `src/app.css` excludes `docs/`, `.agents/`, `eval/` and `repomix/` from Tailwind's project-wide
  class scan via `@source not`. Tailwind registers every scanned file as a build dependency of
  `app.css`, and Vite full-reloads on any change it cannot HMR — so without the exclusions,
  writing in `docs/` (pure developer notes) reloaded the whole app.
- `src/routes/ui-sandbox/` is a standalone, **1:1 interactive** clone of the chat-history UI for
  an external UX/UI review. `components/MockTranscript.svelte`, `MockAttemptCard.svelte`,
  `MockAttemptStream.svelte` and `MockFeedbackPanel.svelte` copy production markup and **keep**
  all Svelte state, `{#if}` progressive disclosure and click/hover handlers, but drop stores,
  adapters and DB/LLM/TTS calls; those are replaced with local simulated state. Clicking cards,
  toggling translation variants, opening the segments panel and linking corrections all work.
- `+page.svelte` holds a hardcoded four-attempt live session including a French proverb, with
  bindable active-attempt/correction state.
- `AttemptStream.svelte`, `AttemptCard.svelte` and `stores/practice.ts` are **unmodified**; the
  sandbox imports nothing from them. `bun run bundle:ui` (repomix) packs only
  `src/routes/ui-sandbox/**/*.svelte` to `repomix/ui-sandbox-bundle.xml`. The `repomix/` folder is
  tracked (kept by `repomix/.gitkeep`); only the generated `repomix/*-bundle.*` output is
  gitignored, so nothing lands in the repo root and the folder persists after a clone.
- `bun run bundle -- <page|path|glob...>` (`repomix/bundle.mjs`) exports any page or section of
  the real app with repomix. Pages are discovered from `src/routes` (`home`, `history`,
  `insights`, `settings`, `ui-sandbox`; `--list`), so new routes need no setup. From the page's
  own route files it follows local imports (`#lib`, relative, `?worker`, `new URL(...,
  import.meta.url)`, CSS `@import`) and passes the file list to `repomix --stdin`. The root
  `+layout` (app shell) is opt-in via `--layout` because it pulls the practice store and every
  adapter into each page. Re-export-only barrels (shadcn `ui/x/index.ts`, `adapters/*/index.ts`)
  don't count toward `--depth`. Output: `repomix/<targets>-bundle.<ext>`, gitignored.

## Invariants (carried over, still true)
- All local inference is client-side. Device resolved at load time, never hardcoded. WASM default.
- Device stays WASM. WebGPU returns nonsense for quantized weights on the test machine.
- Quantization is a bandwidth lever, not a speed lever. q4 is the only quantized precision that
  loads; int8/uint8/q8 Whisper cannot build a session.
- Long audio uses sequential 30s windows seeking to the last emitted timestamp. No
  `chunk_length_s`/`stride_length_s`.
- Piper and Transformers.js keep separate ONNX Runtime instances.
- HF token lives only in `localStorage`; never in a `VITE_` var.
- The browser Cache API is per-origin.
