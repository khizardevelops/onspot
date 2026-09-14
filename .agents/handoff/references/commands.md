# Commands

## Development (web SPA)
- `npm install` — install dependencies.
- `npm run dev` — Vite dev server (SvelteKit). **Use one port consistently.** The browser Cache
  API is per-origin, so `:5173` and `:5174` keep separate model caches and switching re-downloads
  every model.
- `npm run build` — production SPA build to `build/` (single `index.html` + `_app/`).
- `npm run preview` — serve the production build. COOP/COEP are applied by the Vite plugin.
- `npm run check` — `svelte-kit sync` + `svelte-check`.
- `npm run bundle:ui` — pack the isolated `src/routes/ui-sandbox/` UI with
  `npx repomix --include "src/routes/ui-sandbox/**/*.svelte" --output "repomix/ui-sandbox-bundle.xml"`.
  Output stays in `repomix/` (never the repo root). The folder is tracked via `repomix/.gitkeep`;
  only the generated `repomix/*-bundle.*` file is gitignored. It includes no product code. The
  first run needs network so npx can fetch repomix.
- `npm run tauri dev` — run the desktop app (Tauri) against the dev server.
- `npm run tauri build` — package the desktop app.

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
The project rule is "verify in a browser before believing it". A throwaway Playwright setup is
kept at `/tmp/opencode/pw/` (installed outside the repo) and uses the cached Chromium at
`~/.cache/ms-playwright/`. It is deliberately **not** a project dependency.

## Adding an eval clip (benchmark tooling)
Create `eval/<name>/` with an audio file and a transcript; `import.meta.glob` discovers it.
- transcript is `<clip-basename>.txt`, or `transcript.txt` when the folder holds one clip;
- a clip with no transcript still appears, marked unscored.
