# Tasks

## iOS PWA live (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] Cloudflare Workers static assets deployed with `cf deploy --prebuilt` at
      **https://onspot.khizardevelops.workers.dev**; `scripts/cf-deploy.sh`, `.github/workflows/cloudflare.yml`,
      `static/_headers`; SPA fallback via `worker.config.json`.
- [x] Drop the Pages-only `_redirects` and `wrangler.toml`; Workers rejects that redirect as an
      infinite loop and applies the SPA fallback itself.
- [x] Drop the 26.5 MiB WebGPU-only ORT binary for Workers' 25 MiB asset cap; keep the 23.5 MiB
      WASM runtime.
- [x] Live verify: root/`/history/` 200, manifest, service worker no-cache, `_headers`
      (COOP/COEP/nosniff/referrer), 133 shell entries, SQLite WASM cached, offline History,
      iPhone 14 card.
- [ ] Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repository secrets for the CI deploy;
      set `VITE_GOOGLE_CLIENT_ID_WEB` and add the Worker origin to the Google OAuth web client.
- [x] Check/build/SPDX, deep-link registration, offline SQLite, update prompt/reload, iPhone 14
      dark, iPhone SE, iPad Pro, no overflow/errors.
- [ ] Optional cleanup: delete the empty legacy Pages project `onspot-4k1.pages.dev`.
- [x] Web app manifest, 192/512/maskable icons, 180 px Apple touch icon, light/dark theme colours,
      iOS meta and 28 launch images; `scripts/pwa-assets.sh` regenerates them.
- [x] Production web-only service worker (SvelteKit 3 `$app/service-worker`/`$app/manifest`/
      `$app/env`): shell precache, small-asset filter, WASM-on-first-use, offline shell with pinned
      base, no cross-origin API/model caching; `serviceWorker.register: false`.
- [x] Waiting-worker update card with Later/Reload; no automatic takeover.
- [x] iPhone/iPad install card plus permanent Settings → Learning section; local STT/voice stays
      available with a cloud nudge; installed state.
- [x] Pre-paint theme/status-bar meta and top safe-area padding.
- [x] Verify: check/build/SPDX, deep-link registration, offline deep link, update prompt/reload,
      iPhone 14 dark, iPhone SE, iPad Pro, no overflow/errors.
- [x] Live Chrome verification: root/`/history/`, manifest, service worker no-cache, `_headers`,
      deep links, 133-entry shell cache, SQLite WASM, offline History.
- [ ] Add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repository secrets for the CI deploy;
      set `VITE_GOOGLE_CLIENT_ID_WEB` and add the Worker origin to the Google OAuth web client;
      then verify Safari on a Mac VM if possible.
- [ ] Real iPhone/iPad: install from Safari (Share → Add to Home Screen), full-screen launch,
      icon/name/splash, safe areas in portrait/landscape, keyboard, gestures, Back, silent switch,
      interruptions, export/restore, offline after a language-data download.
- [ ] Decide the GitHub Pages migration notice period; keep the old origin up and add the
      export-and-move notice; redirect only after the notice period the user agrees.
- [ ] Google Drive popup in the installed app; if broken, hide Drive there with an honest note.
      WebDAV CORS.
- [ ] Local Piper and Whisper on an iPhone: measure memory/speed; if Whisper is killed, mark it
      unavailable with the reason but never remove the local download option wholesale.
- [x] iOS notification honesty: `notificationsSupported()` is false on Apple touch devices, so
      Reminder Settings offers only the in-app nudge and never requests system permission.
- [ ] Screen Wake Lock during downloads, clean restart/Retry, free-space display, and Web Share
      export.
- [ ] Performance on a ProMotion iPhone/iPad and `crossOriginIsolated`/single-thread note.
- [ ] README iPhone/iPad install section, `docs/releases/`, and move the idea to the archive when
      actually shipped and verified.
- [ ] Commit/push when the user asks (branch remains uncommitted).

## Brand v2 (2026-11-06)
- [x] Move every v1 asset into `brand-assets/v1/` and repoint its users.
- [x] v2 in `brand-assets/v2/`: squircle and circle icons, mark, four logos, construction,
      VectorCraft source, geometry scripts, README.
- [x] Amended to monochrome: white for dark mode, black for light mode, no colour.
- [x] Glyph: one shape, `currentColor`, mark alone and in both outlines (for themed icons, favicons, print).
- [x] Glyph ground dips around bar 3 (minimal 0.25 m gap; bar stays solid).
- [x] Every SVG recolourable (`currentColor`, default ink as `color`); `source/finish_svgs.py` after each export.
- [x] In-app logo (header, welcome page) is the v2 squircle tile, light/dark by theme.
- [x] Applied everywhere (circle): desktop/iOS/Android icons, adaptive layers, installers, favicon,
      PWA icons and splash, Flatpak icon and branding, README header (`scripts/brand-assets.sh`).

## First-run onboarding + mode glare (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] `/welcome/` three-step guide: coach key (Groq / DeepSeek / ChatGPT / Claude gateway /
      custom), optional Groq speech-to-text, on-device vs ElevenLabs voice, summary.
- [x] Test the key on a temporary endpoint before saving; failed keys are never written.
- [x] ElevenLabs key only for cloud TTS; honest cloud-vs-device copy.
- [x] `onspot.onboarding.v1` done/skipped flag; first-run redirect only when no LLM and flag null.
- [x] Settings → Learning → Setup guide; Practice's LLM gate points to `/welcome/`.
- [x] `data-glare` on Practice follows the live mode: casual blue-green, exam red; a draft's mode
      switch changes it immediately, and a started session locks it.
- [x] Boost the exam strength (22/18/16%) over casual (14/12/10%) so red does not read dimmer.
- [x] Three large soft blobs drift slowly on transform-only animations (38/46/52s), stopped by
      reduced motion; moved low so they show beneath the cards.
- [x] Archive both ideas in `docs/planning/archive/ideas.md` (2026-11-06).
- [x] Verify with Playwright 29/29, light/dark/phone screenshots, check/build/SPDX.
- [ ] Verify a live key against each provider and a real ElevenLabs key.
- [ ] Try the guide on a real phone and desktop WebKit; check the first-run redirect there.
- [ ] Commit/push when the user asks (not done; branch remains uncommitted).

## Dark-mode depth + translation note header (2026-11-06, branch `fix/dark-mode-visual-depth`)
- [x] Rebuild the dark surface ladder: page `#12110f`, card `#24211d`, inset `#1a1815`, key
      `#332e27`, well `#0d0c0b`; brighter border and text tokens.
- [x] Darken the dark paper texture (`PAGE.dark`, `KEY.dark`) so the page no longer renders near the
      card value.
- [x] Add subtle white catchlights to dark surfaces: `--shade-light` 0.20, `--glass-shade-light`
      0.18, lit glass-card top border, attempt-card top highlight, feedback card top light, header
      seams.
- [x] Raise the Feedback notebook to `#24211d` and its correction stock/hairlines.
- [x] Move a translation's tag and toggle onto the note header line; text below; own tag line per
      variant in Compare-all.
- [x] Restyle the note from the user's sticky-note mockup: washi tape, pastel paper, folded corner,
      tilt, dashed header, ink tab, regular Courier Prime, handwritten wavy controls.
- [x] Put "Each word" / alternatives at the far right (close X moved to lead the header); keep the
      longer "Hide each word" label on the same line at 390 px by hiding the decorative mark.
- [x] Replace the dashed/dotted stitched connector with one clean 1.5px line fading at both ends.
- [x] Stop the translation text being bold: import Courier Prime 400 and use it for translation lines.
- [x] Paginate the translations themselves: page 1 is the primary idiomatic translation, pages 2+
      are the alternatives, one at a time with a compact `‹ 1 / 4 ›` pager in the note header; default
      page 1, reset on view change/regeneration, wrap, constant note height; no pager for a single
      rendering.
- [ ] Look at the seeded note/pager screenshots with the user and tune copy or pager density if asked.
- [ ] Look at the seeded dark screenshots with the user and adjust the catchlight strength if asked.
- [ ] Verify on a real device / WebKitGTK; run a full-page automated contrast scan.
- [ ] Commit/push when the user asks (not done; branch is uncommitted).

## Planning ideas shipped (2026-11-06)
- [x] Settings → Learning capability guide (what onspot can and cannot improve).
- [x] Export one session's transcript and corrections as Markdown (History row + Practice session
      menu).
- [x] Language-data completion/failure notifications (toast; system notification when hidden).
- [x] Optional practice reminders (off by default; frequent ≈ daily, infrequent ≈ three days;
      in-app banner + best-effort system notification).
- [x] Word-for-word breakdown as horizontal pairs: source above rule above translation, each
      column centred; checked on desktop and at 390 px. Mobile keeps the same layout for now; the
      user will decide whether to revert phones to the earlier vertical list.
- [x] Archive the shipped items in `docs/planning/archive/ideas.md` (2026-11-06).
- [ ] Verify a real language-data download end to end: completion toast, error toast, and the
      system notification while the app is in the background.
- [ ] Verify a system reminder notification on a phone/desktop (permission granted, app hidden).
- [ ] Verify the Tauri `Export transcript` save dialog and the `.md` file on a desktop build.
- [ ] Decide whether the reminder should also be visible outside Practice (a small dot on History
      or Settings was not built).
- [ ] Commit/push when the user asks (not done; changes are uncommitted).

## Docs organisation (2026-11-03)
- [x] Split `docs/planning` into active `ideas.md` / `bugs.md` and mirrored history in
      `docs/planning/archive/`; moved fixed bugs and done/rejected ideas; updated `docs/README.md`.
- [x] Add `docs/planning/README.md` documenting the active/archive workflow for agents.
- [ ] Keep the active files current: when an idea ships or a bug is fixed, append it to the dated
      archive batch and remove it from the active file.

## Launch prep (2026-11-03)
- [x] README rewritten for non-technical learners: hook, Download CTA, download-vs-build split,
      French-first honesty, unsigned-build note; all dev details kept below.
- [x] Add an `[!IMPORTANT]` API-key banner and a two-minute Groq/ElevenLabs walkthrough at the top
      of the README, reinforced in the download and first-run steps.
- [x] Correct the five-minute recording claim (code caps at 60 s).
- [ ] Commit and push the README when the user asks.
- [ ] Fix the GitHub repo description typo ("langugae" → "language"; keep "inturn" as the author's
      wording) and add topics (language-learning, french, tauri, svelte, offline-first, privacy,
      whisper).
- [x] Draft release notes for v0.2.3 in `docs/releases/v0.2.3.md`. Published 2026-11-06 with new
      notes for v0.2.0–v0.2.2; release.yml now publishes `docs/releases/<tag>.md` itself.
- [x] Author CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, bug/feature/language issue templates
      and a PR template. Still to do: add `good first issue` / `help wanted` / platform labels.
- [ ] Enable GitHub Discussions with Announcements, General, Feature requests, Language requests
      and Development categories; pin a "Start here / known issues" post.
- [ ] Publish a language roadmap/status issue (French approved, Japanese in development, others
      demand-led) and a language-request issue for voting.
- [ ] Sign/notarize the Windows and macOS builds, or keep the README workaround prominent and add
      a troubleshooting page.
- [ ] Install and smoke-test every asset on real Windows, macOS (Intel + ARM), Linux (x64 + ARM)
      and Android hardware.
- [ ] Record a 30–60 s demo video/GIF (prompt → speak → feedback → hear the fix).
- [ ] Add a FAQ/troubleshooting page: getting a Groq key, microphone permission, model download,
      401/429 errors, SmartScreen/Gatekeeper, Android sideload, where data lives, backup/restore.
- [ ] Recruit 5–10 French beta testers and run a short task-based feedback script before any public
      post.
- [ ] Prepare a press kit: logo, screenshots, one-liner, 100/300-word blurbs, founder bio, links.

## Phone list after 0.2.2 (2026-11-02)
- [x] Phone bar in two rows; swipe up on the bar pulls Feedback up; stats tap-away + pin;
  slow-drag fixes; one playback speed button; text size per section; pop-up hides when its words
  are covered (state.md first entry; uncommitted).
- [x] Tried on the user's phone (Galaxy S24 FE): two-row bar, pull-up, stats tap-away and pin, speed
  button, text size all work; frame rates measured (state.md "120 fps pass").
- [x] APK icon: cause is the phone's Samsung Theme Park icon theme (state.md); the APK is right.
- [ ] User: re-apply/update the Theme Park icon theme (or let the assistant do it on the phone).
- [x] 120 fps pass: SVG noise textures → WebP/dropped, no fixed backgrounds, shade and sheet layers,
  sheet kept laid out, stack settles on `scrollend`; neo-snappy and textsize-v2 merged.
- [x] Language-of-instruction dropdown (all selects): portal, capped height, closes on pick.
- [x] Word meanings shifted by one: glosses keyed by word number; old saved meanings re-fetched.
- [x] Text size live canvas merged (state.md); worktree removed. Regression on :5173 after the merge:
  phone bar 32/32, gestures 34/34, speed 36/36, pop-up 25/25 + 11/11, live preview 122/122.
- [ ] Try the live preview on the phone (debug APK with everything is built:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`).
- [x] Insights rows overflowing on phones (grid-cols-1).
- [ ] Measure the desktop engines (WebView2, WebKitGTK, WKWebView) at their refresh rates.
- [x] Release 0.2.3 (tag `v0.2.3`, 2026-11-03): Latest, 15 files.
- [ ] Commit and push the `goto` `replace` fix (back.svelte.ts, TextSizeEditor.svelte) when asked.
- [x] GitHub has only `main` (feature branch deleted 2026-11-03).
- [ ] Delete the four old local branches (all contained in main)? Not asked yet.

## Every installer on x64 and ARM64 (2026-11-01)
- [x] release.yml: Intel Mac, ARM Linux (+ Flatpak), ARM Windows (.exe + .msi); test run green.
- [x] Merged to main and released as v0.2.1, then v0.2.2 (2026-11-02).
- [ ] Try the ARM and Intel builds on real hardware (none here).

## Automatic model choice + "Did you mean" changes toggle (2026-11-01)
- [x] Automatic (default) by languages, request size, per-minute and daily limits; verified (state.md).
- [x] Show/Hide changes in "Did you mean to say?".
- [ ] Measure model quality per language before approving a mid/low-resourced language (the trust
  levels in `AUTOMATIC_MODELS` are a judgement); consider Compound (70K TPM) once its JSON output
  is checked.
- [ ] Phone: the "Did you mean to say?" label wraps to two lines beside the two links.
- [x] Committed and pushed (30d0070..2742281); no tag yet.
- [x] Speaker button in a selection's meaning bubble (uncommitted; verified desktop + phone).
- [x] A held selection behaves as one unit for hover, click and tap; smaller speaker (uncommitted).
- [x] Pointer bridge from a selection to its bubble; readable dark-mode Feedback bookmark (uncommitted).
- [ ] User saw the selection bubble vanish while moving down to it; not reproduced in Chromium or
  Firefox. If it still happens, find out where (browser or desktop app/WebKitGTK).

## Desktop title bar + AppImage resize (2026-11-01)
- [x] Own thin title bar (WindowBar), `decorations: false`, macOS overlay traffic lights; AppImage
  forced to X11. Verified maximise/restore on Wayland and X11 paths via KWin (see state.md).
- [ ] User to click through the bar in the debug app (minimise, maximise/restore, close, drag,
  double-click, edge resize) and look at light mode; then commit and ship (v0.2.1?).
- [ ] Verify on Windows and macOS (CI builds only; no machine here).

## Brand: logo and app icon (2026-11-01)
- [x] Logo + app icon rebuilt in VectorCraft from the AI draft on a module grid (spec:
  `brand-assets/README.md`). Exports checked in VectorCraft's renderer and in resvg.
- [x] Wired in (2026-11-01): Tauri desktop + Android icons, favicon, header mark (macOS master on
  every platform, by the user's choice). Verified: `bun run check` 0/0; header at 1280 light/dark
  (tile on the 28px gutter, centred with the 32px keys, header height unchanged at 49px), favicon
  and image load (200), no overflow at 390px; Android masks simulated from the generated layers.
- [x] Favicon too small (user): web copy cropped to the tile (`app-icon-tile.svg`); header uses it
  at 28px. Re-verified: check 0/0, tile on the gutter, header 49px, served viewBox cropped.
- [x] Header mark still small (user): now 36px (the row's height; header stays 49px, centred with
  the keys). README shows the tile icon above the title.
- [x] Committed and pushed with the README icon beside the title and retaken Practice/History
  screenshots; released as v0.2.0.
- [ ] Not verified: a real Tauri build (Dock/taskbar/Flatpak icon) and an Android install.
- [ ] Decide whether `brand-assets/` is committed (nothing committed yet).
- [ ] Optional: horizontal lockup and a wordmark for light backgrounds ("spot" amber is too low
  contrast on Paper; needs a deeper amber).

## Card stack + paper timeline (2026-10-31)
- [x] Stack of index cards driven by the demo's scroll math (`cardStack.ts`), bury delay 0.35,
  tilt, depth fade; lock onto a card when scrolling stops; card on top = selected take; tall cards
  scroll inside themselves; arrival drop; paper timeline with playhead, hover expand, click to jump.
  Verified in headless Chromium: rest/mid/hover/jump screenshots (light, dark, phone), wheel notch =
  one card, nudge falls back, tall card scrolls before the stack moves (and resumes at its end when
  scrolling back), touch swipe lift + nudge + inner scroll, reduced motion, 19-take timeline keeps
  the current take in view, real fake-mic take dropped in smoothly, word selection/meanings unchanged.
- [ ] **Verify in the Tauri desktop (WebKitGTK):** wheel/trackpad feel of the lock, `inert`, `:has()`
  on the timeline, `filter: blur` cost with three buried cards.
- [ ] `ui-sandbox` mocks still show the old conveyor list (they were already stale).
- [x] Timeline hover loop fixed (static hover area); timeline on phones (tap to open, tap to jump,
  tap outside to close). Verified: pointer parked on the strip's right edge stays open (no flicker),
  far left of the open paper stays open, leaving closes; phone tap flow.
- [x] Rail removed; `AppHeader` top bar on Practice, History, Insights, Settings. Verified at 1280,
  1024 and 390px: no horizontal overflow, current section marked, links/theme/☰ menu work.
- [x] Paper index cards, `--page-gutter`, compact top bar, Feedback tab label clipping, phone layout
  (timeline + Feedback in the bar, one-row composer, mode in ⋯, 36px touch floor). Verified at 1280,
  1024, 390px, light and dark; phone timeline open/jump/close, Feedback open/close, no overflow.
- [x] Scroll direction unified (down = older, cards lift up), timeline newest first, translation
  notebook styling, tilt ±0.4°. Verified: wheel down/up one card each way; a long take scrolls inside
  then lifts away, and comes back at its end then scrolls up inside; a real take dropped in at
  scroll 0; translations (all three, alternative, 29-word list) on desktop, phone and dark.
- [x] Feedback panel notebook redesign. Verified at 1280 (light/dark), 1024, 820 and phone: no
  overflow, filters, empty filter note, by-type menu, card expand, stats sheet, close → rail/bar.
- [ ] Verify the 36px touch floor on a real phone (the user's build); raise `--touch-target` if taps miss.
- [ ] Dev pages (model lab, STT bench, UI sandbox) have no navigation since the rail went; add
  `AppHeader` there if they are used regularly.
- [x] Selection drawn as a highlighter stroke (yellow band, pooled start, chisel ends; dark variant).
  Verified at 2x: phrase, single word, a stroke across a line wrap, dark; text does not move; copy
  text unchanged; a partial touch selection is inked as whole words immediately.

## Spoken explanation and three-track card (2026-10-30)
- [x] LLM returns a faithful `correctedText` ("Did you mean to say?") and a tagged `explanation`;
  `naturalSpeech`/`summary` retired; migration 7; card tracks You said / Did you mean / Explanation;
  explanation auto-plays. Browser-verified with real Groq STT + LLM and ElevenLabs (2 takes).
- [x] Local explanation audio (2026-11-01): English Piper voice for the English, the selected target
  voice for target-language spans; user picks the English voice by listening (approval pending).
- [ ] ~~User-owned: local explanation audio.~~ Local Piper voices speak only the target language;
  the tags already mark which spans are target-language, so one option is an English Piper voice for
  the rest plus the target voice for tagged spans (two voice loads per explanation; one resident
  voice today). Until then explanation audio needs Cloud TTS.
- [x] Follow-up question has its own play/replay button (track `followUp`). Browser-verified.
- [x] Hover/tap word meanings for "You said" and "Did you mean" (one LLM call per take on first
  hover, stored in `attempts.word_glosses`). Verified desktop + touch phone; one label at a time.
- [x] Word-granular selection (mouse drag by words, double-click, Shift+click; touch snaps to
  words). Verified: mid-word drag → "avec ma sœur", mid-drag already whole words, Shift+click
  extends, double-click plays once and selects one word, later clicks still play, phone snap.
- [x] Expressions (model-found, validated) and custom-range selection meanings; two-line label.
  Verified: hover expression + highlight, mouse drag-select (1 call, then instant), older card not
  lifted, phone selection. Live model: market take → no expressions; rich sentence → il y a,
  tout à coup, besoin de, pommes de terre, tout à fait.
- [ ] Optional: hover meanings for the follow-up question and the explanation's highlighted words.
- [ ] Selections that span "You said" and "Did you mean" (two texts) show nothing by design; revisit
  if learners try it.
- [x] Teacher voice: model writes `line` per mistake + opening `note`; app validates each line and
  falls back only on failure. Live-verified on New York / j'ai allé / correct takes and in the app.
- [x] Explanation composed from `{ mistakes: [{said, say, why}], note }` and validated (no identical
  fix, no repeats/overlaps, ≤3), after the user saw "You said X. Say X". Live Groq runs on the
  user's cases: no broken output; the model still sometimes reads an odd phrase as a mistake.
- [x] Auto-play hardening: prime the shared player in the Start/Stop taps; "Tap ▶" notice on
  NotAllowedError. Verified in Chromium's normal policy; **verify in the Tauri desktop (WebKitGTK)**.
- [ ] Optional (frictionless): stop recording automatically after a silence. Not built: learners
  pause to think mid-answer, so it needs a tuned threshold and probably a setting.
- [x] Follow-up question as its own field with a hidden-by-default translation (user request);
  "mention each mistake once" rule. Browser-verified with a real take and an older `<ask>` take.
- [ ] Prompt compliance: GPT-OSS sometimes leaves mentioned French words (aller, être) untagged; the
  rule was tightened (the latest take tagged them) — check a few more takes and other models.
- [ ] `src/routes/ui-sandbox/` Mock cards still show the old single "natural version" button.
- [ ] Optional: the explanation is generated for every take; consider a per-language explanation
  word cap if long takes (5 min) need more than three mistakes covered.

## ElevenLabs voices (2026-10-30)
- [x] Hide Voice Library voices on the free plan; remove stale built-in ids; new default (Alice);
  replace the stored old default; readable 402.
- [x] Follow-up after the user still hit the 402: library voices hidden unless the plan is known
  paid; 402 → remember per key, switch to Alice, retry, toast. Browser-verified with a library voice
  saved on the free key (402 → 200 with Alice, no error box; picker 21 premade voices, 0 library).
- [ ] The `alif-bey-pey` key in `~/.keys` cannot list voices or read its plan (401
  missing_permissions); with it the picker cannot load voices at all — consider a clearer message.
- [ ] A paid ElevenLabs account was not available: verify library voices stay listed there.

## Usage monitor (2026-10-30)
- [x] Ledger of cloud calls (tokens, audio seconds, characters, headers, refusals), per key hash, in
  `localStorage`; Settings → Usage tab with per-model/per-account meters, sources and estimates;
  Practice notice. Browser-verified (real takes, injected TPD refusal, local TTS, phone/dark).
- [ ] Verify live `x-ratelimit-*` readings in the Tauri desktop/Android apps (code path untested at
  runtime; parsers are unit-checked against real header values).
- [ ] Verify DeepSeek `/user/balance` with a real key (CORS preflight allows the app origin).
- [x] Per-model Groq view: model chips (in-use model selected by default, follows Settings), each
  model's own meters/estimate; Free and Developer tables with plan detection from live headers.
  Browser-verified (default, picking, Settings switch and back, phone).
- [ ] Groq `compound`/`compound-mini`/`qwen3.6-27b` are not in Groq's published table; add them when
  the docs list them (they show this device's 24 h usage and live/reported figures until then).
- [ ] Developer-plan detection needs a desktop/Android run with a paid key.
- [x] Per-minute estimate uses Groq's admission rule (used + reserved prompt+max_tokens ≤ TPM);
  calls record `reservedTokens`. Free gpt-oss: about 2 takes a minute, not 3.
- [ ] Re-check `publishedLimits.ts` against Groq's rate-limits page periodically (dated 2026-10-30).

## Cloud limits for five-minute takes (researched 2026-10-30; mostly implemented 2026-11-01)
- [x] Rate-limit pacing + Groq model rotation (`adapters/llm/pacing.ts`), long takes evaluated and
  translated in parts, hover meanings per section. See state.md and decisions.md (2026-11-01).
- [ ] `MAX_RECORDING_SEC` is still 60: raise it once long takes are confirmed end to end (the
  simulated 3/5-minute takes in `/dev/long-takes/` exercise everything after transcription).
- [ ] Cloud TTS of a 5-minute text in one request (below) is still open; on-device TTS now speaks
  long texts sentence by sentence (agent work, 2026-11-01).
- [x] (superseded) Decide how a 5-minute take is evaluated. `MAX_RECORDING_SEC` is still 60 although the README
  promises up to five minutes. At 5 min (1 200-word cap) one evaluation needs ~15k output tokens
  plus a ~1.5–2.3k-token prompt, which exceeds the free-tier 8k TPM (GPT-OSS/Qwen) and Compound's
  8 192 max completion. Options: per-segment evaluation, translations on demand only, or Dev tier.
- [x] Live provider limits: `x-ratelimit-*` headers and `Limit N, Used U, Requested M` from 413/429
  bodies (incl. OTPM) feed the pacing, which pre-checks every request. (`/models` metadata not kept.)
- [ ] Verify with a key whether the **web** build can read Groq's `x-ratelimit-*` headers. A 401
  had `access-control-allow-origin: *` but no `access-control-expose-headers`; Tauri's HTTP plugin
  reads them regardless.
- [ ] Cloud TTS sends the whole text in one request. A 5-minute correction (~7k chars) is over
  OpenAI's 4 096-char cap; ElevenLabs exposes `maximum_text_length_per_request` on `GET /v1/models`.

## SvelteKit 3 migration (branch `migration`, 2026-10-04)
- [x] Migrate (sv migrate), check 0/0, build, preview smoke in Chromium (4 routes, nav, COOP/COEP).
- [ ] Exercise Practice with real STT/TTS/LLM on the restarted :5173 dev server; then the Tauri
  desktop + Android builds.
- [x] Commit and merge `migration` into main (`main` fast-forwarded 2026-10-06).
- [ ] Optional: Kit 3 polls `_app/version.json` hourly (`version.pollInterval`); set it to 0 in
  `vite.config.ts` if the Tauri/static build should not.

## Japanese (candidate → approved)
- [ ] Listening test of CSS10 / Mera / Tsukuyomi-chan; choose default + any processing profile.
- [ ] whisper-small q4 Japanese transcript review (CER) on real human-transcribed learner speech.
- [ ] Record evidence in docs/benchmarks, flip `approval.status`, test the download in a prod build.
- [ ] Verify a real Japanese evaluation with an LLM key (corrections offsets on unspaced text).
- [ ] Optional: furigana (ruby) for kanji in transcripts/corrections, neo-styled.

## Follow-ups from the 2026-10-03 audit
- [x] Audit + follow-up fixes committed by the user (`4bc2d94`).
- [ ] Verify the wrong-language flag with a real LLM call (only tested with a mocked response).
- [ ] Optional: detect the spoken language from audio (Whisper language-id / Groq `verbose_json`),
  since local Whisper forced to French can translate English speech into French text.
- [ ] Optional: multi-tab takeover for the web DB (BroadcastChannel → holder `pauseVfs()`); today a
  second tab only gets a clear "open in another tab" message.
- [ ] Run a real take with the downloaded model to exercise the reworked STT worker load/idle path.
- [ ] Tune the silent-take threshold (-46 dBFS) on a real microphone.
- [ ] Decide on light `--muted-foreground` contrast (4.25-4.49:1 on rail/inset/control).
- [ ] Tauri: atomic migrations/corrections. `.sqlite` import now has a schema-text check, but no
  rollback if the overwrite itself fails.

## Processing choices (2026-10-25)
- [x] Independent Local/Cloud choices for speech-to-text, the LLM and text-to-speech.
- [x] UI names are **Speech-to-text**, **LLM** and **Text-to-speech** (not transcription/read-back).
- [x] Language data checks/downloads only the parts the choices need; cloud-only needs no speech
  download. The first-run picker asks for the three Local/Cloud choices after the language.
- [x] LLM via a local OpenAI-compatible server (LM Studio, llama.cpp, Ollama); optional key; Tauri
  uses the HTTP plugin so the desktop app does not need server CORS.
- [x] ElevenLabs and OpenAI-compatible text-to-speech both supported, with separate keys/models/
  voices and an ElevenLabs voice picker.
- [x] Settings redesign: two tabs (Learning / Data), three capability rows with Local/Cloud switches
  and inline disclosures, no global preset, requirement count and data-flow line.
- [x] Practice gate driven by the same requirement model; links to the exact missing row.
- [x] Voice pickers open a searchable modal (pinned footer, keyboard navigation, AA detail text)
  instead of an oversized dropdown; Preview lives in the modal footer.
- [x] Row disclosure chevrons stay inside the card from 320 to 1440px.
- [x] `initSettings()` merges choices made before hydration instead of reverting them.
- [ ] Run a live ElevenLabs key through the preview and a real spoken reply.
- [ ] Run a real LM Studio/llama.cpp/Ollama server in the browser and desktop app.
- [ ] Tauri desktop: verify the plugin-http local-LLM path and the absence of CORS requirements.

## Phase 3 — BYOC sync (complete 2026-10-25)
- [x] Google Drive: app-private `appDataFolder`, desktop loopback PKCE, web Google Identity
  Services token client, resumable upload/download, refresh-token handling on desktop.
- [x] WebDAV for Nextcloud, ownCloud and pCloud: `webdav` package in the browser (server CORS
  required) and a PROPFIND/MKCOL/PUT/GET transport over the Tauri HTTP plugin elsewhere.
- [x] Whole-database snapshot sync with a device-local content revision, explicit conflict prompt,
  and a download path that reuses the restore rollback/rescue logic.
- [x] Settings → Cloud sync: provider choice, Google connect, WebDAV fields, Test connection,
  Sync now, last-sync time, conflict dialog, actionable errors.
- [ ] Verify Google Drive with a live account and the two OAuth client ids.
- [ ] Verify WebDAV against a real Nextcloud (browser CORS and desktop paths).
- [ ] Optional: background/automatic sync, or a sync-on-launch preference.
- [x] SQLite **import** (restore a `.sqlite` backup). Settings → Storage → Restore database and
  History's empty state replace the local DB from the exported file. Legacy format-1 JSON restore
  remains available and merges safely. Browser-verified; the Tauri path is now guarded by a
  schema-text check but still needs a runtime run.

## Inception closeout (2026-10-25)
- [x] AGPL SPDX headers on every owned source file; `bun run spdx` / `bun run spdx:check`.
- [x] `.github/workflows/release.yml` builds Windows `.exe`/`.msi`, macOS `.dmg` and Linux
  `.deb`/`.AppImage` bundles on tags or manual runs.
- [x] `docs/architecture/sync.md` and `docs/architecture/platforms.md`; iOS blockers documented.
- [ ] Run the Tauri `.sqlite` export/import round trip once on a desktop build.

## UI library follow-ups (neo-svelte, 2026-09-24)
- [x] Replace shadcn-svelte with @dvcol/neo-svelte across the app; remove shadcn/bits-ui.
- [ ] Visually check LanguageDownloadBar during a real download and LanguagePicker (forced).
- [ ] Revisit when neo-svelte 2.0 (cascade layers, NeoDialogConfirm) is published: simplify the
  specificity overrides and the composed confirm dialogs.
- [ ] Sweep remaining hand-rolled buttons (AudioBar, Transcript word buttons, the paper timeline is
  deliberately custom) for neo equivalents where they don't fight the stack/transcript layout.

## Resource usage
- [x] Native whisper.cpp STT for desktop and Android (branch `feature/native-speech`).
- [ ] Vulkan GPU for native whisper (`whisper-rs` feature `vulkan`); measure desktop and phone.
- [x] Shipped desktop builds: `GGML_NATIVE=OFF` in release.yml (whisper-rs passes `GGML_*` env to
  cmake), so released Linux packages run on any x86-64 with AVX2 (2026-11-01).
- [ ] CI: Android workflow must build whisper.cpp (cmake, clang/libclang, NDK env from android.sh).
- [ ] Release APK: check size/stripping with the plugin; remove the old Transformers.js cache on
  upgrade is wired (`removeSupersededStt`) but unverified on a real upgrade.
- [ ] Native TTS (sherpa-onnx Piper) as a second `speech/tts` engine, then the same interface.
- [x] whisper.cpp / wllama vs Transformers.js checked 2026-09-30 — rejected (8–12x slower).
- [x] **User-owned research** on STT RAM: resolved for the apps by native whisper.cpp (2026-10-04);
  the browser build still uses Transformers.js (`docs/research/model_problem.md`).
- [ ] Optional, browser build only: reduce Transformers.js STT RAM (ORT arena/session options,
  quantized-embedding export, shorter idle release); measure with `/stt-bench/`.

## Language system follow-ups
- [ ] Evaluate and approve the next language (STT + voice) with a human quality pass, then add one
  `LanguageDefinition`; see `docs/architecture/languages.md`.
- [ ] Re-test the downloaded language data on a truly cold cache end to end (Whisper 299 MB +
  Piper 64 MB) including Cancel mid-download and resume.
- [x] Settings voice preview: cached first generation, instant replay, confirm-gated regeneration.
  Browser-verified cold (45s, 64 MB voice) and warm (1s after reload).
- [x] Settings redesign from `prototype/to-be-implemented/Settings.html` on shadcn components
  (Card, Field, InputGroup, ToggleGroup, Item, Slider, Toggle), 4-band EQ + volume, live-tuned
  voice preview, SQLite export. Browser-verified (37 + 12 checks, export verified separately).
- [x] History neumorphic cards + disclosed search options; Practice neumorphic Exam/Casual switch;
  feedback sidebar width fix; Paper texture background + rail; rail buttons as analogue keys.
- [ ] Run the desktop (Tauri) export and import once for real: dialog save, `VACUUM INTO` temp
  file, fs read/write, close + overwrite `onspot.db`, reopen. `cargo check` passes but neither
  flow is runtime-tested.
- [x] Advanced Voice audio: in-page General/Advanced toggle, per-voice volume + 3-band EQ,
  reset-to-approved, tuned cache keys. Browser-verified (26/26), including
  neutral→tuned→neutral cache behavior.
- [ ] Keep `languageDownloadBytes` honest when a non-default voice is selected (currently the
  default voice's estimate is used for the combined bar).
- [ ] Optional STT input conditioning (high-pass/normalization) if a future language needs it —
  any change invalidates the approved WER baseline and must be re-measured first.

## Verification and polish backlog
- [ ] Complete a real end-to-end local practice run after downloading Whisper small q4: record,
  worker transcription, configured LLM evaluation, persistence, and read-back.
- [ ] Confirm the Tom EQ/loudness profile on real read-backs by ear (implemented, not yet heard).
- [ ] Consider pre-warming word audio for the visible attempt only if measured usage warrants the
  extra CPU/memory; Piper is now worker-hosted and releases its session after 90 seconds idle.
- [ ] Add per-file SPDX headers for AGPL-3.0 compliance.

## Completed agent tooling
- [x] Isolated, interactive chat-history UI sandbox at `src/routes/ui-sandbox/` (Mock components,
  hardcoded live data, real progressive disclosure with simulated backends) plus
  `bun run bundle:ui` (repomix, sandbox `.svelte` only). Production components and stores are
  deliberately untouched.
- [x] `bun run bundle` (`repomix/bundle.mjs`): export any page (auto-discovered from
  `src/routes`), several pages combined or separately, or any folder/file/glob, with local
  imports traced. Real repomix runs verified (settings: 103 files; settings+history at depth 1
  as markdown).
- [x] Consolidated all benchmark/metric data into `docs/benchmarks/` (`stt.md`, `tts.md`,
  `runtime.md`, `llm-providers.md`, `README.md`) and de-duplicated it out of `rules/constraints.md`,
  `known-issues.md`, `decisions.md` and `docs/research/model-vetting.md` (was `docs/plan.md`).
  The `approved-tech.md` / `groq-models.md` redirect stubs were deleted in the 2026-10-01 docs reorg.

## Completed product foundation
- [x] SvelteKit static SPA, Tauri v2 shell, COOP/COEP, and Tauri/OPFS database adapters.
- [x] Mic capture, worker-hosted local Whisper, Groq STT, structured LLM evaluation, persistence,
  Piper/cloud TTS, and cached audio.
- [x] Practice, History, Insights, Settings, search, replay, rename/delete, export, and toasts.
- [x] Language registry + approval metadata, first-run picker, manual language-data download with
  a global cancellable progress bar, and per-voice TTS processing (EQ/limiter/normalization).
- [x] Language-parameterized STT/TTS/prompts/translation, and a refreshed Groq model list that
  auto-refreshes from `GET /models` when a key is present.
- [x] Visual pass: no purple accent, 56px rail, tinted mode/filter selection, bordered feedback
  cards, collapsible session stats, flush composer, no Sparkles, single-row attempt header.
- [x] Explicit card selection with a compositor-driven attempt conveyor, deterministic 1050ms new
  card lift, and no previous/next overlay or scroll-driven selection.
- [x] Per-attempt translation v2: strict idiomatic/literal/word-for-word semantics, retroactive
  regeneration and persistence, optional idiomatic alternatives, word breakdown, and progressive
  disclosure without output headings.
- [x] Apple-inspired product polish using shadcn-svelte primitives throughout Practice,
  AttemptCard, FeedbackPanel, Settings and navigation; smooth phase/disclosure/menu/card
  transitions and a fixed mobile hamburger menu that consumes no layout row.
- [x] Refresh/restart data rehydration: Practice opens the newest persisted session, History
  distinguishes DB failure from empty storage, and dev startup cannot silently change OPFS origin.
- [x] Feedback severity summary is count-over-label (7/2/3/2 shape) with category filters in the
  hamburger menu; deletion corrections use strike-through + Remove and never an empty arrow.
- [x] Coach notes opens/closes as one smooth shadcn Collapsible: compact desktop rail, closed-first
  phone summary bar, automatic reopening for linked transcript corrections, and no 390px overflow.
- [x] Performance pass: Piper in a lazy worker, single-voice/idle disposal, capped Whisper WASM
  threads, idle Whisper disposal, transfer/stream-based large buffers, lower-frequency meters and
  playback identity, parallel correction loads, Latin-only fonts and offscreen card containment.

## Repository state
- Git history now exists (initial commit `0a2d033 save point`). This is no longer an all-untracked
  working tree.

### External UI critique (applied to real components, 2026-09-14)
Done: #1 active card state, #2 severity-vs-category colour, #3 real audio player, #4 offset-based
corrections (migration v5), #5 responsive split, #7 flat sections (no nested cards), #8 header
overflow menu, #9 translation labels + formal-alternative chips, #10 feedback accordion/filters/
severity summary, #11 conveyor softened + reduced-motion (kept per user), #13 key a11y fixes,
#14 word-click vs card-select clarified, #15 duplicate stats removed, #16 sortOrder, #18 segment
playback state, #19 translation retry + revert-on-failure, #24 copy pass.

Remaining: #6 design-token sweep (kill nonessential <12px arbitrary sizes), #12 replace the last
JS floor-spacer measurement with CSS if a reliable dynamic-height solution emerges, #13b complete
the 44px touch-target/contrast pass, #21 drop the redundant `attempt.translation` field, #23 add
true list virtualization if `content-visibility` proves insufficient for very long histories,
#25 container queries, #26 axe-core/Playwright a11y + visual-regression tests.
- [x] macOS bundle job failed in release.yml (v0.1.0): whisper.cpp's ggml uses `std::filesystem`
  (macOS 10.15+) and Tauri builds for 10.13 by default. Fixed 2026-11-01 with
  `bundle.macOS.minimumSystemVersion: "10.15"` (Tauri sets `MACOSX_DEPLOYMENT_TARGET` from it);
  verified by a manual release.yml run on main (see state.md).
- [ ] Linux AppImage aborts with EGL_BAD_PARAMETER on Arch (bundled WebKit); consider dropping it or
  building it on a newer base; .deb/.rpm work.
- [ ] Optional: default the web build (GitHub Pages) to Cloud processing, so first visitors are not
  pointed at the on-device data download.
