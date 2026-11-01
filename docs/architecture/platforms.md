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
| iOS | **Not started** | — | — | — |

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

## Android

- Tauri v2 with the native speech plugin; the Transformers.js cache is superseded and removed on
  upgrade (`removeSupersededStt`).
- The WebView never becomes cross-origin isolated, so local WASM inference is single-threaded and
  the app uses native whisper.cpp instead.
- Release builds are signed from `src-tauri/gen/android/keystore.properties`; CI builds the arm64
  APK on every push to `main` (`.github/workflows/android.yml`).
- Google Drive sync is not wired up yet; WebDAV uses the native HTTP path and works without CORS.

## iOS (deferred)

There is no iOS project, no build and no claim that it works. It needs work that this Linux
machine cannot do:

1. A macOS host with Xcode and an Apple developer identity.
2. `bunx tauri ios init` and the generated Xcode project, plus signing/provisioning.
3. `NSMicrophoneUsageDescription` in `Info.plist` and the runtime microphone permission flow.
4. The `speech` plugin's whisper.cpp CMake build for iOS targets, including the C/C++ toolchain
   settings and any SIMD flags.
5. A device/TestFlight run for speech, storage and sync, plus App Store privacy declarations.

The shared code is already portable: `currentRuntime()` reports `ios`, and Google Drive sync is
hidden there while WebDAV remains available.

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
```

CI: `.github/workflows/android.yml` (APK) and `.github/workflows/release.yml` (Windows, macOS and
Linux desktop bundles).
