# Last Session

## 2026-11-07: Release 0.2.4 (all installers on Releases)

- **Asked:** "just make all the github action artifacts appear in the release section … I want all
  the installers there". Installers only reach Releases from a `v*` tag; pushes to `main` only
  build the Android APK as an Actions artifact. Nothing had been tagged since v0.2.3.
- **Done:** `Release 0.2.4` on `main` (package.json, tauri.conf.json, Cargo.toml/lock, AppStream
  entry, `docs/releases/v0.2.4.md`), tagged `v0.2.4` and pushed over SSH. First run of the new
  `notes` job.

## 2026-11-06: one branch on GitHub; release notes fixed

- **Asked:** "why tf are everything on the release page" and "merge all the branches so that the
  github only has one branch"; then "fix the notes and keep all the files".
- **Branches:** every branch was already fully merged into `main`. Deleted remote
  `fix/dark-mode-visual-depth` and the local `feature/byoc-sync`, `feature/native-speech`,
  `migration`, `spike/whisper-webgpu` and `fix/dark-mode-visual-depth`. GitHub has only `main`.
- **Releases:** v0.2.0–v0.2.3 descriptions were three to seven copies of "Full Changelog": each
  upload job ran softprops with `generate_release_notes: true`, which appends on every upload.
  Wrote `docs/releases/v0.2.0.md`, `v0.2.1.md` and `v0.2.2.md` from the commits between tags and
  published all four with `scripts/release-notes.sh` (drops the `# onspot X` heading). All files
  kept (7 on v0.2.0, 15 on the others); v0.1.0's hand-written notes left as they were.
- **Workflows:** release.yml's verify job requires `docs/releases/<tag>.md` on tags; a new `notes`
  job publishes it; the upload jobs in release.yml and android.yml only add files.
- **Push:** over SSH (`git@github.com:khizardevelops/onspot.git`). The gh token still lacks the
  `workflow` scope, so HTTPS pushes of workflow files fail.

## 2026-11-06: iOS PWA foundation (installable web app)

- **Asked:** start `docs/prompts/ios-focused-pwa.md`, then deploy with the `cf` CLI. Answers: no
  iPhone/iPad yet, only a macOS VM on an external drive; Cloudflare; keep the option to download
  local STT/voice while nudging cloud on iPhone; yes to iOS launch images.
- **Built:** `static/manifest.webmanifest`; `scripts/pwa-assets.sh` + `static/pwa/` (192/512/
  maskable/apple-touch icons and 28 portrait/landscape launch images for 14 current devices);
  `src/app.html` iOS meta, theme colours and pre-paint theme/status-bar script; `static/_headers`;
  `scripts/cf-deploy.sh` + `.github/workflows/cloudflare.yml`; `src/service-worker/index.ts`,
  `src/lib/platform/pwa.ts`, `PwaUpdate.svelte`, `PwaInstallPrompt.svelte`,
  `settings/IosInstallSection.svelte`; layout registration/mount and Settings placement.
- **Deployed:** **https://onspot.khizardevelops.workers.dev** on Cloudflare Workers static assets.
  `cf pages deploy` is disabled and `cf deploy` refuses SvelteKit; `--prebuilt` with a hand-built
  Build Output Specification works. The empty legacy Pages project `onspot-4k1.pages.dev` was
  created while probing and is unused.
- **Behaviour:** service worker registers only in production web builds (`resolve('/')`, scope
  root) and not in dev/Tauri. Shell precache excludes piper-wasm, splash images, MP3s and ORT;
  WASM runtime files cache on first use; cross-origin API/model traffic is never intercepted;
  deep-link shell gets an absolute app-root `<base>`. A waiting worker shows Later/Reload; nothing takes over
  mid-take. The iOS install card is hidden on welcome and Settings (Settings has the permanent
  copy), and local model downloads are not disabled. `notificationsSupported()` is false on Apple
  touch devices, so Reminder Settings stays in-app and does not request system permission.
- **Gotchas found:**
  - `cf pages deploy` answers "Legacy Pages is not supported"; `cf deploy` detects SvelteKit and
    refuses. Use `cf deploy --prebuilt` with `.cloudflare/output/v0/config.json` and
    `workers/default/worker.config.json`, copy `build` into `workers/default/assets`, and set
    `assets.notFoundHandling: "single-page-application"`.
  - Workers static assets cap each file at 25 MiB. The WebGPU-only
    `ort-wasm-simd-threaded.jsep-*.wasm` is 26.5 MiB, so `scripts/cf-deploy.sh` drops it; the
    default WASM ORT runtime (23.5 MiB) stays. Local WebGPU is unavailable on this deployment.
  - Workers assets reject the Pages `/* /index.html 200` rule as an infinite loop. The SPA
    fallback is the Worker asset setting; `static/_redirects` was removed and `wrangler.toml` is
    obsolete. `_headers` **is** applied (COOP/COEP/nosniff/referrer and service-worker no-cache).
  - SvelteKit 3 removed `$service-worker`; use `$app/service-worker` (`self`), `$app/manifest`
    (`immutable`, `assets`, `prerendered`) and `$app/env` (`version`). Type-check the worker with
    `bunx tsc -p src/service-worker --noEmit`; root tsconfig excludes `src/service-worker`.
  - `import.meta.env.BASE_URL` is `./` in the SPA, so registering `./service-worker.js` worked at
    `/` but 404'd on `/history/`. Use `resolve('/')`.
  - Vite preview exits when `bun run build` replaces `.svelte-kit/output`; the update test used a
    small static server over `build/` instead. This is a test-tool limit, not a product bug.
  - Vite preview rewrites deep-link fallback HTML to relative asset URLs and rewrites the base to
    `./`/`../`. The worker **replaces** any existing base with the absolute app root (do not skip
    when a base exists), otherwise the root shell cached at `/` fails when served at `/history/`.
  - A dedicated worker's XHR is not reliably intercepted by the service worker offline. The SQLite
    worker now finds the cached `sqlite3-*.wasm` and passes it to sqlite-wasm as `wasmBinary`; the
    database opens offline. The earlier failure looked like a missing cache but the cache was fine.
  - Two open pages hold the OPFS SAH pool; the offline DB test must close the online page first or
    it reports `NoModificationAllowedError` (the existing one-tab limitation).
  - The update banner sits below neo dialogs; the first test clicked through the permissions
    modal and timed out. Test the banner on `/history/` (no prompt).
  - `same-origin-allow-popups` keeps the GIS popup but means production is not cross-origin
    isolated; do not claim multi-threaded local WASM on Cloudflare.
- **Verified:** check 0/0, build, worker tsc, SPDX 230, `scripts/cf-deploy.sh` dry-run; live
  root/`/history/` 200, manifest, service worker 200 with no-cache, live `_headers`, 133 shell
  entries, SQLite WASM cached, offline `History · onspot` with no wasm/SQLite errors, iPhone 14
  card/status bar. Update banner + Reload, dark/iPhone SE/iPad settings earlier.
- **Not verified:** real Apple device/Safari, Google Drive in the installed app (no web client id
  in this build), local models/audio on iOS, launch images/status bar on device, WebGPU local
  inference (omitted binary).
- **Next:** add the Worker origin to the Google OAuth client and set
  `VITE_GOOGLE_CLIENT_ID_WEB`; real-device pass; migration notice/period for GitHub Pages;
  Drive/WebDAV; local speech limits; CI secrets. The live URL is in README and platforms.md.

## 2026-11-06: brand v2 (tile-less icon, squircle and circle outlines)

- **Asked:** the logo looks too small in docks: drop the black background, make the symbol bigger,
  widen the spotlight so the wave sits higher and the whole mark can grow; two versions (squircle
  outline, circle outline); move every current brand asset (VectorCraft file included) into
  `brand-assets/v1/` and make the v2 assets in `brand-assets/v2/`.
- **Moved:** `git mv` of everything into `brand-assets/v1/`; references repointed (root README,
  Flatpak manifest `../../brand-assets/v1/app-icon.svg`, metainfo comment, `scripts/brand-assets.sh`
  `BRAND=…/v1`, AppHeader comment, `.gitignore`). The app still uses v1.
- **v2:** see `brand-assets/v2/README.md`. Material 192 grid; circle keyline 176, squircle 160 (equal
  area, v1's continuous corner scaled); outline 0.75 m Amber; 1 m clearance; centre of area on the
  canvas centre; one shared m = 39.076 px (tighter of the two fits). Mark: lamp 9 x 1.5 m, pool
  18 x 3 m, throw 12 m, wave axis 8 m (tallest bar on the pool's centre line). Logos: icon + v1
  wordmark, s = m, x-height 5 m centred on the wave axis, gap 2.5 m. Construction sheet 4200 x 1024.
  First made in amber (outline Amber, beam 75/32/8 %), then amended to monochrome (below).
- **How:** geometry solved in Python (`brand-assets/v2/source/geometry.py` + `construction.py`,
  reproduce the pasted SVGs byte for byte), pasted into VectorCraft (v1 document saved as
  `v2/onspot-brand.vectorcraft`, art cleared, 8 artboards, a layer each, `clipboard.importSvg` +
  `edit.pasteInPlace`; `data-name`s become object names), solid fills/strokes linked to the global
  swatches, exported per artboard. VectorCraft's SVGs render pixel-identical to the script's.
  MCP client: stdio JSON-RPC to `vectorcraft-cli mcp --connect 127.0.0.1:7979`, tool `run_command`.
- **Rejected on the way:** maximal fit (pushed the mark to the top, empty band below); bbox
  centring (pool looked low); 1 m outline (too heavy) and 0.5 m (vanishes at 32 px); wordmark
  x-height 8 m (letters outweighed the icon).
- **Amended (user: "i dont want colour … one for darkmode and the other for light mode"):** v2 is
  now monochrome. One ink per version, white `-dark` / black `-light`; beam and pool are that ink by
  opacity (dark 60/24/6, pool 45/10; light 45/18/4, pool 35/8: black reads stronger, and 75/32/8
  merged the lamp into the beam). Wordmark all ink. Both outlines kept in both modes (12 icon/mark
  /logo files + crops); construction sheet black on white with grey guides. VectorCraft document
  rebuilt (11 artboards with mode backgrounds; swatches `Dark mode ink` / `Light mode ink` in group
  `onspot v2`; v1's colour group deleted). Every SVG uses only #000/#fff; PNGs have 0 saturation.
- **Glyph (user: "a version that is just made up of shapes and no colours … any context"):** one
  compound path per file, `fill="currentColor"`: `glyph-mark`, `glyph-{squircle,circle}` (+ 1024 PNG,
  `-tile` crop). Design: solid lamp, beam = the silhouette's own 0.75 m edge (inset + minusFront in
  VectorCraft), solid pool, solid bars, outline stroke outlined, all united. Rejected: a solid cone
  with knocked-out bars (read as a lampshade/bucket); pool or hull as lines (read as a drum).
  Checked against an exact clip-path rendering from `geometry.py` (0 px differ at 50 % fuzz) and
  recoloured via `color` (black/white/grey). Gotcha: a regex `<path [^>]*?d="` matches the `id="`
  attribute; use `\sd="`. Construction sheet's VERSIONS row now shows the glyph too.
- **Glyph ground dip (user: the black ground and the black wave merge; "the black should be dipped
  down so that the wave poking in can fit. dont change the colour of the wave peak"; "the gap
  should be minimal"):** the pool now dips around bar 3 (the only bar inside it) with a 0.25 m gap
  (`GLYPH_DIP` in `geometry.py`; part "Dip (bar 3 + 0.25 m)", minusFront from the pool in
  VectorCraft). Rejected: XOR of bars and pool (user: don't change the bar's colour); 0.75 m gap
  (too wide); gaps around every bar (slivers between bars 2-4, read as drips).
- **Any colour (user: "why isnt there an svg version which can be programmed to be any colour or
  transparent?"):** every v2 SVG is now `currentColor`. Dark/light files keep their ink as the
  svg's `color` attribute (render unchanged: 0 px differ in resvg and librsvg); inline, CSS `color`
  recolours everything incl. the fades; `opacity` for translucency. New `source/finish_svgs.py`
  (run after every VectorCraft export, idempotent): currentColor, ids prefixed `onspot-<file>-`
  (VectorCraft names every gradient `linear-gradient-1`), empty artboard groups dropped, glyph
  reduced to one path, tiles written. Checked in headless Chrome. Gotcha: the same file inlined
  twice in two colours shares gradient ids, so the second copy's beam takes the first's colour.
- **In-app logo swapped to v2 (user: "use the app-icon-squircle-dark/light-tile.svg as logo inside
  the app. just do a quick swap"):** `static/app-icon-squircle-{light,dark}-tile.svg` (copies of the
  v2 tiles); `AppHeader.svelte` and `routes/welcome/+page.svelte` each have two `<img>`s,
  `dark:hidden` / `hidden dark:block`. Only those lines touched (another agent works in the tree).
  Then (user: paper background like the buttons; "use the circle version"; glare or shadow; the
  divider like the one before the session line): now `static/app-icon-circle-{light,dark}-tile.svg`
  (squircle copies removed) on `.logo-tile` in `app.css` (next to `.paper-grain`): the keys' card
  stock (`--key` + `--paper-key` grain + `--key-blend`), round, `--neo-box-shadow-raised-2` and a
  top-left radial glare (`--logo-glare`, warmer and fainter in dark). Header: a `.nav-divider mx-2`
  after the logo (8 px + the nav's 6 px gap = the row's 14 px around the existing divider). Not
  `.paper-key`: `+layout.svelte` already uses that class globally for the hidden texture source.
  Then (user: the symbol colour "not in line with the colour scheme of the ui"): the two static
  copies' `color` attribute is the app's `--brand` teal (`#0f766e` / `#2db3a3`), chosen over the
  text ink and the muted icon ink after comparing all three in the header. Gotcha: never write
  `--` (e.g. `--brand`) inside an SVG's XML comment; the file stops parsing and the img breaks.
- **Mode is the app's accent (user: Start speaking and the empty timeline's mic red in Exam, blue
  in Casual; then "the app's whole accent colour should be changed by this button"):**
  `practice.ts` mirrors `store.mode` into `<html data-mode>` (a store subscription, guarded for no
  `document`); `app.css` (after the dark theme block) has `:root[data-mode='exam']` and
  `:root[data-theme='dark'][data-mode='exam']` overriding `--primary`, `--primary-foreground`, `--ring`,
  `--accent(-foreground)`, `--brand`, `--brand-2/3`, `--brand-soft`, `--brand-hover` with the
  `--error` red (#c2412d / #ee7f6b) → rose. Casual has no block: it is the app's own aqua tokens
  (teal → cyan; user: "the blue accent should've been the aqua blueish colour", after a sky-blue
  Casual set was tried and removed). Start
  speaking and the empty mic already paint with `--brand`, so PracticeScreen is unchanged (an
  interim `--mode-from/to` edit there was reverted). The logo is now `<span class="logo-tile">` with
  two `.logo-ink` spans: the circle tile as `mask-image` over `--brand`, so it follows the accent;
  static copies are exact v2 copies again. Welcome page's `.setup-brand img` rule now targets
  `.logo-tile`. Checked via a CDP script (bun, headless Chrome; marks onboarding skipped, clicks
  the real Exam/Casual switch): `data-mode`, logo, nav ring, record button, empty mic, dialog
  accents all switch, both themes. svelte-check 0/0. Known: `app.html` ships `data-mode="exam"`, so
  a Casual user sees red until the store loads settings (the other agent is editing `app.html`).
- **Platforms (user: "make sure the webapp and the favicon and the icon for all the platforms are
  correct now"):** one platform icon = the in-app logo in light mode: circle icon in teal #0f766e on
  a #faf6ef card-stock disc with the keys' glare, transparent canvas. New
  `brand-assets/v2/source/platform_art.py` (not `platform.py`: that shadows Python's `platform`,
  which numpy imports) builds `brand-assets/v2/platform/` from the finished exports: `app-icon.svg`
  (+ `-1024.png`), `app-icon-tile.svg`, `android/` (foreground = mark alone at m = 3 dp, monochrome =
  glyph; no ring, the launcher draws the shape), `installer/` (sidebar/dialog/header/banner redrawn;
  DMG = v1 layout recoloured). `scripts/brand-assets.sh` now renders from v2 (tauri icon with
  `--ios-color #faf6ef`, Android background colour #faf6ef written to values/, installers, favicon
  `static/app-icon.svg`, the in-app tiles, then `scripts/pwa-assets.sh`). Edited the other agent's
  `scripts/pwa-assets.sh`: source = v2 master, opaque fills #faf6ef instead of Ink, "any" icons keep
  transparency, maskable = the Android foreground rendered at 614 px cropped to 512. Flatpak icon
  path + metainfo branding (#c9ddd5 / #1e4a43), README header. Checked every output (icns has all 12
  entries to 1024; ico 6 sizes; BMP3 installers; Android legacy/round/adaptive/themed; PWA; splash).
  Then (user: "the localhost version uses the old icon"): the server sent the new file; the user's
  browser is Zen (Firefox), which keeps favicons by URL past reloads. Versioned the URLs: `?v=2` on
  the favicon and apple-touch-icon in `src/app.html` (with a comment) and on the three manifest
  icons. Bump it whenever the icon changes (noted in the v2 README and brand-assets.sh's output).
  Favicon (`static/app-icon.svg`), desktop/Android/PWA icons, installers stay v1. Checked on the
  :5173 dev server in both themes (wide header, welcome page; phones show no header logo).
- **Not done:** the user has not picked an outline; nothing applied to the app, installers or
  Android. Not committed (the working tree also holds other sessions' uncommitted work).

## 2026-11-06: first-run onboarding + mode-coloured glare

- **Asked:** implement the two active ideas left in `docs/planning/ideas.md`: a first-run key
  onboarding flow and mode-coloured background glare.
- **Onboarding:** new `/welcome/` route (`routes/welcome/+page.svelte`) with three steps.
  - Coach: Groq (free, recommended), DeepSeek, ChatGPT/OpenAI, or a Claude/OpenAI-compatible
    gateway; key links, endpoint/model fields for the compatible options, optional Groq STT.
  - Key testing: `Test key` builds an endpoint and calls `testConnection` *before* writing anything;
    a failed key is never saved. `Skip the check` applies without testing.
  - Voice: on-device Piper vs ElevenLabs; the ElevenLabs key appears only for cloud, with the honest
    note that cloud TTS sounds better. The summary shows the final setup and links to the one-time
    local-data download.
  - State: `src/lib/onboarding.ts` stores `onspot.onboarding.v1` = `done`/`skipped`. The layout
    redirects first-run (after settings and Practice, when `llmConfigured` is false and the flag is
    null). Settings → Learning → **Setup guide** reopens it; Practice's LLM gate now goes there.
  - The guide uses paper/card styling, has no nav bar, works light/dark and at 390 px.
- **Glare:** `PracticeScreen` gets `data-glare` from the live mode: casual uses brand/brand-2/
  brand-3 (blue-green), exam uses error/destructive (red). The mode can only be switched in a
  draft, so the glare changes with that switch immediately; a started session locks it. Three large
  soft blobs sit low in the visible page and drift on 38s/46s/52s transform-only animations (stopped
  by reduced motion). Exam uses stronger colour (22/18/16%) than casual (14/12/10%) because red
  reads dimmer at the same alpha. The early "accent outside a session" state was superseded after
  the user asked for the switch to change the glare.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (224). Playwright
  onboarding suite 29/29: first-run redirect, provider cards, key field, conditional ElevenLabs key,
  summary, completion flag, Practice install gate, draft exam→casual→exam glare switch, boosted
  exam strength, drift animation and reduced-motion stop, seeded casual/exam sessions, Settings
  reopen, no repeat redirect. Light/dark/phone screenshots. Seed key configured so the existing
  feature/dark suites still bypass the guide.
- **Test gotcha:** the guide auto-redirects a fresh profile with no key; existing test profiles set a
  Groq key in an init script and therefore stay on Practice.
- **Not verified:** a live key test against each provider, a real ElevenLabs key, and the guide on a
  physical phone/desktop WebKit. Uncommitted on `fix/dark-mode-visual-depth`.

## 2026-11-06: iOS path decided (PWA); implementation brief written

- **Asked:** whether Rust would have suited onspot better than TypeScript (answered in chat, no
  changes), then how to support iOS without a paid Apple account, then a detailed agent prompt
  for it plus a reminder in the ideas list.
- **Wrote:** `docs/prompts/ios-focused-pwa.md` (the decision and why, the repo facts iOS touches,
  iOS claims to verify on a device, Phases 0–12, out of scope, verification, definition of done,
  questions for the user); an idea entry under Product in `docs/planning/ideas.md`; the
  `docs/README.md` prompts row; a decision in `decisions.md`; the roadmap's iOS line.
- **Not done:** no code, no testing on iOS. The user has not yet said whether they have an iPhone
  or Mac to test with; the brief asks first.

## 2026-11-06: dark-mode depth + translation note header

- **Asked:** create a branch and fix dark mode's low visual depth; light mode is the reference and
  has depth, dark mode reads like a global filter with weak separation. Then: in the translation
  note, put the variant tag and its toggle on the same line as the `Translation` header, text below.
- **Branch:** `fix/dark-mode-visual-depth` (carried the uncommitted feature work from `main`).
- **Diagnosis:** the dark paper texture rendered around `#2c2823`, not the token `#151412`, because
  its `colorShadow` was `#3d3830`; the attempt card was `#24211c` and the sheet `#1e1c19`, all within
  a couple of lightness steps. Black shadows were invisible, and a 72%-opaque frosted sheet let the
  blurred page flatten it further. The Feedback notebook was the raw page colour, reading as a hole.
- **Fix:** a real dark surface ladder (page `#12110f`, card `#24211d`, inset `#1a1815`, key
  `#332e27`, well `#0d0c0b`, border `#3d372f`); `--sheet-frost` 90%; darker page/key paper params;
  attempt card `#2b2721`; notebook `#24211d`; and subtle white catchlights (`--shade-light` 0.20,
  `--glass-shade-light` 0.18, lit top borders/highlights on cards and panels, header seams).
- **Translation note:** restyled from the user's sticky-note mockup (pastel paper, washi tape,
  folded corner, tilt, dashed header, dark ink tab, regular Courier Prime, handwritten wavy
  controls). The close X leads the header, so "Each word" is the rightmost control for a
  Word-for-word note; on phones the decorative mark is hidden so the longer label still fits. The
  dashed/dotted connector was replaced with one clean 1.5px line fading at both ends. Translation
  variants are pages: page 1 is the primary idiomatic translation, pages 2+ are the alternatives,
  shown one at a time with `‹ 1 / 4 ›` controls in the note header (reset on view change/regeneration,
  wrap, constant note height, no pager for a single rendering); the translation text is regular
  weight, the word pairs stay bold.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (221); feature suite 18/18;
  phone word-list suite; translation-header phone check (closed and open, same line, text below, no
  overflow); variant-pages suite 10/10 (pager in the header, default page 1/4 = primary, next 2/4
  and 3/4, previous returns, no height change, phone fits). Seeded light/dark screenshots of Practice, History,
  Insights, Settings, the note and pager. Dark contrast: foreground/card 13.6:1, muted 7.2:1,
  faint 5.8:1, brand 6.2:1, error 6.0:1, warn 8.3:1, good 7.4:1.
- **Test gotcha:** the scratch profile can reset between separate browser runs (OPFS lock/teardown),
  so seed and capture screenshots in one context; wait for the take's Translate button before
  screenshotting Practice, as DB hydration can take longer than 1.5 s.
- **Not verified:** real phone/desktop WebKit, full-page contrast scan. Uncommitted, per usual.

## 2026-11-06: five planning ideas implemented

- **Asked:** "understand the current state of the app" and implement the active ideas in
  `docs/planning/ideas.md`: the capability explainer, session transcript export, download
  notifications, practice reminders, and a vertical word-for-word mapping.
- **Built:**
  - `settings/WhatOnspotDoes.svelte` (Learning tab) — scope in two columns, plus an honest note on
    why accent/pronunciation are out.
  - `utils/sessionTranscript.ts` — `buildSessionMarkdown` + `exportSessionTranscript`; History row
    download action and Practice session-menu "Export transcript".
  - `platform/notifications.ts` — permission-aware, best-effort system notifications; used by
    `stores/languageData.ts` (completion/failure, 6 s toast + notification when hidden) and
    `stores/reminders.ts`.
  - `stores/reminders.ts` — off-by-default cadence (1 or 3 days), practice/activity clock in
    localStorage plus the newest saved session, snooze, interval/visibility checks, one system
    notification per due period; `settings/ReminderSettings.svelte`; banner in Practice's notice
    strip with Start speaking / Not now.
  - `AttemptCard.svelte` — vocabulary pairs as horizontal columns: source above a short rule,
    translation below, centred and reading left to right; wraps when needed.
  - Settings fields `practiceReminders` / `reminderFrequency`; `#reminders` and
    `#what-onspot-does` hashes; `initReminders()` after settings load.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (221). Playwright 18/18
  against the user's :5173 with a fresh profile: guide/reminder settings, a seeded 3-day gap makes
  the reminder due, the banner appears and can be put off, word columns read left to right with
  each pair stacked source/rule/translation, and a real export downloaded
  `onspot-reminder-test-2026-11-03.md` with both texts, corrections, translations and stripped
  explanation tags. Phone check at 390 px: all five pairs fit in one row, centres line up, no
  horizontal overflow. The user asked to see this on the phone and may revert phones to the
  earlier vertical list later.
- **Not verified:** a real model download's completion notification, a device system notification,
  and the Tauri save-dialog path.
- **Docs:** shipped ideas moved to `docs/planning/archive/ideas.md` under 2026-11-06; the active
  idea file then held the streak, onboarding, model-performance and mode-glare items (onboarding and
  mode glare shipped later in this same session).
- **State:** uncommitted, per the user's review-first preference.

## 2026-11-03 (README): API-key onboarding banner
- **Added a GitHub `> [!IMPORTANT]` banner** directly under the hero: onspot needs an API key before
  feedback works; the easiest path is a free Groq key, and ElevenLabs is optional and only for
  cloud text-to-speech. The banner links to a new **Get your keys (two minutes)** walkthrough and
  says the app shows **Set up LLM** / **Install data** instead of **Start speaking** until setup is
  complete.
- **New walkthrough:** exact Groq steps (`console.groq.com/keys` → create key → Settings → LLM →
  Test connection) and optional ElevenLabs steps (Settings → Text-to-speech → Cloud → ElevenLabs,
  premade voices on free plans). Both key-page URLs returned 200 when checked.
- **Reinforced elsewhere:** “Before you start” now names the free Groq key and optional ElevenLabs
  key; “First run” is five steps starting with the key; the developer requirements and run steps
  link to the same walkthrough. The “No account” badge is now “No onspot account” and a
  “Setup: free API key” badge was added.
- **British English** preserved. No code changed; uncommitted.

## 2026-11-03 (docs): planning split into active + archive
- **Audited `docs/planning` against the code and handoff.** Archived fixed bugs: the LLM gate before
  recording (2026-10-03) and wrong-language takes reading as clean (2026-10-03). Archived
  completed/rejected ideas: automatic model choice (2026-11-01), paper texture, Opus audio
  compression (2026-10-31), and the wllama/GGUF switch (rejected 2026-09-30).
- **New structure:** `docs/planning/ideas.md` and `bugs.md` are active-only, formatted with
  checkboxes and links; history lives next to them at `docs/planning/archive/ideas.md` and
  `bugs.md` under `## Archived 2026-11-03`, so all planning data stays under `docs/planning/`.
  This is the one exception to the global mirror rule, documented in `docs/archive/README.md`.
- **Active bugs left:** attempt-card spacing (current 28 px desktop gutter, 24–44 px card gap,
  12 px phone gutter) and session-language locking (`openSession()` restores mode/prompt but uses
  the global `targetLanguage` in `sessionPrompt`; no session language is stored).
- **Active ideas left:** capability explainer, transcript export, lighter STT, small multilingual
  local LLM, TTS credits, mode-coloured glare, vertical word-for-word mapping.
- **Updated:** `docs/README.md` planning row. Added `docs/planning/README.md` with the agent
  workflow: what belongs in each file, how to add an idea or bug, how to archive a finished item,
  formatting rules, and what not to put here. No code changed; uncommitted.

## 2026-11-03 (later still): contributor scaffolding, README preview, British English
- **Added (uncommitted):** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,language_request}.yml`,
  `.github/ISSUE_TEMPLATE/config.yml`, `.github/pull_request_template.md`, and a ready-to-paste
  `docs/releases/v0.2.3.md`.
- **README preview fix:** the icon was raw HTML inside the `#` heading, which some previews show
  literally, and the hero screenshot was a relative HTML `<img>` that the author's preview did
  not resolve. All README images are now Markdown images with absolute
  `raw.githubusercontent.com/khizardevelops/onspot/main/...` URLs; the title icon uses the 64 px
  PNG (`src-tauri/icons/64x64.png`). The original tagline ("The language learning app that makes
  you *speak*, then coaches you like a teacher.") was restored so the author's wording is
  preserved. The contributor docs are linked from the Contributing section; "run's artifacts"
  became "run's uploaded files".
- **British English:** all new docs use British spellings. The only remaining "License" strings
  are the official GNU licence name and the adjective "licensed"; pre-existing workflow filenames
  such as `upload-artifact` are untouched.
- **Not done (needs GitHub settings, not files):** repo description edit, enabling Discussions,
  creating labels, publishing the release notes. The earlier `gh` call was denied. The repo
  description still has the author's "inturn", intentionally preserved; only "langugae" should be
  fixed if the description is edited.
- **Not committed/pushed:** GitHub will not show the new templates or resolve the README links
  until these files are committed and pushed.

## 2026-11-03 (later): launch prep, README rewritten around the hook
- **Asked:** a public-showcase package: README hook for non-technical learners, posts for
  r/LanguageLearning, r/French, r/selfhosted, r/PrivacyGuides, Show HN and r/opensource, a
  pre/post-launch checklist, and a brutal launch-readiness verdict. No new languages, no code.
- **README rewritten (uncommitted):** hero now leads with "Stop tapping flashcards. Open your
  mouth.", a Download CTA to the latest release, user-facing badges, an early-release honesty
  note and "How a session works" moved above Screenshots. "Getting started" became "Get onspot"
  with **Option 1 — Download the ready-to-use app** (platform table, what you need, first-run
  steps, unsigned-build note) and **Option 2 — Build from source** (all previous dev details
  unchanged). Tech badges moved out of the hero; "Under the hood" stays after the dev section.
  Added "tutor costs money / classroom costs courage" to Why, French-first honesty to Languages,
  longer takes to Roadmap, and non-code contributions to Contributing. No existing detail was
  deleted; diff is +102/−39.
- **Corrected a false claim:** the README promised "up to five minutes"; `MAX_RECORDING_SEC` is
  still 60. The feature line now says 30–60 seconds and the roadmap lists longer takes.
- **Verified platform minimums:** `tauri.conf.json` macOS 10.15, Android minSdk 24 (Android 7).
- **Public repo findings (web_fetch):** repo description has typos ("langugae", "inturn"); 0 stars,
  0 forks, 0 watchers; Discussions returns 404 (not enabled); v0.2.3 release page has all assets
  but **empty release notes** (only "Full Changelog" repeated). No CODE_OF_CONDUCT, SECURITY,
  CONTRIBUTING, issue/PR templates, or `good first issue` labels exist yet.
- **Verdict given:** soft launch to French/privacy niches first, not a massive showcase. Main
  blockers: French-only, API-key onboarding, unsigned builds, no contributor scaffolding, no demo
  video, Windows/macOS installers not hands-on verified, empty release notes, 60 s cap.
- **No code changed.** The only file edited outside the handoff is `README.md`.

## 2026-11-03: v0.2.3 tagged, branches, README light first
- **Release:** test runs on main passed, so `Release 0.2.3` (29fe647) was committed on `main` and
  tagged `v0.2.3`. Tag runs passed (Desktop release 41545044315, Android APK 41545044160); the
  release is Latest with all 15 files, APK `onspot-0.2.3-29fe647-arm64.apk`.
- **"merge all branches":** nothing to merge. Every branch had 0 commits outside `main`;
  then "the github page should only have one main branch": `feature/language-delivery-mode`
  deleted locally and on GitHub. Work is on `main` now; four old local-only branches remain.
- **"why is an ios build not possible?":** answered (decisions.md "iOS is deferred": needs a Mac,
  `tauri ios init`, Apple signing via the $99 developer account for TestFlight; the web app in
  Safari works today).
- **README:** light mode first (hero and Screenshots, light open by default). The metainfo listing
  pointed at deleted `fr-light.png` / `jap-dark.png`; now practice/phone/history light. Takes effect
  in the Flatpak from the next release.
- **Console paste:** extension noise (MetaMask-style `contentscript.js` ObjectMultiplex, Grammarly
  injected twice) and neo-svelte 1.2.0's unconditional `console.info` on toast setup (latest
  version; not patched, offered). onspot's own line: SvelteKit 3 `goto_replace_state_deprecated`;
  `{ replaceState: true }` → `{ replace: true }` in `navigation/back.svelte.ts` and
  `textSize/TextSizeEditor.svelte`; check 0 errors, Back/Done 6/6 on :5173. Not committed yet.

## 2026-11-02: v0.2.2 released, then the user's phone list
- **Asked:** "go ahead with the procedure" (test build, bump, tag 0.2.2): done, see state.md
  "Release v0.2.2". "why do i have a seperate branch?": explained (it equals main; offered to
  delete it and four old local branches, all contained in main; no answer yet).
- **Then a list:** APK "still doesn't have the app icon" (the APK is right, device not reachable;
  asked for a screenshot / Android version / launcher, see state.md); swipe up on the bar to pull
  Feedback up; stats put away by a tap elsewhere, plus a pin to keep them; slow-drag flicker;
  per-section font size; one control for 0.75/1/1.25×; phone bar in two rows (prompt above,
  buttons below); word pop-up persisting over a buried card.
- **How:** three forks in worktrees (speed button :4181, text size :4182, pop-up :4183), each
  verified with Playwright on its own port, patches applied to the main tree and the worktrees
  removed; the bar, pull-up, stats and drag done here on :5173. Gotchas: `git apply --3way`
  refuses files whose working copy differs from the index (plain `git apply` applied by context);
  /tmp (5.8 GB tmpfs) filled up, so finished downloads were cleared from the scratchpad.
- **State:** all uncommitted (state.md first entry). Not committed or pushed: the user has not
  asked yet.
- **Then, with the phone connected over USB** (it disconnects now and then): the APK icon (Theme
  Park), tried every change on the device, profiled with a debuggable build over CDP (state.md
  "120 fps pass"), and the user's follow-ups: snappy neo animations and the stuck-pressed Feedback
  key (helper, merged), text size v2 (helper, merged), the select dropdown, shifted word meanings, at
  least 120 fps everywhere, and a full-screen live text-size canvas (helper running). Device tooling:
  `adb` + `scripts/android.sh build --apk --debug --target aarch64`, `adb forward tcp:9333
  localabstract:webview_devtools_remote_<pid>`, Playwright `connectOverCDP`; screenshots over CDP
  hang in the WebView, use `adb exec-out screencap -p`. The WebView starts 90 px below the top of
  the screen (status bar) at DPR 2.8125.

## 2026-11-01 (later): logo and app icon in VectorCraft
- **Asked:** turn the AI-generated draft logo into a mathematically exact logo and app icon, built in
  VectorCraft (headful, so the user could watch), using its MCP.
- **How:** the VectorCraft MCP is configured only for the `/home/khizar` project, so its tools were not
  loaded here. Launched the app with `flatpak run ai.storyteller.vectorcraft --control 7979` and drove
  `vectorcraft-cli mcp --connect 127.0.0.1:7979` over stdio from a small client (session scratchpad).
  Geometry computed in Python and sent as `command_batch` steps. Gotcha: the flatpak's `/tmp` is
  private, so file paths given to the app must be outside `/tmp`; a document swatch named "Amber"
  already exists (non-global), so new swatches with library names get renamed ("Amber 2").
- **Done:** see state.md "Brand" and `brand-assets/README.md`.
- **Then asked:** why the margin around the tile (Apple's macOS template; normal on macOS, small
  on Windows/Linux, wrong on Android/iOS). User chose the macOS master for every platform and asked
  to use the logo in the app: done (state.md "Brand"). Then the favicon looked too small: the web
  copy is now cropped to the tile (state.md). Then: README shows the icon (from `brand-assets/`),
  header mark enlarged to 36px. Committed, pushed (main + feature over SSH: the https remote has no
  credentials), tagged v0.2.0; all CI green; README icon beside the title; screenshots retaken.
- **Then:** Flatpak "endless loop" = Bazaar UI bug after a successful install. The AppImage's
  maximise/restore glitch = bundled old GTK on Wayland → X11 inside AppImages. Custom thin title bar
  (WindowBar). Both uncommitted, waiting for the user's hands-on check (tasks.md).
- **Then:** Automatic model choice (decisions.md) and the "Did you mean" Show/Hide changes
  toggle (parallel agent); committed and pushed with the title bar. Then a speaker button in the
  selection meaning bubble (uncommitted).
- **Tooling that worked:** KWin scripting over `qdbus6 org.kde.KWin /Scripting` (absolute script
  paths; `print` lands in the user journal) to maximise/restore/raise windows without focus, and
  `spectacle -b -n -f` (captures at 2x; DP-1 0,0 and DP-2 1920,0 are 1920x1080). xdotool input is
  blocked by KDE's Remote Control prompt.

## 2026-11-01: long takes, rate limits, packaging, many UI fixes
- **Asked (in order):** simulate 3/5-minute takes; design for long takes (3-state fold, fixes-only
  "Did you mean", dynamic feedback width, follow-up meanings); AppImage + Flatpak; translations not
  persisting; meanings bubble without French; selection "I preferred"; Groq 429 → pacing, model
  rotation, chunking; on-device TTS `bad_alloc` on long takes; numbered fixes list; scroll window;
  hide translation; compact, colour-coded, aged feedback cards; no auto translations; app speed.
- **Done by agents:** card UX (fold, `correctedPassages.ts`, `CorrectedPassages.svelte`), feedback
  width (`narrowestWidth.ts`), packaging (Tauri CLI 2.12.4, `bundleMediaFramework`, `packaging/`
  Flatpak + scripts, release.yml flatpak job) + recorder fallback, on-device TTS for long texts
  (sentence pieces, streamed), UI speed (state.md "UI speed"; reviewed and re-checked here with
  `perfreview.mjs`: panel slide, menus unmounted, oldest card built, Settings rows, desktop + phone).
- **Then:** new README screenshots (state.md), macOS release fix (tasks.md), committed and pushed
  `feature/language-delivery-mode` and `main` over SSH; CI watched (state.md).
- **Before that:** the TTS agent's three findings fixed here (priority queue, idle worker shutdown, settings
  chosen while loading) plus preparation gating/stopping and the peak ceiling (state.md).
- **Done here:** translation-set and gloss parsing fixes in `SqlDatabaseAdapter`/`export.ts`, the
  rest listed in state.md (2026-11-01 blocks) and decisions.md.
- **Verified:** check 0/0 (before the last edits), mocked and live Groq runs (scripts in the
  scratchpad: `pacingtest.mjs`, `sections.mjs`, `sectionlive.mjs`, `longlive.mjs`, `evalquality.mjs`),
  screenshots light/dark/phone (`fbcards.mjs`, `numbered.mjs`, `hidenote.mjs`).
- **Not verified:** Tauri/WebKitGTK and Android for today's UI; real microphone with the recorder
  fallback; GitHub Actions run of the new flatpak job. Nothing committed.

## 2026-10-31: card stack + paper timeline
- **Asked:** make the card scrolling look like the user's HTML demo (stack of index cards dropping
  from behind the header, delayed blur) and add its aged-paper timeline; TypeScript; keep the
  demo's scroll math and the 0.35 bury delay.
- **Done:** `components/cardStack.ts` (math), `components/PaperTimeline.svelte`, `AttemptStream.svelte`
  rewritten (old conveyor, rAF fallback, floor spacer, `tall` class removed). Fonts
  `@fontsource/caveat` + `@fontsource/courier-prime` added (`package.json`/`bun.lock`, imported in
  `app.css`). Deviations from the demo and why: see decisions.md (lock onto a card, top card =
  selected take, depth fade, drop-shadow filter, position-space arrival).
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (176). Headless Chromium
  against the user's :5173 with the scratch profile (12 extra takes seeded into its OPFS DB by copying
  a real take; two real fake-mic takes recorded via Groq with ElevenLabs blocked, so no ElevenLabs
  characters spent). Scripts in the session scratchpad (`stack.mjs`, `snap.mjs`, `swipe.mjs`,
  `arrival.mjs`, `long.mjs`, `wordselect.mjs`).
- **Not verified:** Tauri/WebKitGTK; a real mouse wheel and trackpad (Playwright's wheel is precise
  pixels; real notches go through the same lock).
- **Follow-up: timeline hover loop + phones.** User: "hover over the timeline component is buggy…
  fix the hover loop… the whole app needs to work on a mobile phone too". Static hover area, tap to
  open on touch, slim strip on phones (see decisions.md).
- **Follow-up: top bar instead of the rail.** `AppHeader.svelte`, `stores/theme.svelte.ts`; layout
  rail, floating phone menu and rail paper removed; pages wrapped in a flex column with the bar.
- **Follow-ups (later):** translation UI restyled as notes on the card; scroll direction unified
  (down = older takes, the top card lifts up); card tilt range narrowed. One real take recorded via
  Groq for the arrival check (ElevenLabs blocked).
- **Follow-ups (same day):** page gutter (cards touched the window edge after the rail went), Feedback
  tab labels clipped (line-height), paper index cards, phone layout (timeline/Feedback buttons in the
  bar, compact composer, mode in ⋯), smaller touch buttons, compact top bar. See state.md top.
- **Follow-up: highlighter selection.** "The selection highlight should be like an actual
  highlighter": `Transcript.svelte` inks selected words (see decisions.md); `wordSelection.ts` gained
  `selectedWordRange`, now also used by `transcriptMeanings`. Check/build/spdx pass.

## 2026-10-30: spoken explanation, ElevenLabs voice fix, usage monitor
- **Asked:** (1) attempt card with three TTS tracks and their text: transcription, correct version,
  explanation (compact, in the language of instruction, highlights); (2) mid-session: "why are voices
  that are not free even in the list" (HTTP 402 paid_plan_required); (3) mid-session: a proper usage
  monitor, per model or per account as the provider limits it.
- **User decisions:** build **cloud-first**; local explanation audio is the user's own follow-up.
  The correct version "is essentially the natural version but faithful to what the user is trying
  to say; the card should say 'did you mean to say?'". The explanation auto-plays.
- **Explanation:** prompt adds `explanation` (≤60 words, ≤3 most important mistakes, follow-up
  question in the target language, every target-language span tagged). `explanation.ts` parses,
  normalizes (drops unknown/unclosed/nested tags and markdown) and speaks it tag-free. Migration 7
  adds `attempts.explanation` and copies `summary`; `naturalSpeech`/`summary` no longer read or
  written. New components `AttemptTrack.svelte`, `ExplanationText.svelte`; `playAttemptTrack(id,
  'said'|'corrected'|'explanation')` replaces `playAttempt`; audio kinds `said/corrected/explanation`
  replace `attempt`. `utils/words.ts sameWords()` ignores case, punctuation and apostrophe style.
- **ElevenLabs:** the old ids now resolve to other paid library voices (Rachel id → "Janet"); see
  decisions.md. `elevenLabsAccount.ts` reads plan + allowance (shared by the voice list and usage).
- **Usage monitor:** `src/lib/usage/` (ledger, rateLimits, publishedLimits, monitor, format);
  instrumentation in the LLM client, Groq Whisper, ElevenLabs and OpenAI adapters; Settings → Usage
  tab; Practice notice. `utils/hash.ts` now holds the FNV hash (moved verbatim from the TTS cache).
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (169). Headless Chromium
  1243 against the user's :5173 dev server with an isolated scratch profile (keys injected from
  `~/.keys`, never printed): fake-mic takes (ElevenLabs-generated French with "j'ai allé") went
  through Groq STT → GPT-OSS → card; explanation auto-played; all three tracks played via
  ElevenLabs (200); local-TTS fallback; Usage tab real figures; injected refusal → red gauge and
  Practice notice; 390px and dark, no overflow or page errors. ElevenLabs free tier went from
  843 to ~2 300 of 10 000 characters during testing.
- **Follow-up (same day): per-model Groq usage.** The user: limits differ per Groq model; show usage
  per model with the model in use selected by default. The LLM card now has model chips (the app's
  Groq list + Groq's published chat models + called models; in-use marked and default; resets to the
  in-use model when Settings changes it). `publishedLimits.ts` now carries Groq's Free and Developer
  tables (scraped from the docs page's embedded `rows`/`devRows`); Developer applies when live
  headers show a higher daily request ceiling. `isChatModel()` is exported from the LLM client.
  Verified in the browser (default, pick 20B/Compound Mini, Settings → Qwen 3.8 and back, phone).
- **Follow-up: clipped processing details.** Expanded capability rows cut off control shadows on the
  right; fixed in `CapabilityRow.svelte` (see bugs.md). The dev server served the new CSS module
  (`?svelte&type=style&lang.css`); a grep of the JS module is the wrong staleness check for styles.
- **Follow-up: "why show paid voices on a free key?"** Cause: a restricted key cannot read its plan
  (so nothing was filtered) and a previously saved library voice stayed selected. Now: library voices
  only when the plan is known paid; `PaidPlanVoiceError` from the adapter is caught in
  `synthesizeSpeech`, recorded per key (`stores/elevenLabsVoice.ts`), the voice switched to Alice,
  and the call retried; the picker swaps a saved voice the plan certainly cannot use.
- **Follow-up: translated follow-up question.** User wants the follow-up separate, with its
  translation hidden until tapped. `followUp: { question, translation }` in the LLM schema, migration
  8 (`attempts.follow_up`), `ExplanationText.svelte` renders a Follow-up block with a "Show English"
  chip; `separateFollowUp()` lifts old `<ask>` questions out; the model's stray `<ask>` is lifted too.
- **Follow-up: "You said X. Say X — is the prompt broken?"** Partly: free-text explanations can't be
  validated. Now structured mistakes + `composeExplanation` (see decisions.md). Harness:
  `bun --preload <scratch>/lib-alias.ts` resolves `#lib/*.js` → `.ts` for running project modules
  under bun (Groq calls spaced 40 s: one evaluation reserves ~4.8k of the 8k TPM).
- **Follow-up: auto-play "frictionless".** It already auto-played, but refusals were swallowed and
  WebKit needs a per-element gesture; primed in Start/Stop, refusals now shown (see decisions.md).
- **Follow-up: "reads like a report".** The model now writes a natural `line` per mistake and an
  opening `note`; the app validates and falls back only when a line fails. Live: "Nice description of
  your trip! You said à le du York, but you should say à New York because city names don't take
  articles in French." Prompt examples changed (Paris, not New York) after the model copied one.
- **Follow-ups: replay the follow-up; hover a word for its meaning.** New track kind `followUp` with a
  play button in the Follow-up block. Hover meanings: `glossary.ts` + `ensureWordGlosses()` +
  `Transcript` hover/tap + `WordGloss.svelte`; migration 9; `@floating-ui/dom` added as a direct
  dependency (was transitive via `@skeletonlabs/floating-ui-svelte`). Verified: first hover one LLM
  call, then instant; reload → from DB; phone taps; single label.
- **Follow-up: custom ranges / compound words ("le temps", "pomme de terre").** Expressions from the
  gloss call + native-selection ranges (`translatePhrase`, `ensurePhraseMeaning`); hover logic moved
  to `transcriptMeanings.svelte.ts`; `WordGloss` takes a virtual anchor + placement + detail line.
- **2026-10-31: word-granular selection** (`wordSelection.ts`, wired in `Transcript.svelte`,
  `transcriptMeanings` reads finished/snapped selections). The machine rebooted overnight and `/tmp`
  (tmpfs) lost the scratch profile, clip and helper scripts; a fresh profile + one take was recorded.
- **Test tooling note:** Playwright 1.64 lives in `~/.npm/_npx/e41f203b7505f1fb`; use
  `executablePath` `~/.cache/ms-playwright/chromium_headless_shell-1243/...` (1.64 wants 1248).
  Import the app's own store instance via `performance.getEntriesByType('resource')` (HMR `?t=`
  URLs) and wait for `settingsReady` before `setSetting`.

## 2026-10-30 (research only): Groq limits and a five-minute take
- **Reported:** `openai/gpt-oss-safeguard-20b` returned HTTP 413 "Request too large … TPM: Limit
  2000, Requested 2214" on the free (`on_demand`) tier. The 2026-09-14 probe recorded 8 000 TPM for
  it; Groq's rate-limit page now lists it at 3 RPM / 2K TPM. A 413 means one request is larger than
  the whole per-minute budget, so waiting never helps. It is a safety classifier and
  `NON_CHAT_MODEL` already hides it from the dropdown.
- **Measured:** the evaluation prompt alone is ~5.8k chars (~1.5k tokens) with an empty
  transcript, ~6.5k at 60s and ~9.2k (~2.3k tokens) at 300s of speech.
- **Live sources:** Groq `GET /openai/v1/models` (per-key list with `active`, `context_window`,
  `max_completion_tokens`); `x-ratelimit-limit-tokens` = TPM, `-limit-requests` = RPD, plus
  remaining/reset and `retry-after` on 429. No documented endpoint returns rate limits. ElevenLabs
  `GET /v1/models` returns `maximum_text_length_per_request`.
- **Static facts (docs, 2026-10-30):** Groq STT max file 25 MB free / 100 MB dev, min billed 10 s,
  `prompt` ≤ 224 tokens; free STT 20 RPM, 7.2k audio s/hour, 28.8k/day. Groq Orpheus TTS: 200
  chars per request, English and Saudi Arabic only, WAV only.
- **Not changed:** no code. Open decisions are in tasks.md under "Cloud limits for five-minute takes".

## 2026-10-25 (voice picker modal): the TTS voice list is no longer a dropdown
- **Reported:** the detailed TTS voice dropdown was too much content for a popover. A real
  ElevenLabs account can hold 100 voices, each with a metadata line, so it covered the section.
- **Fix:** new `components/settings/VoicePicker.svelte`. The Settings row keeps a compact trigger
  (selected name + one detail line); clicking it opens a **modal** with a title, a search field
  (only above six voices), a scrollable option list, and a footer holding the section's own actions
  (Preview `VoicePreview`, Refresh voices) plus Done. All three branches (Piper, ElevenLabs, OpenAI)
  use it, so `SettingSelect` is no longer involved for voices.
- **Layout:** header/search/footer are `flex: 0 0 auto`, the list is `flex: 1 1 auto` with
  `overflow-y: auto`; the dialog caps at `min(38rem, calc(100dvh - 4rem))`. Verified with 12 voices
  at 1280×1000 and 390×600: the list scrolls, the footer stays put and Done remains visible.
- **Keyboard:** ArrowUp/Down/Home/End walk the options (Home/End are left to the text field while
  searching). The search field auto-focuses **only on a fine pointer**; on a coarse pointer
  (Pixel 7 emulation) it stays on the close button so no keyboard covers the list. neo's dialog
  focuses its first control after a 100ms debounce, so the focus call waits ~130ms and backs off if
  the learner has already moved on.
- **Contrast:** the 12px detail line used `--muted-foreground`, which measured 3.91:1 on the tinted
  selected row and 4.45:1 on the plain row in light mode. Both the option detail and the trigger
  detail now use `color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground))`:
  7.65/8.7 (light selected/plain) and 8.55/9.93 (dark), trigger 8.79/8.96.
- **Test-infra note:** the dev server had gone stale (the file changed but Vite kept serving the old
  module) and produced a false negative on the trigger markup. Restart it if an edit seems not to
  apply; the /mnt/data/synced mount can miss watcher events.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (156 files); browser
  suites for the modal (open/search/empty state/select/Done/close), preview requests, keyboard
  navigation, chevron bounds at 320–1440px, both settings trees and the Practice gate, in light and
  dark, at desktop and phone widths, with no page errors or overflow.

## 2026-10-25 (settings bug pass): chevrons, voice dropdowns, startup hydration
- **Chevron overflow (reported):** above 640px the row header is `flex-direction: row`, and the
  controls flex item shrank below its content width, painting the disclosure chevron outside the
  frosted card. `CapabilityRow.svelte` now gives the text column `flex: 1 1 auto` with `min-width: 0`
  and pins the controls with `flex: 0 0 auto`. Measured at 320/375/390/640/768/1024/1440: the icon's
  right edge is inside the content box at every width.
- **Detailed voice pickers:** local Piper, ElevenLabs and OpenAI voices became dropdowns instead of
  chip rows (superseded by the modal entry above; the detail lines survive there unchanged). Each
  option carries a second line: Piper shows its download size/sample rate, ElevenLabs
  combines `language · accent · gender · age · use_case` and the voice description, OpenAI shows the
  voice character. A saved ElevenLabs id that is not in the account list is kept as an option;
  the six built-in library ids (e.g. `21m00Tcm4TlvDq8ikWAM` → Rachel) are named instead of showing a
  raw id. With a key present, the account voices load once automatically; failures stay silent and
  leave the manual Refresh button.
- **Preview from the text-to-speech section:** an inline Preview/Pause button next to the cloud
  voice picker, disabled until that provider is fully configured (superseded: Preview now lives in
  the picker modal footer and only the local branch keeps the standalone preview card).
- **Settings hydration bug (found while testing):** `initSettings()` ended with an unconditional
  `store.set(loaded)`, so a choice made while the database was still being read was silently
  reverted to the stored value (this made a phone test flaky and could drop a real user's first
  click). Settings now records fields changed before hydration, merges them over the loaded
  snapshot, and skips persistence for the hydration write itself.
- **Server-side detail:** `listElevenLabsVoices` now also reads `description`, `age` and `use_case`
  labels.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check` (155 files), and browser
  suites at 320–1440px for chevron bounds, both settings trees, Practice gate routing, detailed
  dropdowns on desktop/phone, and ElevenLabs/OpenAI preview requests (mocked: `noah-id` and
  `voice: nova` reached the adapters). No page errors or horizontal overflow.
  **Not verified:** live ElevenLabs/OpenAI keys and a real local speech server.

## 2026-10-25 (later): per-step Settings accordion + product names (branch `feature/language-delivery-mode`)
- **Names:** the app uses **Speech-to-text**, **LLM** and **Text-to-speech** in the Settings rows,
  Practice gate, first-run picker, attempt-card menu and provider error copy. Internal code names
  (`sttMode`, `correctionMode`, `ttsMode`, `TranscriptionSettings`, …) are unchanged.
- **No global preset:** removed Balanced/Cloud/Private. Settings is two tabs (Learning / Data); the
  Learning tab has the language card and three independent rows, each with a Local/Cloud segmented
  control, a status line and a chevron. Details live inside a `0fr`/`1fr` grid disclosure that keeps
  the components mounted (neo 1.2.0 cleanup bug); the inactive detail is `inert`, only one row is
  open, and changing a mode opens that row. The shared row shell is
  `components/settings/CapabilityRow.svelte`.
- **First-run:** after the language, the picker asks for the three Local/Cloud choices separately;
  defaults are speech-to-text local, LLM cloud, text-to-speech local. It shows only the download
  estimate for the local steps.
- **Footer:** “N steps left” with the capability names, “Set up &lt;capability&gt;” for a missing key
  or local server, “Install &lt;size&gt;” for missing local data, progress/cancel, and the data-flow
  line.
- **Hash links:** `#speech-to-text`, `#llm`, `#text-to-speech`; legacy `#transcription`,
  `#ai-provider`, `#voice` still focus the matching row. Practice uses the new targets.
- **Verified:** `bun run check` 0/0, browser test at 1280/390 (independent rows and modes,
  all-cloud = no install, all-local = 363 MB install, disclosures, no page errors, no overflow).
  Not verified: a live ElevenLabs key, a real local LLM server, and the Tauri desktop runtime.

## 2026-10-25: per-capability processing + ElevenLabs (branch `feature/language-delivery-mode`)
- **Product change:** transcription, correction and read-back are independent device/cloud choices.
  The first iteration used three tabs (Language / AI & voice / Data), a processing matrix and
  presets; superseded by the per-step accordion above. The Practice gate and the local-download
  logic share one requirement model.
- **Correction:** cloud LLM by default, plus a **local OpenAI-compatible server** (LM Studio,
  llama.cpp, Ollama). The key is optional; `chatCompletion`/`listModels` no longer reject empty
  keys, and the LLM client uses `@tauri-apps/plugin-http` on desktop so local servers need no CORS.
  Browser local servers still need CORS; the note says so.
- **Read-back:** **ElevenLabs** and **OpenAI-compatible** both stay. Separate keys/model/voice
  fields mean switching preserves both. ElevenLabs uses `xi-api-key`, `eleven_multilingual_v2`
  (or turbo v2.5), `mp3_44100_128`, and `GET /v2/voices` for the picker; MP3 decoded with
  `AudioContext`. The OpenAI adapter gained a configurable base URL and optional key, so a local
  speech server works too.
- **Downloads:** `languageData.ts` now downloads only the local parts the choices need. Balanced
  shows 363 MB (Whisper + Tom); Cloud shows no download; a mixed setup downloads only the missing
  part. The first-run language picker initially offered Balanced/Cloud/Private; replaced by three
  per-step choices.
- **Settings polish:** contextual cards, presets, data-flow line (ElevenLabs vs OpenAI vs local),
  requirement count and "Set up keys" routing into the right AI subsection. Phone (390px) has no
  horizontal overflow.
- **neo trap:** `NeoSelect` sets state in its cleanup and Svelte throws `state_unsafe_mutation` if it
  unmounts during a tab/mode switch. Tab content and correction/read-back branches stay mounted and
  are hidden with CSS; transient model/voice pickers are a text input + fetched chips, not a
  swapped-in select.
- **Verified:** `bun run check` 0/0, browser suites for the first matrix/presets, cloud-only vs
  mixed downloads, ElevenLabs/OpenAI switching + reload persistence, keyless local LLM against a
  mock server (model list + connection test), Practice gate routing, 390px layout, no page errors.
  **Not verified:** a live ElevenLabs key, a real LM Studio/llama.cpp/Ollama server, and the Tauri
  desktop local-server path.

## 2026-10-25: Phase 3 BYOC sync + inception closeout (branch `feature/byoc-sync`)
- **Scope:** completed the only unimplemented inception phase (Google Drive + WebDAV) and the
  brief's remaining platform/licensing items.
- **Sync core:** `src/lib/adapters/sync/` (`types`, `service`, `http`, `google/oauth`,
  `google/drive`, `webdav`, `index`). Whole-database snapshots; manual sync; upload is automatic
  when only local content changed, a download always asks.
- **Change detection:** a byte hash was tried and **does not work** — three exports of an unchanged
  DB differed at the SQLite header change counter and in free pages. Replaced with a monotonic
  device-local revision (`src/lib/adapters/db/revision.ts`), bumped by every adapter write and
  deliberately not by `setSyncMetadata`. Verified: first upload → second sync `up-to-date`; a
  Settings change → upload; a remote touch → `needs-choice`; both changed → `needs-choice`.
- **Safety:** downloads go through `importSqliteBytes()` and keep the existing header check,
  quota pre-check and rollback. Added `isOnspotDatabase()` (schema-text scan) for the native path,
  which had no validation before.
- **Google Drive:** `appDataFolder` + `drive.appdata`; desktop uses a Rust loopback listener +
  PKCE (`src-tauri/src/oauth.rs`, three tests: callback parsing plus a real loopback request);
  web uses Google Identity Services because a public web client cannot exchange a code without a
  secret. Resumable upload. Build-time `VITE_GOOGLE_CLIENT_ID_DESKTOP/_WEB` (`.env.example`).
  **Not run against a live account** — no client ids/account were available.
- **WebDAV:** browser `webdav` package (CORS required) and a native Tauri HTTP transport
  (`webdav@5` hard-wires its own fetch). Verified in Chromium against a local WebDAV server:
  connect, first upload, no-op, remote-only conflict, cloud restore, keep-device upload, and a
  corrupt remote rejected with the local DB intact.
- **UI:** Settings → Cloud sync (`SyncSection.svelte`, `SyncConflictDialog.svelte`) with provider
  choice, Google connect, WebDAV fields, Test connection, Sync now, last-sync time, accurate
  conflict titles, and scrollable errors. Google is hidden/disabled on Android and iOS.
- **Platform/licence:** AGPL SPDX headers on 145 source files (`scripts/spdx.mjs`, `bun run spdx`
  / `spdx:check`); `.github/workflows/release.yml` builds Windows `.exe`/`.msi`, macOS `.dmg` and
  Linux packages; `docs/architecture/sync.md` + `platforms.md` (iOS blockers). Added
  `@tauri-apps/plugin-http` / `plugin-opener` and the matching Rust plugins.
- **Verified:** `bun run check` 0/0, `bun run build`, `bun run spdx:check`, `cargo check`,
  `cargo test --lib` (3 OAuth tests), and the browser suites above. **Not verified:** a live Google
  account, Tauri desktop CSP/HTTP/OAuth at runtime, a real Nextcloud, the Tauri `.sqlite`
  export/import round trip, and iOS (deferred).

## 2026-10-06: switched to bun (package manager only)
- `bun.lock` replaces `package-lock.json` (migrated; all top-level versions identical). Scripts,
  Tauri before*Commands, `scripts/android.sh`, `repomix/bundle.mjs` and CI now use bun/bunx.
  Verified: `bun install --frozen-lockfile`, `bun run check` (0 errors), `bun run build`,
  `bunx tauri --version`, `bun run bundle -- settings --dry-run`, `bun run android env`.
  Not yet verified: `bun run tauri dev` window (port 5173 held by audionix) and the CI run.

## 2026-10-06: branches merged into main
- `main` fast-forwarded to `feature/native-speech` (SvelteKit 3 migration → WebGPU spike →
  native speech). `main` is the working branch again; the feature branches are fully contained
  in it. Not pushed to GitHub (`main` is ahead of `origin/main`).
- `npm run dev` on the old `main` failed with `config_file_unsupported` because node_modules held
  SvelteKit 3 while `main` was still SvelteKit 2. After switching across the migration, run
  `npm ci`.

## 2026-10-04: native speech plugin architecture (branch feature/native-speech)
- Commits: speech code moved into `src/lib/speech/{stt,tts}` (−844 lines, dead lab code gone);
  `LocalSttEngine` interface + `localEngine.ts` + `platform/runtime.ts`; Rust workspace with
  `src-tauri/plugins/speech` (whisper.cpp); thread tuning; Android NDK wiring
  (`scripts/android-cmake/`, env in `scripts/android.sh`); Android fixes (TLS roots, JSON PCM body,
  string errors); GPT-OSS reasoning_effort=low.
- Verified: desktop app end to end via tauri-driver (`/mnt/data/not_synced/dev-cache/tools/bin/
  tauri-driver`, needs the `gcc` linker env to install); phone debug app (`app.onspot.desktop.debug`,
  installs beside release) end to end: Settings download → mic recording of laptop-played French →
  native transcription → Groq feedback. Numbers in docs/benchmarks/stt.md.
- Not done: Vulkan GPU (needs `vulkan-headers` on this machine; user asked to install), release
  APK size check, GGML_NATIVE for shipped desktop builds, CI (`.github/workflows/android.yml`
  needs cmake/clang; untested), merging the branch.

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
