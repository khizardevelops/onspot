# Prompt: onspot on iPhone and iPad as a PWA

> Written 2026-11-06 for the agent that will build iOS support. Give it this whole file.
>
> It records a decision that is already made (iOS ships as an installable web app, not through the
> App Store) and everything known about the work so far. Every repo fact below was checked on
> 2026-11-06; re-check any that the code may have moved on from. Claims about Safari and iOS that
> are marked **verify** come from general knowledge, not from a test on this project: confirm each
> one against current WebKit documentation and on a real device before you build on it.
>
> **Update 2026-11-06:** the PWA is deployed at
> **https://onspot.khizardevelops.workers.dev** as Cloudflare Workers static assets, built with
> `scripts/cf-deploy.sh` and `cf deploy --prebuilt` (`cf` cannot build SvelteKit directly). The
> Cloudflare Pages host plan in Phase 1 was superseded; see `docs/architecture/platforms.md`.

## Your task

Make onspot work properly on iPhone and iPad as a **Progressive Web App**: the existing static
web build, installed from Safari with **Share → Add to Home Screen**, opening full screen like an
app, working offline once its language data is downloaded, laid out for iPhone screens and
touch, and honest about what iOS does not let a web app do.

Work through the phases below in order. Stop at every **Ask the user** point and wait for an
answer. Do not write code until you have finished **Before you start**.

## The decision, and why (do not reopen it)

- onspot is free. The App Store, TestFlight and a Tauri iOS build all need a paid Apple Developer
  account (99 USD a year). The author will not pay for one.
- Free sideloading (Xcode with a free Apple ID, AltStore, SideStore) expires every 7 days and
  allows 3 apps. That suits enthusiasts, not learners.
- The EU's alternative app marketplaces still need the paid account.
- Apple's fee waiver covers nonprofits, schools and government bodies, not individuals.
- onspot is already a 100% client-side SvelteKit SPA (`@sveltejs/adapter-static`,
  `fallback: 'index.html'`) deployed to GitHub Pages, so a PWA reuses the whole app.

The decision is recorded in `.agents/handoff/memory/decisions.md` ("iOS ships as a PWA",
2026-11-06). If something you learn changes it, tell the user before you change course.

## Before you start

1. Follow `AGENTS.md`: read `.agents/handoff/README.md`, then every file in
   `.agents/handoff/memory/`, `.agents/handoff/rules/` and `.agents/handoff/references/`. Treat
   `state.md`, `tasks.md` and `last-session.md` as the current session state.
2. Read `docs/planning/README.md`, `docs/planning/ideas.md` and `docs/planning/bugs.md`.
3. Read these in full. They are the parts iOS touches:
   - `vite.config.ts` (cross-origin headers, `BASE_PATH`, the SvelteKit options)
   - `.github/workflows/pages.yml` (the current web deployment)
   - `docs/architecture/platforms.md` and `docs/research/model_problem.md`
   - `src/app.html`, `src/routes/+layout.svelte`, `src/app.css`
   - `src/lib/platform/` (`runtime.ts`, `notifications.ts`, `backButton.svelte.ts`)
   - `src/lib/speech/audioFormat.ts`, `src/lib/utils/audio.ts`, `src/lib/stores/audio.ts`
   - `src/lib/speech/stt/localEngine.ts`, `src/lib/speech/stt/transformers/pipeline.ts`
   - `src/lib/stores/languageData.ts`, `src/lib/stores/reminders.ts`, `src/lib/stores/settings.ts`
   - `src/lib/adapters/db/sqlite.worker.ts`, `src/lib/adapters/db/index.ts`, `src/lib/utils/storage.ts`
   - `src/lib/adapters/sync/google/oauth.ts`, `src/lib/adapters/sync/webdav.ts`
   - `src/lib/components/PermissionsPrompt.svelte`, `src/lib/navigation/back.svelte.ts`
4. Ask the user the questions in **Questions for the user** at the end of this file.

## Project rules you must keep

These come from the handoff rules and the author's standing preferences. Read the sources; this
is a reminder, not a replacement.

- **Package manager is bun** (`bun install --frozen-lockfile` after switching branches).
  SvelteKit 3: there is no `svelte.config.js`; kit options live in `vite.config.ts`. Import with
  `#lib/...`.
- **Never start a second dev server on :5173.** The author's server runs there; a second one
  breaks their dependency cache. Use theirs, or `bun run preview` on :4173 for production-build
  checks (preview already sends the cross-origin headers).
- **Code a careful human would write** (`.agents/handoff/rules/style.md`): descriptive names,
  named constants with a comment when a value came from a measurement, one step per line, blank
  lines between steps, a doc comment on every exported function, explicit error handling with a
  message the learner can act on. No speculative layers, no duplicated helpers, and delete what
  you replace in the same change.
- **Use well-maintained libraries and platform APIs** rather than hand-writing what they already
  do. UI comes from `@dvcol/neo-svelte`; do not hand-roll a widget it provides.
- **Mobile first.** Every feature must work at 390 px with touch. Do not hide a feature on phones
  unless iOS truly cannot do it, and then say why in the UI.
- **Never instrument production code for a test or a demo** (`rules/constraints.md`). Measuring
  tools go in a dev-only route or an injected script.
- **Privacy rules stand.** Text and audio leave the device only through an endpoint the learner
  configured, and the Settings data-flow line must name it.
- **SPDX header** on every new `.ts`, `.js`, `.mjs`, `.svelte`, `.rs` and `.sh` file (`bun run spdx`).
- **British English** in docs and UI copy (`colour`, `behaviour`, `licence`).
- **Do not commit or push** unless the author asks. They review changes first.

## What already exists (checked 2026-11-06)

| Area | Today | Where |
|---|---|---|
| Web build | Static SPA on GitHub Pages under `/<repo>/`, built with `BASE_PATH` | `.github/workflows/pages.yml`, `vite.config.ts` |
| Cross-origin isolation | `COOP: same-origin`, `COEP: credentialless` in dev and preview only. GitHub Pages cannot send headers, so the deployed site is not isolated and WASM runs single-threaded | `vite.config.ts` |
| PWA pieces | **None**: no manifest, no service worker, no `apple-touch-icon`. `app.html` already has `viewport-fit=cover` | `src/app.html` |
| Icons | iOS-sized icons already generated by `tauri icon` | `src-tauri/icons/ios/`, `brand-assets/app-icon-1024.png` |
| Safe areas | Partly handled for Android edge-to-edge (bottom bar, toasts, download dock, text-size editor, card stack) | `AppHeader.svelte`, `Toasts.svelte`, `LanguageDownloadBar.svelte`, `+layout.svelte` |
| Runtime detection | `currentRuntime()` returns `web` for every browser, iPhone included. `ios` means a Tauri iOS app, which does not exist | `src/lib/platform/runtime.ts` |
| Database | sqlite-wasm with the `opfs-sahpool` VFS in a worker, which does not need `SharedArrayBuffer`. Persistent storage is already requested | `adapters/db/sqlite.worker.ts`, `adapters/db/index.ts`, `utils/storage.ts` |
| Recording | `MediaRecorder` with WebM/Ogg Opus, then `audio/mp4`; a WebCodecs Opus encoder where MediaRecorder cannot record Opus | `speech/audioFormat.ts`, `utils/audio.ts` |
| Playback | One shared `<audio>` element, primed inside the tap because WebKit blocks sound that was not started by a gesture; a refusal shows "Tap ▶ to listen" | `stores/audio.ts`; decision 2026-10-30 |
| Local speech-to-text | Transformers.js `whisper-small` q4 in a worker in the browser (299 MB, **about 1.9–2.5 GB of RAM** while loaded). whisper.cpp natively in the Tauri apps | `speech/stt/`, `docs/research/model_problem.md` |
| Cloud speech | Speech-to-text via Groq `whisper-large-v3-turbo`; read-back via ElevenLabs or an OpenAI-compatible server | `speech/stt/cloud/`, `speech/tts/cloud/` |
| Default processing | `sttMode: 'local'`, `ttsMode: 'local'` (Piper `piper-tom-medium`) | `stores/settings.ts` |
| Language data | Speech-to-text and voice parts are tracked separately (`stt`, `voice`); models come from Hugging Face | `stores/languageData.ts`, `languages/index.ts`, `speech/tts/piper/assets.ts` |
| Notifications | `new Notification()`, sent only while `document.hidden`; reminders also show an in-app banner | `platform/notifications.ts`, `stores/reminders.ts` |
| Google Drive sync | Google Identity Services popup in the browser; hidden in the Android app | `adapters/sync/google/oauth.ts`, `SyncSection.svelte` |
| WebDAV sync | Plain `fetch` in the browser, so the server must allow the origin (CORS) | `adapters/sync/webdav.ts` |
| Card stack | Locks on `scrollend` where the engine reports it, else a 120 ms timer | `AttemptStream.svelte` |
| Testing so far | **Chrome only** for the web build (`references/assumptions.md`). Safari has never been tried | |

## iOS facts to verify before you rely on them

Check each one against current WebKit release notes and on a device, and write what you find
into `docs/architecture/platforms.md`.

| Claim (**verify**) | Why it matters to onspot |
|---|---|
| Every browser on iOS uses WebKit, so a PWA behaves like Safari whichever browser installed it | One engine to test |
| iOS has no install prompt (`beforeinstallprompt`); people must use Share → Add to Home Screen. Recent iOS also lets Chrome, Edge and Firefox add to the home screen | The app needs its own install guide |
| Safari can delete a site's script-writable storage after about 7 days without use; a home-screen app is treated separately | The database and 300+ MB of models need the app installed |
| A home-screen app's storage is separate from Safari's storage for the same address | Someone who tried onspot in Safari starts empty after installing |
| iOS suspends a web app soon after it leaves the screen | Downloads, timers and recordings stop in the background |
| Notifications exist only for home-screen apps, are shown through a service worker, and reach a closed app only by Web Push, which needs a server. `new Notification()` may not exist at all | Reminders and download notices cannot rely on the system |
| WebKit may not support `COEP: credentialless` | Safari may never be cross-origin isolated, so WASM stays single-threaded |
| iOS closes web pages that use too much memory; the limit depends on the device | Local Whisper (about 2 GB) is likely to be killed |
| Web Audio and some playback are muted by the Ring/Silent switch unless `navigator.audioSession.type` is set | Read-back may be silent |
| Which `MediaRecorder` types WebKit records, and whether it plays Ogg or WebM Opus | Stored takes and read-backs are Opus |
| Whether WebCodecs `AudioEncoder` and `AudioDecoder` are available | The Opus encoder fallback depends on them |
| Screen Wake Lock works in an installed web app | Keeping the screen on during a long download |
| Web Share with files (`navigator.share({ files })`) is available | A better export path than a plain download |
| OPFS sync access handles, which `opfs-sahpool` needs, work in a worker | The database |
| `scrollend` support | The card stack's lock |
| On ProMotion iPhones, Safari limits `requestAnimationFrame` to 60 Hz by default (a "Prefer Page Rendering Updates near 60fps" feature flag) while native scrolling may run at 120 Hz | The author's 120 fps bar |
| The microphone permission may be asked for again on each launch of a home-screen app | `PermissionsPrompt` copy |
| The Vibration API does not exist on iOS | onspot does not vibrate today; keep it that way |

## Phases

### Phase 0: baseline on a real iPhone (no code)

1. Open the current GitHub Pages build in Safari on an iPhone, then add it to the home screen
   and open it from there.
2. Walk the whole app in both contexts (Safari tab and home-screen app) and in both themes:
   - first run, the language choice and the permissions prompt;
   - one 60-second take with **cloud** speech-to-text, its feedback and cloud read-back;
   - local Piper read-back (downloads the voice);
   - local Whisper: start the 299 MB download and watch whether the app reloads or dies when the
     model loads (that is the memory limit);
   - History, Insights, Settings, the text-size live preview, export and restore;
   - rotation, the on-screen keyboard and the bottom bar against the home indicator.
3. **Debugging from Linux.** Safari's Web Inspector normally needs a Mac. Options:
   `ios-webkit-debug-proxy` with a DevTools front end, a real-device cloud service (BrowserStack
   has a free plan for open-source projects; check its current terms), or a borrowed Mac.
   Playwright's WebKit on Linux catches engine bugs only: it has no iOS memory limits, a
   different media stack and no home-screen mode.
4. Record every finding. Defects go in `docs/planning/bugs.md` (root causes in
   `.agents/handoff/references/bugs.md`), limits in `.agents/handoff/references/known-issues.md`.

**Ask the user** to review the findings before Phase 1. They may change the order of the work.

### Phase 1: hosting and the app's address

A PWA's identity, its storage, its caches and its service worker all belong to its origin.
Settle the origin **before** anyone installs onspot on an iPhone, because moving it later strands
every learner's local data.

- GitHub Pages cannot send the cross-origin headers, and the project site shares
  `<owner>.github.io` with the author's other Pages sites, so it also shares their storage and
  service-worker scope.
- Recommended: a free host that sets headers and serves the SPA at the root, such as Cloudflare
  Pages (`_headers`, `_redirects`) or Netlify. **Ask the user** which host, and whether they
  want a custom domain or the free subdomain.
- Build at the root (`BASE_PATH` unset). Send `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Embedder-Policy` from the host. If WebKit lacks `credentialless`, do **not**
  switch everyone to `require-corp` without auditing every cross-origin load first (the Google
  Identity Services script, Hugging Face model files, Piper voices). An un-isolated Safari only
  means single-threaded WASM.
- Check that `COOP: same-origin` does not break the Google sign-in popup (Google documents
  `same-origin-allow-popups` for it). Weigh that against isolation, which needs `same-origin`,
  and test the Drive flow in Chrome and Safari on the new host before you switch.
- **Moving the existing web learners.** Their data lives in the old origin's OPFS. Keep the
  GitHub Pages site up for a while, showing a notice that asks them to export in Settings → Data
  and restore at the new address. Never delete their data for them. Redirect only after a
  notice period the user agrees to.
- Update the CI workflow, the README's web links and the Google OAuth client's authorised
  JavaScript origins. The user must add the new origin in Google Cloud.

### Phase 2: installable app (manifest, icons, meta tags)

- Add a web app manifest: `id`, `name`, `short_name`, `start_url`, `scope`,
  `display: standalone`, `background_color` and `theme_color` from the paper tokens in `app.css`,
  icons at 192 and 512 px, and a maskable icon. Generate the icons from
  `brand-assets/app-icon-1024.png` with a script (as `scripts/textures.sh` does for textures);
  do not hand-make them. Reuse `src-tauri/icons/ios/` where the sizes match.
- In `app.html`: `apple-touch-icon` (180 × 180), `apple-mobile-web-app-title`,
  `apple-mobile-web-app-status-bar-style` (`black-translucent` if the layout handles the top
  inset), and a `theme-color` meta for each colour scheme. Use `%sveltekit.assets%` paths so a
  base path still works.
- Launch (splash) images are optional on iOS and need one image per screen size. **Ask the
  user** whether they want them; the default is no.
- The manifest must not change the Tauri apps.

### Phase 3: offline (service worker)

- Use SvelteKit's own service worker (`src/service-worker.ts` with `$service-worker`: `build`,
  `files`, `version`). Only add a plugin such as `@vite-pwa/sveltekit` if the native API falls
  short, and say why.
- **Register it only in production web builds**, never in Tauri and never on the dev server.
  A service worker on `localhost:5173` would serve the author stale files. Turn off SvelteKit's
  automatic registration and register it yourself, behind `!dev` and `currentRuntime() === 'web'`.
  Test with `bun run build && bun run preview`.
- Precache the app shell: the build output and the small static files. Do not precache the
  18 MB `piper-wasm` data or any model; cache those on first use.
- Serve navigations from the cached `index.html` when offline, so deep links open.
- **Leave model and voice caching alone.** Transformers.js and Piper's `cachedFetch.ts` already
  keep their files in Cache Storage. Do not store them twice.
- **Never cache API traffic**: Groq, DeepSeek, ElevenLabs, OpenAI-compatible servers, Google
  and WebDAV go straight to the network (privacy, and stale answers would be wrong).
- Updates: when a new version is waiting, show a neo toast ("A new version is ready" with
  **Reload**). Never activate it in the middle of a recording or a feedback request.
- Check that `crossOriginIsolated` stays true when the page is served from the cache offline,
  wherever the host makes it true online.

### Phase 4: iPhone layout and input

- **Safe areas.** Check every edge in portrait and landscape, in the Safari tab and the
  home-screen app: the phone bottom bar against the home indicator, the top inset when the status
  bar is translucent, and the notch in landscape. Extend the existing `env(safe-area-inset-*)`
  rules rather than adding new ones.
- **Viewport height.** Use `dvh`/`svh` where the toolbar or keyboard changes the height.
  `app.css` still sizes the paper texture with `100vw 100vh` (`--paper-key-size`, line ~354 and
  ~694); check that it looks right when Safari's toolbars collapse.
- **Inputs** under 16 px make iOS zoom on focus. Check every text field, and use
  `visualViewport` where the keyboard would cover a field.
- **Selection and long-press.** Hover meanings rely on text selection (`wordSelection.ts`).
  Check iOS's long-press callout and selection handles, and don't let `-webkit-touch-callout` or
  `user-select` rules break selection.
- **Gestures.** The sheet drag, the timeline swipe and the card stack (`src/lib/gestures/`) must
  not fight iOS's edge swipe or the home-indicator swipe. Check `touch-action` and
  `overscroll-behavior`.
- **Back.** A home-screen app has no browser Back button and no hardware Back. The header's Back
  (`navigation/back.svelte.ts`) must reach every screen that has somewhere to go back to.
- **Frosted sheets.** Check that `.sheet` keeps its backdrop blur in Safari (prefix if needed)
  and that `@paper-design/shaders` survives WebGL context loss when the app is suspended.
- Test at 375 and 390 px wide (iPhone SE and current iPhones), on a large iPhone, and on an iPad
  in both orientations. iPadOS Safari reports a Mac user agent; detect touch with
  `navigator.maxTouchPoints`.

### Phase 5: install guide inside the app

- Detect "Apple touch device, in a browser, not installed" (`navigator.standalone === false` or
  no `(display-mode: standalone)` match). Put the helpers in `src/lib/platform/` so nothing else
  sniffs the user agent. Keep `Runtime` meaning "which build"; do not overload `ios` for the
  browser.
- Show a small, dismissible card (neo components, progressive disclosure), reopenable from
  Settings, with the steps Share → Add to Home Screen → open onspot from the home screen. Give
  the reasons in one or two lines each:
  - installed, onspot keeps its storage, and Safari may clear a website's data after a week
    without use;
  - what was done in Safari does not carry into the installed app: install first, or export and
    restore.
- Name the right button for other iOS browsers if they can install, and hide the card once
  installed.

### Phase 6: speech on iPhone

- **Evidence:** Transformers.js `whisper-small` q4 holds about 1.9–2.5 GB of RAM while loaded
  (`docs/research/model_problem.md`). The whisper.cpp WASM build measured there uses about
  0.6 GB but runs at rtf 14.6–22.7 (far too slow). On iPhone, local Whisper is likely to be
  killed by iOS.
- **Default for a new install on an Apple touch device in the browser:** cloud speech-to-text
  (Groq; the learner already needs a Groq key for feedback). Read-back stays local Piper if it
  measures well on the device, else cloud. Change defaults only for fresh settings, never a
  choice the learner made, and keep the Settings data-flow line naming the endpoint in use.
- **Local Whisper** stays offered only if it loads and transcribes on a real iPhone. Measure
  memory before you decide. If it fails, show it unavailable with the reason ("needs about 2 GB
  of memory; iPhones close the app"), and never let a learner download 299 MB that cannot run.
- Let a learner download the voice without the speech-to-text model; `languageData.ts` already
  tracks the two parts separately.
- Keep WASM. Quantised Whisper on WebGPU returns nonsense (`rules/constraints.md`,
  `references/known-issues.md`); do not turn WebGPU on for iOS.
- Measure Piper's memory and speed on the device and record the numbers in
  `docs/benchmarks/runtime.md` and `tts.md`.

### Phase 7: audio

- **Recording:** see which type `recordingFormat()` picks in Safari and in the home-screen app,
  and whether the WebCodecs Opus encoder runs. Check that Groq accepts that container, that the
  stored take replays, and that local decoding (`utils/audio.ts`, which already has a Safari
  fallback) works.
- **Playback:** stored read-backs are Opus (`encodeSpeechOpus`). If WebKit will not play that
  container, store or decode a form it plays, using an existing dependency (`mediabunny`) rather
  than new code. Measure before you change the stored format, and migrate nothing without
  telling the user.
- **Silent switch:** set `navigator.audioSession.type` (`play-and-record` while recording,
  `playback` for read-back) where it exists, and check read-back with the switch on silent.
- **Autoplay:** the explanation plays after an asynchronous feedback request. Confirm the
  primed element still plays it on iOS; the "Tap ▶ to listen" fallback must appear if not.
- **Interruptions:** locking the phone, switching apps, a phone call or a Bluetooth route change
  during a take. Each needs a clear outcome (keep the take or discard it with a message), never a
  silent loss.
- **Microphone permission:** if iOS asks again on each launch, make `PermissionsPrompt` say so
  instead of looking broken.

### Phase 8: storage, downloads and data safety

- **Database:** check that `opfs-sahpool` opens, writes, exports and restores on iOS, and see
  what `navigator.storage.persist()` and `estimate()` return in the installed app.
- **Space:** show the free space before a large download, using `estimate()`.
- **Downloads in the foreground:** iOS suspends the app when it leaves the screen. Hold a
  Screen Wake Lock during language-data downloads where it works, and tell the learner to keep
  onspot open. Make an interrupted download restart or resume cleanly: no half-written cache
  entries and a clear **Retry**. Check what `languageData.ts` and `cachedFetch.ts` do today
  before you change anything.
- **Export:** `browser-fs-access` falls back to a download on Safari. Check that `.sqlite` and
  `.md` exports reach Files. If Web Share with files works, offer it through the existing export
  utilities rather than a second export path. Restore is a file input from Files.
- **Honesty:** say once, where learners will read it (the install card or Settings → Data), that
  the data lives only on this iPhone unless they export or sync.

### Phase 9: notifications and reminders

- onspot has no server and will not get one, so there is no Web Push. On iOS the system cannot
  deliver a reminder to a closed app.
- Keep the in-app reminder banner. On iOS, hide or explain the system-notification part of
  Settings → Reminders, and keep the copy saying the nudge appears when onspot is opened.
- Apply the same honesty to the download-finished notification: on iOS the toast is the signal.
- Record this in `decisions.md` and `known-issues.md`.

### Phase 10: sync

- **Google Drive:** test the popup flow in a Safari tab and in the home-screen app (iOS may open
  popups from a home-screen app in a separate in-app browser, which can break the callback). If
  it fails in the installed app, hide Drive there with an honest note, as the Android app does,
  and keep WebDAV and manual export and restore.
- **WebDAV:** the browser needs the server to allow the origin; the existing copy explains it.
  Check that the message shows on iOS.

### Phase 11: performance

- The author's bar is "no less than 120 fps … the whole app, on all platforms". Measure the card
  stack scroll, the sheet drag and dismiss, the timeline swipe, the menu opening and the Settings
  scroll on a ProMotion iPhone, the same way the Android pass did
  (`.agents/handoff/memory/state.md`, "120 fps pass on the phone").
- If WebKit limits script-driven frames to 60 Hz by default, say so plainly in the results; do
  not claim 120 fps where the engine caps it. Prefer CSS transitions and native scrolling, which
  may run at the display's rate, wherever the design allows.
- Watch the costs that hurt on Android: paint during scroll, backdrop blur and the WebGL shader.
- Record the numbers in `docs/benchmarks/`.

### Phase 12: docs and release

- `docs/architecture/platforms.md`: the iOS row becomes the PWA, with what works, what does not
  and why. Replace the Tauri iOS blocker list with a short note on why that route was not taken.
- `README.md`: an **iPhone and iPad** install section (steps, the honest limits, the API-key
  note) next to the other downloads, plus the new web address.
- `docs/releases/`: notes for the release that ships it.
- `.agents/handoff/`: `state.md`, `tasks.md`, `last-session.md`, `decisions.md`,
  `known-issues.md`, `roadmap.md`.
- `docs/planning/ideas.md`: when it ships, move the iOS idea to `docs/planning/archive/ideas.md`
  (see `docs/planning/README.md`).

## Out of scope

- The App Store, TestFlight, a Tauri iOS project, or anything that needs a paid Apple account.
- A server of any kind: Web Push, proxies or a backend.
- AltStore or SideStore builds (a possible later idea, not part of this work).
- An iPad-specific redesign. iPad must work well, not look different.
- Rewriting the speech stack or changing model choices without new evidence.

## Verification

- `bun run check` (0 errors, 0 warnings), `bun run build`, `bun run spdx:check`.
- `bun run preview` (:4173): the manifest and service worker are valid in Chrome DevTools →
  Application, the app works offline after one visit, and the update toast appears after a
  rebuild.
- On a real iPhone, in a Safari tab and as a home-screen app: everything in Phase 0's walk-through,
  plus offline launch, install-guide behaviour, the silent switch, interruptions, export and
  restore, and the performance numbers.
- An iPad in both orientations.
- **No regressions elsewhere:** desktop Chrome and Firefox web, the Android app and a desktop
  Tauri build. The service worker must not register inside Tauri.
- Report every check you could not run, and why.

## Definition of done

- onspot installs from Safari, opens full screen with the right icon, name and colours, and
  launches offline.
- A learner on a current iPhone can finish a whole session (record, transcribe, feedback,
  read-back, history) with the default settings.
- Every iOS limit the learner can run into is either worked around or explained in the app.
- No large download is offered for something the device cannot run.
- The docs and handoff files describe the iOS PWA as it really is, verified on a device.

## Questions for the user

Ask these before Phase 0. Write the answers into `.agents/handoff/memory/decisions.md` or
`tasks.md`.

1. Do you have an iPhone or iPad to test on? Which model and iOS version? Do you have access to a
   Mac (for Safari's Web Inspector)?
2. Which free host: Cloudflare Pages (recommended) or Netlify? A custom domain, or the free
   subdomain?
3. How long should the GitHub Pages site keep showing the "export and move" notice before it
   redirects?
4. On iPhone, should cloud speech-to-text be the default for new installs (recommended), with
   local Whisper only if it passes on a device?
5. Do you want iOS launch (splash) images? The default is no.
6. Can you add the new origin to the Google OAuth web client in Google Cloud when the time comes?
