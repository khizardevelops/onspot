## Practice browser check (P3)
`bun run test:practice` starts its own dev server (port 4320) with the core backend, boots the wasm
bridge in real Chrome with a fake microphone and a silent WAV, and checks prompt selection, start,
cancel and the silent-take rejection. Set `CHROME_PATH` if Chrome is not in a standard location.
Run `bun run bridge:wasm` first.

# Commands

**Package manager: bun** (`bun.lock`, `"packageManager": "bun@1.3.5"`). bun installs packages and
runs scripts; Vite/SvelteKit still run on **Node** (their `node` shebang), so Node 22 must stay
installed. After switching to a branch with different dependencies, run
`bun install --frozen-lockfile`. Do not use npm: `package-lock.json` is gone.

## Development (web SPA)
- `bun install` — install dependencies.
- `bun run dev` — Vite dev server (SvelteKit). **Use one port consistently.** The browser Cache
  API is per-origin, so `:5173` and `:5174` keep separate model caches and switching re-downloads
  every model. Tailwind scans the project for class candidates and watches every scanned file;
  `src/app.css` excludes `docs/`, `.agents/`, `eval/` and `repomix/` with `@source not`, so
  writing notes in those folders does not reload the app. (Start a fresh dev server after changing
  the `@source` directives; stale watcher registrations persist until restart.)
- `bun run build` — production SPA build to `build/` (single `index.html` + `_app/`).
- `bun run preview` — serve the production build. COOP/COEP are applied by the Vite plugin.
  It is **not** suitable for service-worker update testing: a rebuild deletes
  `.svelte-kit/output` and Vite preview exits. Use a static server over `build/` for that flow.
- `bun run check` — `svelte-kit sync` + `svelte-check`.
- `bunx tsc -p src/service-worker --noEmit` — type-check the service worker in its own
  `$app/tsconfig/service-worker` context (the root tsconfig excludes `src/service-worker`).
- `scripts/pwa-assets.sh` — regenerate PWA icons and iOS launch images from
  `src-tauri/icons/ios/AppIcon-512@2x.png` into `static/pwa/` (needs ImageMagick 7).
- `scripts/cf-deploy.sh` — build and deploy the PWA to Cloudflare Workers static assets with
  `cf deploy --prebuilt` (the `cf` CLI cannot build SvelteKit). The Worker is `onspot` at
  `https://onspot.khizardevelops.workers.dev`. `CF_DRY_RUN=1 scripts/cf-deploy.sh` validates the
  Build Output without uploading. CI uses `.github/workflows/cloudflare.yml` with
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets; add the Worker origin to the Google OAuth
  web client before relying on Drive sync. Workers caps assets at 25 MiB, so the 26.5 MiB WebGPU
  ORT binary is omitted; the default WASM runtime stays.
- `bun run spdx` — add the AGPL SPDX header to every source file the project owns.
  `bun run spdx:check` fails when one is missing (used by the release workflow).
- `bun run bundle:ui` — pack the isolated `src/routes/ui-sandbox/` UI with
  `bunx repomix --include "src/routes/ui-sandbox/**/*.svelte" --output "repomix/ui-sandbox-bundle.xml"`.
  Output stays in `repomix/` (never the repo root). The folder is tracked via `repomix/.gitkeep`;
  only the generated `repomix/*-bundle.*` file is gitignored. It includes no product code. The
  first run needs network so bunx can fetch repomix.
- `bun run bundle -- <target...> [options]` — export pages or sections of the real app with
  repomix (`repomix/bundle.mjs`). Targets: a page name (`--list`: home, history, insights,
  settings, ui-sandbox), `--all`, any file/folder, or a quoted glob. Several targets go into one
  combined file; `--separate` writes one per target. Local imports are followed (`--depth <n>`,
  `--no-deps`); `--layout` adds the app shell; `--ui` keeps only `.svelte/.css/.html`;
  `--exclude <glob>` drops files (e.g. `"src/lib/components/ui/**"`); `--style markdown`;
  `--dry-run` lists files and size first. Extra repomix flags go after a second `--`
  (`bun run bundle -- insights -- --compress --copy`). Output: `repomix/<targets>-bundle.<ext>`.
  Full unlimited-depth page bundles are ~60–130 files (settings ≈ 80k tokens); `--depth 1` is
  the page plus what it uses directly.
- `/stt-bench/` (dev route) — STT benchmark of the product engine over every scored `eval/`
  clip; `?auto=1` starts it, `&limit=n` runs the first n clips; results in `window.__bench`.
- `/model-lab/` (dev route) — hands-on A/B: STT Transformers.js whisper-small q4 vs whisper.cpp
  small q5_1/q8_0 (`@transcribe/shout`, dev dependency, own worker + `onspot-model-lab` Cache
  API bucket) on a recording, upload or eval clip; TTS every voice of the selected language.
- `tools/whisper-webgpu/build.sh` — builds whisper.cpp + ggml WebGPU for the model lab into
  `src/routes/model-lab/vendor/whisper-webgpu/` (gitignored). Needs emsdk + whisper.cpp in
  `/mnt/data/not_synced/dev-cache/` (override with EMSDK_DIR / WHISPER_DIR).
- `cargo run --release -p tauri-plugin-speech --example bench -- <model.bin> <lang> <clip.f32>...`
  (in `src-tauri/`) — measures the native STT engine on raw 16 kHz f32 clips
  (`ffmpeg -i in.mp3 -ac 1 -ar 16000 -f f32le out.f32`).
- `scripts/android.sh build --apk --debug --target aarch64` — debug APK for a phone; installs as
  `app.onspot.desktop.debug` beside the release app (`adb install -r …/universal/debug/…apk`).

## Core bridge (P1)
- `bun run bridge:types` — regenerate `src/lib/core-client/types.gen.ts` and its per-type
  `bindings/` files from the Rust types (`cargo test -p onspot-app -p onspot-bridge export_bindings`
  then `scripts/bridge-types.mjs`). Commit the result; CI fails on a diff.
- `bun run catalog:export` / `bun run catalog:check` — regenerate or verify
  `crates/onspot-app/assets/languages.json` from `src/lib/languages/` (languages, instruction
  languages, voices and each voice's asset list). `catalog:check` is the generation-diff gate, like
  `bridge:types`; run it after touching the registry.
- `bun run bridge:wasm` — build the web transport into the gitignored `static/core-bridge/`.
  Needs the `wasm32-unknown-unknown` standard library and `wasm-bindgen` at the version in
  `Cargo.lock` (0.2.130). With Rustup: `rustup target add wasm32-unknown-unknown`. On distro Rust
  without the target, **the script falls back to `rust-src` + `-Z build-std=std,panic_abort`**
  (`RUSTC_BOOTSTRAP=1` is set internally); a stock `rust-std` component from another build is not
  metadata-compatible. The prebuilt `wasm-bindgen-0.2.130-x86_64-unknown-linux-musl` archive works
  on PATH. The web build always runs on the core (the P8 cutover removed `VITE_CORE_BACKEND`), so
  run this before `bun run build` for a deploy; the Pages/Cloudflare workflows and
  `scripts/cf-deploy.sh` now do it themselves.
- `bun run test:sync` — real Chrome + an in-memory WebDAV server with CORS: connect (Basic auth),
  first upload, a no-op second sync, a touched remote that returns `needs-choice`, an explicit
  download that restores the database, and a corrupt remote that is rejected before replacement.
  Starts its own dev server on port 4323 and needs `bun run bridge:wasm` first.
- `bun run test:portability` — Chrome + dev server: the walkthroughs the unit tests cannot cover.
  One context writes a session and exports the database through `export.database` (browser
  download, captured by Playwright); the context is closed (the wipe); a fresh context stages the
  file through `restore.pick` (file chooser) and `restore.confirm`, then reads the restored
  history and session Markdown back through the core. A third context skips the fresh-database
  setup guide and proves the redirect stops, and a due reminder reaches a stubbed
  `Notification`. Needs `bun run bridge:wasm` first.
- `bun run test:portability:desktop` — the release app under Xvfb (`:98`) + WebKitWebDriver
  (`:4457`) + `xdotool`: clicks the real Settings → Data export/restore buttons, answers the native
  GTK Save/Open dialogs, confirms the replace, and proves the exported setting came back. This is
  the check that caught the missing `dialog:allow-open` capability (the button did nothing because
  the plugin rejected the open call). Needs `bunx tauri build --no-bundle`, `WebKitWebDriver`,
  `Xvfb` and `xdotool`.
- `bun run test:sync:desktop` — the release Tauri app under Xvfb + WebKitWebDriver against the
  same in-memory WebDAV fixture: connect, native SQLite export, upload, no-op, touched remote →
  `needs-choice`, rusqlite online-backup restore, and a foreign remote refused before the device
  database is touched. Needs `bunx tauri build --no-bundle` first (the script fails fast if
  `target/release/onspot` or `/usr/bin/WebKitWebDriver` is missing). It creates a throwaway
  `XDG_*` profile, starts its own Xvfb on `:99`, and drives `core_command` directly; the app now
  boots the shared core host before its first screen, so the host calls are answered.
- `bun run test:storage` — real Chrome + dev server: the wasm bridge, the Rust migration (including
  the checked-in schema-9 fixture through an in-memory sqlite-wasm host), settings persistence,
  history read/write and the secret-leak regression. Needs `bun run bridge:wasm` first and
  `CHROME_PATH` when Chrome is not in a standard location.
- Dev pages (dev builds only, never mounted by the product layout): `/dev/bridge/` runs `core.ping`
  and shows the last three events; `/dev/storage-check/` is the page `test:storage` drives (it marks
  the setup guide skipped first); `/dev/long-takes/` seeds two simulated long takes through
  `restore.legacy_json`. The app always talks to the Rust core.
- All browser checks launch Chrome with `--mute-audio` and run their dev server with
  `ONSPOT_VITE_CACHE_DIR=node_modules/.vite-checks`, so the learner's own `bun run dev` on :5173
  keeps its dependency cache. Any new script that spawns `bun run dev` must do the same.

## Desktop app (Tauri)
- **Development, with hot reload: `bun run tauri dev`.** One command: it starts onspot's Vite dev
  server (`beforeDevCommand`), compiles the Rust side, and opens the desktop window on
  `http://localhost:5173`. Editing `.svelte`/`.ts` updates the window instantly (Vite HMR);
  editing Rust under `src-tauri/` makes it recompile and restart the window. Stop with Ctrl+C.
  - Port 5173 must be free first: stop any other dev server (onspot's own `bun run dev`, or
    another project's Vite). Vite is `strictPort`, so a taken port fails loudly instead of
    silently moving.
  - **Never point the window at "whatever is already on :5173".** Tried 2026-10-05 with a
    `beforeDevCommand: ""` override: the port belonged to another project (audionixdb) and the
    onspot window loaded that site. Removed.
  - The debug binary it builds is `src-tauri/target/debug/onspot`; it also only works while
    onspot's dev server runs, because debug builds load the frontend from `devUrl`.
- **Release, standalone: `bunx tauri build --no-bundle`**, then run
  `src-tauri/target/release/onspot`. The frontend is bundled into the binary; no dev server.
  `--no-bundle` skips the `.deb`/`.rpm`/AppImage installers (`bun run tauri build` makes them;
  AppImage packaging is unreliable on Arch). First build ~10 min.
  - Not for other machines yet: ggml compiles for the build machine's CPU (GGML_NATIVE); see the
    portable-build task in `memory/tasks.md`.
- First run of either: Settings → Language data → Download. The app keeps its own storage
  (model in `<app data>/models/`, database in the app config dir), separate from the browser.
  Move practice history with Settings → Storage → Export / Restore.
- `cargo run --release -p tauri-plugin-speech --example bench -- …` (see above) measures the
  native STT engine without the app.
- **App icons and installer images: `scripts/brand-assets.sh`** (needs bun, resvg, ImageMagick 7).
  Runs `tauri icon brand-assets/app-icon-1024.png --ios-color '#151412'` (`src-tauri/icons/`,
  iOS, Android legacy icons; Ink as the Android adaptive background), then overwrites the Android
  adaptive foreground with the mark alone and adds the monochrome layer (`brand-assets/android/`),
  then renders the NSIS/WiX BMPs and the DMG background into `src-tauri/icons/installer/`
  (`brand-assets/installer/`). `tauri icon` reorders `icon.icns`; `git checkout` it if that is
  its only change. Don't run `tauri icon` alone: it puts the whole tile back in the Android
  foreground, past the launcher's safe zone. The web favicon
  and header mark are `static/app-icon.svg`, a copy of `brand-assets/app-icon-tile.svg` (the icon
  with its viewBox cropped to the 824 tile, because the margin made the favicon too small).

## Cloud sync (BYOC)
- **Google Drive:** enable the Drive API in Google Cloud and create two OAuth clients — a
  *Desktop app* (loopback, no secret) and a *Web application* (authorized JavaScript origins:
  `http://localhost:5173` plus the deployed origin). Set
  `VITE_GOOGLE_CLIENT_ID_DESKTOP` / `VITE_GOOGLE_CLIENT_ID_WEB` (see `.env.example`).
  The desktop flow binds a loopback port in `src-tauri/src/oauth.rs`; `cargo test --lib` covers
  callback parsing and a real loopback request. The browser flow uses Google Identity Services,
  so an expired token asks the learner to reconnect.
- **WebDAV:** Settings → Cloud sync → WebDAV, with the collection URL, backup path, username and
  password. The browser build requires the server to allow the app origin via CORS; the desktop,
  Android and iOS apps go through the Tauri HTTP plugin and do not. A local test server must answer
  `OPTIONS` with `Access-Control-Allow-Methods: OPTIONS, PROPFIND, MKCOL, PUT, GET, HEAD, DELETE`
  and allow the `Authorization`, `Depth` and `Content-Type` headers.
- **Smoke tests:** first sync uploads; a second with no edits is a no-op; touching the remote file
  opens the conflict dialog; choosing the cloud copy restores the database; a non-onspot file is
  rejected before anything is replaced.

## Processing choices (Local vs Cloud per step)
Settings → **Learning** has three independent rows, each with its own Local/Cloud switch and an
inline disclosure:
- **Speech-to-text:** Local (Whisper) or Cloud (Groq `whisper-large-v3-turbo`). The Groq key here is
  shared with the LLM when Groq is selected.
- **LLM:** Cloud (Groq/DeepSeek/custom) or **Local** (any OpenAI-compatible
  `/v1/chat/completions`). Common URLs: LM Studio `http://localhost:1234/v1`, llama.cpp
  `http://localhost:8080/v1`, Ollama `http://localhost:11434/v1`. The key is optional. The browser
  build needs the server to allow the app origin (CORS); the desktop app uses the Tauri HTTP plugin
  and does not. Use the model name the server reports; **Test connection** sends one tiny chat
  completion and **Refresh models** reads `GET /v1/models`.
- **Text-to-speech:** Local (Piper) or Cloud. Cloud keeps **ElevenLabs** and
  **OpenAI-compatible** separately: ElevenLabs needs its own key and voice id (refresh via
  `GET /v2/voices`), while the OpenAI-compatible path accepts OpenAI or a local
  `/v1/audio/speech` server. Switching providers preserves both configurations. **Voice** opens a
  picker modal (search, details per voice, Preview, Refresh, Done), not a dropdown; with an
  ElevenLabs key stored the account's voices load automatically.
Downloads happen only for the local parts selected; cloud-only needs no speech downloads. There is
no global preset: toggle each row independently. The footer lists the missing steps and the data
that leaves the device.

## Android (Tauri v2)
- `scripts/android.sh` wraps `tauri android …` with the right toolchain. Paths come from the
  gitignored `scripts/android.local.env` (template: `android.local.env.example`): JDK 17/21 (Gradle
  rejects newer), rustup Rust with `aarch64-linux-android` + `x86_64-linux-android` (Arch's system
  Rust cannot add targets), NDK, SDK, and `CARGO_TARGET_DIR` outside the synced folder.
  This machine: everything in `/mnt/data/not_synced/dev-cache/` (jdk-21, rustup, cargo,
  onspot-target, onspot-release.jks). Logs: `build-emulator.log`, `build-release.log` there.
- `bun run android:emulator-apk` — debug APK for x86_64 emulators (AVDs are x86_64, API 36);
  `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- `bun run android:build` — signed release APK for arm64 phones (`--apk --target aarch64`).
  Signing: `src-tauri/gen/android/keystore.properties` (gitignored: keyAlias, password,
  storeFile) → `onspot-release.jks`. **Back up the keystore**; updates must be signed with it.
- `bun run android:dev` — hot-reload on a device/emulator. `scripts/android.sh env` prints the
  resolved toolchain.
- CI: `.github/workflows/release.yml` builds the Windows `.exe`/`.msi`, macOS `.dmg` and Linux
  `.deb`/`.AppImage` bundles on `v*` tags or a manual run. `.github/workflows/android.yml` builds
  the arm64 release APK on push to main (not for md/docs/.agents-only changes),
  `workflow_dispatch`, and `v*` tags (tag → GitHub Release).
  **Release notes:** write `docs/releases/<tag>.md` before pushing the tag; release.yml's verify
  job fails without it. Its `notes` job publishes the file (minus the `# onspot X` heading, via
  `scripts/release-notes.sh`) as the description. Upload jobs only add files: never set
  `generate_release_notes` on them, since softprops appends the notes on every upload (that made
  v0.2.0–v0.2.3 up to seven copies of "Full Changelog"). Fix a published release's notes with
  `scripts/release-notes.sh v0.2.3 | gh release edit v0.2.3 --notes-file -`.
  versionCode = 10000 + run number (via `--config`). Artifact `onspot-android-apk`. Signing
  secrets: `base64 -w0 /mnt/data/not_synced/dev-cache/onspot-release.jks | gh secret set
  ANDROID_KEYSTORE_BASE64`, `gh secret set ANDROID_KEY_ALIAS -b onspot`,
  `gh secret set ANDROID_KEY_PASSWORD` (value from keystore.properties). No secrets → unsigned.
- Debugging the WebView: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then
  raw CDP (Playwright's connectOverCDP is unsupported for WebView). Script:
  `/tmp/opencode/pw/cdp-eval.mjs "<async js>"`.

## Cross-origin isolation (COOP/COEP)
Needed for `SharedArrayBuffer` (ORT-Web WASM threads) and OPFS. Set in dev and preview by the
`onspot-cross-origin-isolation` plugin in `vite.config.ts` — **not** via `server.headers`, which
SvelteKit ignores. A deployed static SPA must set these at the host/CDN:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

## Testing the built apps (no window, no real data)
- **Linux release (WebKitGTK):** `WebKitWebDriver` (ships with webkit2gtk-4.1) under `xvfb-run`,
  env `TAURI_WEBVIEW_AUTOMATION=true`, `GDK_BACKEND=x11`, `WAYLAND_DISPLAY` unset,
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`, and throwaway `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/
  `XDG_CACHE_HOME` (otherwise it uses the real desktop database). Session capability
  `webkitgtk:browserOptions: { binary: src-tauri/target/release/onspot, args: [] }`, then
  `execute/async`. End leftover `Xvfb`/`WebKitWebDriver` by PID (`pkill -f` matches its own shell).
- **Android emulator:** `bun run android:emulator-apk` (debug, x86_64, WebView debuggable), boot
  `emulator -avd dev_api36 -no-window -no-audio -memory 2048 -gpu swiftshader_indirect`, install,
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then raw CDP
  (`/json` → page `webSocketDebuggerUrl` → `Runtime.evaluate` with `awaitPromise`). Playwright's
  `connectOverCDP` refuses WebViews. The host is `10.0.2.2` from the emulator. Stop Gradle/Kotlin
  daemons first on this 11 GB machine.
- Built bundles hash their chunks: find a module by fetching the page's scripts and matching a
  string it contains, then `import()` that URL (same instance as the app's).

## GitHub Pages build
- `BASE_PATH=/onspot bun run build && cp build/index.html build/404.html` builds what
  `.github/workflows/pages.yml` deploys (BASE_PATH must start with "/" and not end with one).
  Never hard-code root paths: use `pageHref()` (`src/lib/pages.ts`) for pages, `__BASE_PATH__` in
  workers.

## Rust / Tauri
- `cargo check` (in `src-tauri/`) — typecheck the backend.
- `src-tauri/.cargo/config.toml` pins `linker = "gcc"` to work around an Arch/GCC triple mismatch
  (`x86_64-pc-linux-gnu` vs `x86_64-unknown-linux-gnu`). Without it, builds fail with
  ``linker `x86_64-linux-gnu-gcc` not found``.
- Desktop database path: the SQL plugin anchors `sqlite:` to the app config dir
  (`onspot.db`). Browser database: OPFS, pool `onspot-pool`, virtual file `/onspot.db`.

## CLI driver
- `cargo build -p onspot-cli` — build the headless driver (`target/debug/onspot-cli`); add `--offline`
  if the registry is unreachable.
- `cargo run -p onspot-cli --offline -- --help` — command list. It shares `onspot-app` with the GUI:
  `settings get|set`, `sessions list|show`, `evaluate`, `insights`, `export session` and
  `export database`.
- `onspot-cli --db PATH --keys-file PATH <command>` overrides the defaults. Without `--db` it opens
  `config_dir()/app.onspot.desktop/onspot.db`; without `--keys-file` it reads `ONSPOT_KEYS_FILE`.
  Keys resolve from `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `ONSPOT_API_KEY` or
  `ONSPOT_<PROVIDER>_API_KEY`, then the key file.
- Secrets are never printed; `--json` switches the structured output. `evaluate --transcript FILE`
  is the only networked command and SIGINT cancels it cleanly.
- `cargo test -p onspot-cli` — 7 integration tests (settings, empty store, Markdown,
  request shape, empty transcript, stub-HTTP evaluate, Ctrl-C).

## After a fresh clone or `bun install --frozen-lockfile`
The French phonemizer assets are gitignored (18 MB). Restore them into `static/` (not `public/`):

```sh
mkdir -p static/piper-wasm
cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} static/piper-wasm/
```

Without this, every Piper voice fails at synthesis time.

The Supertonic voice runtime (prebuilt sherpa-onnx v2.0.1, 14 MB) is gitignored too:

```sh
scripts/sherpa-tts-assets.sh                                  # downloads the 85 MB release tarball, verifies, extracts 3 files + LICENSE
SHERPA_TTS_TARBALL=path/to/tarball scripts/sherpa-tts-assets.sh   # reuse a downloaded tarball (still verified)
```

Without it, every Supertonic voice fails with "The on-device voice runtime could not be loaded".
To upgrade sherpa-onnx: change `SHERPA_VERSION` and every SHA-256 in the script together, then run
the voice check.

## Voice check (every on-device voice loads and speaks)
Open `/model-lab/voices/` on the dev server and press **Check**: each voice in
`src/lib/languages/voices.ts` is downloaded, speaks one sentence in its language, and is marked
pass/fail (not silent, plausible length) with its load time, rtf and a clip to listen to. By
default one Supertonic style per language (they share the weights); tick "Every Supertonic style"
for all ten. The full set downloads ~1.2 GB into the TTS cache; use a browser profile on disk,
not `/tmp` (tmpfs). The app navigates twice while starting, so automation should let the page
settle before clicking.

## Clearing model caches
Models live in the browser's Cache API (`transformers-cache`, `onspot-tts-cache`), per origin.
Clear via DevTools > Application > Storage, or:

```js
caches.keys().then(ks => ks.forEach(k => caches.delete(k)))
```

## Browser verification
The project rule is "verify in a browser before believing it". Install a throwaway Playwright in
a scratch dir outside the repo (`bun add playwright-core`) and point it at the cached Chromium
(`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`). It is deliberately **not** a project
dependency. The user usually has `vite dev` running on :5173 — **reuse it; never start a second
instance**: it re-optimizes the shared `node_modules/.vite` cache and the running server then
answers 504 "Outdated Optimize Dep" (Piper/onnxruntime fail). If that happens,
`touch vite.config.ts` makes the running server restart itself. Test code can reach the app's own
modules with `import(performance.getEntriesByType('resource').find(...))` (a second copy of the
DB module would fight over the OPFS handles). Playwright cannot drive the File System Access
picker. To force `browser-fs-access` onto its legacy download path, both `showOpenFilePicker` and
`showSaveFilePicker` must be removed in an init script — the package decides modern-vs-legacy from
`'showOpenFilePicker' in self` on the app origin. For export tests it is simpler to take the bytes
from `db.exportSqliteFile()` directly. The test Chromium segfaulted on downloads in one long-lived
persistent profile; a fresh context works.

## Adding an eval clip (benchmark tooling)
Create `eval/<name>/` with an audio file and a transcript; `import.meta.glob` discovers it.
- transcript is `<clip-basename>.txt`, or `transcript.txt` when the folder holds one clip;
- a clip with no transcript still appears, marked unscored.
