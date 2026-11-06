# Platforms

Where onspot runs, what is verified, and what is still missing. The inception's target order is
desktop first, then the web SPA, then mobile.

| Target | Status | Speech | Database | Cloud sync |
|---|---|---|---|---|
| Windows desktop | **Builds in CI**: `.exe`/`.msi` for x64 and ARM64 (ARM64 cross-built, ggml with clang-cl); not run on this Linux machine | native whisper.cpp (Tauri plugin) | native SQLite (`plugin-sql`) | Google Drive + WebDAV |
| macOS desktop | **Builds in CI**: `.dmg` for Apple Silicon and Intel (`macos-15-intel`); not run here | native whisper.cpp | native SQLite | Google Drive + WebDAV |
| Linux desktop | **Built and verified** (x64); ARM64 `.deb`/`.rpm`/`.AppImage`/`.flatpak` build in CI on ARM runners, not run here | native whisper.cpp | native SQLite | Google Drive + WebDAV |
| Web SPA | **Verified** (Chromium; Firefox for storage/restore paths) | Transformers.js Whisper in a worker | sqlite-wasm on OPFS in a worker | Google Drive (GIS) + WebDAV (needs CORS) |
| Android | **Verified** (debug app on a phone; release APK built) | native whisper.cpp | native SQLite | WebDAV (Google Drive deferred) |
| iOS / iPadOS | **PWA live** at `onspot.khizardevelops.workers.dev`; not device-verified | cloud Groq or on-device Whisper/Piper (offered; cloud recommended on iPhone) | sqlite-wasm on OPFS | Google Drive popup + WebDAV (both unverified on iOS) |

## Desktop

- Tauri v2 wraps the same SvelteKit static build. The Rust shell also ships onspot's `speech`
  plugin (`src-tauri/plugins/speech`), which runs whisper.cpp natively.
- The database lives in the app config directory (`onspot.db`). Export uses `VACUUM INTO`; restore
  closes the pool, overwrites the file, removes stale journals and reopens.
- Linux adds `src-tauri/src/microphone.rs`: WebKitGTK denies `getUserMedia` unless the app handles
  its `permission-request` signal.
- The window draws its own title bar (`components/WindowBar.svelte`, 28 px, the page's paper, so it
  follows light and dark mode). Windows and Linux run undecorated (`decorations: false`) with the
  bar's minimise/maximise/close; Tauri keeps a 5 px resize border on the edges. macOS keeps native
  traffic lights over the bar (`src-tauri/tauri.macos.conf.json`: overlay title bar; JSON merge
  replaces the whole `windows` array, so window size changes go in both files).
- The AppImage runs on X11 (`src-tauri/src/display_backend.rs`): its bundled Ubuntu 22.04 GTK and
  WebKitGTK mis-size the page on maximise/restore under Wayland. The Flatpak and `.deb`/`.rpm` use
  current system libraries and stay on Wayland.
- The trajectory is the inception's `.exe` first. This machine cannot cross-build a Windows
  binary, so `.github/workflows/release.yml` builds Windows, macOS and Linux bundles on a tag or
  manual run.

## Web

- A static SPA (`@sveltejs/adapter-static`, `fallback: 'index.html'`).
- Must be served with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`; local speech needs `SharedArrayBuffer`.
- Storage is OPFS for the exact browser profile and origin. A different profile, host, port or
  runtime starts empty; use Export/Restore or cloud sync to move data.
- Only one tab can hold the OPFS database at a time. A second tab gets a clear message after a
  short retry.
- Google Drive uses Google Identity Services (popup); WebDAV depends on the server's CORS policy.
- The live web origin is **Cloudflare Workers static assets** at
  `https://onspot.khizardevelops.workers.dev`, deployed with `cf deploy --prebuilt`
  (`scripts/cf-deploy.sh`; `cf deploy` cannot build SvelteKit yet). The Worker serves the SPA at
  the root with `notFoundHandling: single-page-application`; `static/_headers` supplies
  `same-origin-allow-popups`/`credentialless`, `nosniff`, the referrer policy and no-cache for the
  service worker. The legacy Pages `_redirects` form is rejected by Workers assets as an infinite
  loop and is not used.
- `src/service-worker/index.ts` precaches the app shell and serves offline navigations in
  production web builds only. It never runs in dev or the Tauri apps, and it excludes optional
  models, launch images and sample audio. New versions wait for the learner's **Reload**. The
  Worker bundle omits the 26.5 MiB WebGPU-only ORT binary (Workers' 25 MiB per-asset limit); the
  default WASM ORT runtime is included. GitHub Pages remains the old origin while learners export
  and move.

## Android

- Tauri v2 with the native speech plugin; the Transformers.js cache is superseded and removed on
  upgrade (`removeSupersededStt`).
- The WebView never becomes cross-origin isolated, so local WASM inference is single-threaded and
  the app uses native whisper.cpp instead.
- Release builds are signed from `src-tauri/gen/android/keystore.properties`; CI builds the arm64
  APK on every push to `main` (`.github/workflows/android.yml`).
- Google Drive sync is not wired up yet; WebDAV uses the native HTTP path and works without CORS.

## iOS and iPadOS (PWA)

There is no App Store build and no Tauri iOS project. iPhone and iPad install the same static web
build from Safari with **Share → Add to Home Screen**; no paid Apple account is involved. The PWA
is live at **https://onspot.khizardevelops.workers.dev**, deployed with `cf` to Workers static
assets; it has not been run on an Apple device yet, so treat the device behaviour below as
unverified.

- **Host and origin.** Cloudflare Workers static assets serve the SPA at the root. `static/_headers`
  sends `Cross-Origin-Opener-Policy: same-origin-allow-popups` and
  `Cross-Origin-Embedder-Policy: credentialless` (verified live); the Worker's
  `notFoundHandling: single-page-application` answers deep links. `same-origin-allow-popups`
  deliberately keeps the Google Identity Services popup working, so the production page is
  **not** cross-origin isolated and local WASM stays single-threaded. Moving to `same-origin`
  needs a live Drive test first.
- **Build/deploy.** `scripts/cf-deploy.sh` builds the SPA, assembles a Build Output Specification,
  drops the Pages-only `_redirects` and the 26.5 MiB WebGPU ORT binary, and runs
  `cf deploy --prebuilt`. `cf` cannot build SvelteKit directly yet. The build is a Worker, not the
  empty legacy Pages project `onspot-4k1.pages.dev` that `cf pages create` made first.
- **Installable app.** `static/manifest.webmanifest` supplies the name, scope, colours and
  192/512/maskable icons. `src/app.html` adds the 180 px Apple touch icon, iOS meta tags and one
  launch image per current iPhone/iPad size and orientation. `scripts/pwa-assets.sh` regenerates
  all of them from `src-tauri/icons/ios/AppIcon-512@2x.png`.
- **Offline.** `src/service-worker/index.ts` uses SvelteKit 3's `$app/service-worker`,
  `$app/manifest` and `$app/env`. It registers only in production web builds, precaches the small
  app shell, excludes `piper-wasm`, launch images, sample audio and the ORT runtimes, and caches
  each WASM runtime on first use. Deep-link navigations fall back to the cached shell with a
  pinned `<base>`; updates stay waiting until the learner presses **Reload**.
- **Install guide.** `PwaInstallPrompt` appears on an iPhone/iPad browser tab (not on the welcome
  page or Settings) and can be dismissed. Settings → Learning → **iPhone and iPad** keeps the full
  steps permanently. Local speech-to-text and voice downloads stay available; the copy recommends
  cloud speech as the lighter option on iPhone rather than forcing it.
- **Limits.** A home-screen app has no browser Back button; iOS suspends it when it leaves the
  screen; there is no Web Push or system reminder for a closed app; downloads only run while the
  app is visible; and local Whisper's ~2 GB footprint is likely to be killed. See
  `references/known-issues.md` for the verify-on-device list.
- **Verification.** Chromium with iPhone SE/iPhone 14/iPad Pro emulation only: install card,
  dismissal, Settings section, installed state, dark/light status bar, no horizontal overflow.
  Real Safari, WebKitGTK, Cloudflare headers, Google Drive and local model runs are still open.
  The implementing brief is `docs/prompts/ios-focused-pwa.md`.

## Shared behaviour

- Last approved language data is downloaded per device; nothing is bundled.
- All local inference is client-side. Cloud is BYOK and labelled.
- API keys and OAuth/WebDAV credentials live in `localStorage`, never in the database or exports.
- The same `IDatabaseAdapter` and migration list run on every target.

## Build commands

```sh
bun run build                 # static web build
bun run tauri build           # native bundle for the current host
bun run android:build         # signed arm64 APK
bun run android:emulator-apk  # debug x86_64 APK
scripts/pwa-assets.sh         # PWA icons and iOS launch images from the app icon
scripts/cf-deploy.sh          # build and deploy the PWA with cf (CF_DRY_RUN=1 to check)
```

CI: `.github/workflows/android.yml` (APK), `.github/workflows/release.yml` (Windows, macOS and
Linux desktop bundles), `.github/workflows/pages.yml` (legacy GitHub Pages origin) and
`.github/workflows/cloudflare.yml` (Workers static assets via `cf`).
