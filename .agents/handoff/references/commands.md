# Commands

## Development (web SPA)
- `npm install` — install dependencies.
- `npm run dev` — Vite dev server (SvelteKit). **Use one port consistently.** The browser Cache
  API is per-origin, so `:5173` and `:5174` keep separate model caches and switching re-downloads
  every model. Tailwind scans the project for class candidates and watches every scanned file;
  `src/app.css` excludes `docs/`, `.agents/`, `eval/` and `repomix/` with `@source not`, so
  writing notes in those folders does not reload the app. (Start a fresh dev server after changing
  the `@source` directives; stale watcher registrations persist until restart.)
- `npm run build` — production SPA build to `build/` (single `index.html` + `_app/`).
- `npm run preview` — serve the production build. COOP/COEP are applied by the Vite plugin.
- `npm run check` — `svelte-kit sync` + `svelte-check`.
- `npm run bundle:ui` — pack the isolated `src/routes/ui-sandbox/` UI with
  `npx repomix --include "src/routes/ui-sandbox/**/*.svelte" --output "repomix/ui-sandbox-bundle.xml"`.
  Output stays in `repomix/` (never the repo root). The folder is tracked via `repomix/.gitkeep`;
  only the generated `repomix/*-bundle.*` file is gitignored. It includes no product code. The
  first run needs network so npx can fetch repomix.
- `npm run bundle -- <target...> [options]` — export pages or sections of the real app with
  repomix (`repomix/bundle.mjs`). Targets: a page name (`--list`: home, history, insights,
  settings, ui-sandbox), `--all`, any file/folder, or a quoted glob. Several targets go into one
  combined file; `--separate` writes one per target. Local imports are followed (`--depth <n>`,
  `--no-deps`); `--layout` adds the app shell; `--ui` keeps only `.svelte/.css/.html`;
  `--exclude <glob>` drops files (e.g. `"src/lib/components/ui/**"`); `--style markdown`;
  `--dry-run` lists files and size first. Extra repomix flags go after a second `--`
  (`npm run bundle -- insights -- --compress --copy`). Output: `repomix/<targets>-bundle.<ext>`.
  Full unlimited-depth page bundles are ~60–130 files (settings ≈ 80k tokens); `--depth 1` is
  the page plus what it uses directly.
- `/stt-bench/` (dev route) — STT benchmark of the product engine over every scored `eval/`
  clip; `?auto=1` starts it, `&limit=n` runs the first n clips; results in `window.__bench`.
- `npm run tauri dev` — run the desktop app (Tauri) against the dev server.
- `npm run tauri build` — package the desktop app.

## Android (Tauri v2)
- `scripts/android.sh` wraps `tauri android …` with the right toolchain. Paths come from the
  gitignored `scripts/android.local.env` (template: `android.local.env.example`): JDK 17/21 (Gradle
  rejects newer), rustup Rust with `aarch64-linux-android` + `x86_64-linux-android` (Arch's system
  Rust cannot add targets), NDK, SDK, and `CARGO_TARGET_DIR` outside the synced folder.
  This machine: everything in `/mnt/data/not_synced/dev-cache/` (jdk-21, rustup, cargo,
  onspot-target, onspot-release.jks). Logs: `build-emulator.log`, `build-release.log` there.
- `npm run android:emulator-apk` — debug APK for x86_64 emulators (AVDs are x86_64, API 36);
  `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- `npm run android:build` — signed release APK for arm64 phones (`--apk --target aarch64`).
  Signing: `src-tauri/gen/android/keystore.properties` (gitignored: keyAlias, password,
  storeFile) → `onspot-release.jks`. **Back up the keystore**; updates must be signed with it.
- `npm run android:dev` — hot-reload on a device/emulator. `scripts/android.sh env` prints the
  resolved toolchain.
- CI: `.github/workflows/android.yml` builds the arm64 release APK on push to main (not for
  md/docs/.agents-only changes), `workflow_dispatch`, and `v*` tags (tag → GitHub Release).
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

## Rust / Tauri
- `cargo check` (in `src-tauri/`) — typecheck the backend.
- `src-tauri/.cargo/config.toml` pins `linker = "gcc"` to work around an Arch/GCC triple mismatch
  (`x86_64-pc-linux-gnu` vs `x86_64-unknown-linux-gnu`). Without it, builds fail with
  ``linker `x86_64-linux-gnu-gcc` not found``.
- Desktop database path: the SQL plugin anchors `sqlite:` to the app config dir
  (`onspot.db`). Browser database: OPFS, pool `onspot-pool`, virtual file `/onspot.db`.

## After a fresh clone or `npm ci`
The French phonemizer assets are gitignored (18 MB). Restore them into `static/` (not `public/`):

```sh
mkdir -p static/piper-wasm
cp node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.{js,wasm,data} static/piper-wasm/
```

Without this, every Piper voice fails at synthesis time.

## Clearing model caches
Models live in the browser's Cache API (`transformers-cache`, `onspot-tts-cache`), per origin.
Clear via DevTools > Application > Storage, or:

```js
caches.keys().then(ks => ks.forEach(k => caches.delete(k)))
```

## Browser verification
The project rule is "verify in a browser before believing it". Install a throwaway Playwright in
a scratch dir outside the repo (`npm i playwright`) and point it at the cached Chromium
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
