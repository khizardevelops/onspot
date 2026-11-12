# Last Session

## 2026-11-12 (latest): P6 usage ledger complete

- **Ported:** rate-limit/refusal parsing, Groq tables/plan inference, ledger math and legacy JSON
  interop, locale-independent display text, and the full usage monitor (meters, aging, estimates,
  warnings, account-backed services).
- **Bridge/UI:** `usage.snapshot` + `usage_warning`; Settings and practice read through
  `usage/view.ts`, selecting core or legacy; core monitor starts lazily only for `useCore('usage')`.
- **Verified:** workspace tests/clippy/fmt, svelte-check 0 errors, production build, boundaries,
  SPDX 352, wasm rebuild, and `test:practice` (now checks the bridge snapshot and core monitor
  store). P5/P6 remain uncommitted.
- **Remaining external:** live-key meter comparison and desktop-webview usage-page smoke; no key
  or physical device in this session. P7 next when those are accepted.

