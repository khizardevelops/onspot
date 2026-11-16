# Usage ledger map (P6)

- Status: proposed for P6
- Date: 2026-11-12
- Sources: `src/lib/usage/{ledger,rateLimits,publishedLimits,format,monitor}.ts`
  (251 + 132 + 121 + 110 + 906 lines; verified in the working tree).
- Purpose: fix the accounting model and UI contract before moving it to Rust.

## What exists

`ledger.ts` is a device-local `localStorage` record (`onspot.usage.v1`, 24 h
retention). It stores successful cloud calls (`host`, `model`, `key_id`,
`at`, `tokens`, `reservedTokens`, `audioSeconds`, `characters`), the latest
`x-ratelimit-*` reading per scope, and limits named in refusals per window.
It is deliberately not in SQLite and never synced.

`rateLimits.ts` parses `x-ratelimit-*` headers (`RPM`/`RPD` request and
token windows) and 413/429 refusal bodies (`Limit`, `Used`, `Requested`,
`try again in`). `publishedLimits.ts` holds Groq's Free/Developer tables and
the plan inference from live headers. `monitor.ts` joins the ledger with a
clock, per-service/model views, account probes and warning thresholds.
`format.ts` produces the exact display strings with `Intl` (locale-dependent).

## Who reads it

| Caller | What it needs |
|---|---|
| `settings/UsageMonitor.svelte`, `UsageMeterRow.svelte` | `usageServices`, `usageClock`, `accounts*`/loading; formatted counts, resets and shares. |
| `PracticeScreen.svelte` | `usageWarnings` before a take; the same text in the composer. |
| LLM client/pacing | `recordCall`/`recordRefusal`, `usageLedger`, `scopeKey`, `keyIdOf`, published limits and plan. |
| Groq STT / cloud TTS adapters | `recordCall` with audio seconds or characters. |
| Insights/history | nothing; the ledger is not a database table. |

## Destination

- **`onspot-domain::usage`:** `UsageEntry` (call), `UsageScope`,
  `LimitWindow`, `HeaderBudget`, `HeaderLimits`, `RefusalLimit`, limit tables
  as data. Serialization keeps the legacy `localStorage` shapes.
- **`onspot-app::usage`:** `RecordUsage`, `UsageSnapshot` (the monitor's
  services/models/warnings), `MaybeWarn`; reset/window math through `Clock`.
  `FormatUsage` keeps the display contract, with the driver supplying locale
  (or the driver keeps formatting until a locale port exists).
- **Port:** `UsageRepo` — device-local JSON, **not** SQLite, with the same key
  and 24 h pruning. The web/Tauri host shim can keep `localStorage`; the core
  receives values through the bridge at boot/record time.
- **Bridge:** `usage.snapshot`, event `usage_warning { kind, provider,
  message_code }`; no recording command (adapters call it internally).

## Time and boundaries

The ledger prunes at `now - 24h`; limits use provider reset instants and the
monitor's `usageClock` (1 s tick). No calendar-midnight buckets are found in
the verified files; day windows are rolling 24 h and provider reset headers.
Tests must pin `now` and sweep 23:59:59.999, midnight, and reset instants.

## Work order

1. Capture ledger math, rate-limit parsing, published tables and display
   strings as goldens; port `rateLimits` + tables first.
2. Port the domain/use cases and `UsageRepo`; prove legacy localStorage rows
   aggregate identically.
3. Add `usage.snapshot`/`usage_warning`; rewire the Settings monitor and the
   practice warning line to the core path (the toggle is gone after P8).
4. Manual smoke against the archived monitor (`deprecated/`) on the same data.

## Open decisions

- **Formatting locale.** Resolved for P6: the core owns the locale-independent
  duration/quantity/portion/reset text; grouped/compact/relative strings stay
  in the driver's `Intl`. Revisit a locale port only if P7 needs core-side formatted copy.
- **Local storage of the ledger.** It must stay device-local and unsynced;
  the repo port should wrap the existing key rather than move rows to SQLite.
