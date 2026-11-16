<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# ADR-012 — One database connection; the core owns every query and the sync revision

- Status: accepted
- Date: 2026-11-16 (completion of P2/P8)
- Deciders: migration lead, after the post-P8 review

## Context

After P8 the TypeScript database layer was still live: `SqlDatabaseAdapter`
with its own migration chain, `TauriSqlAdapter` over `tauri-plugin-sql`, and
about a dozen call sites (prompt seeding, session-setup restore, the TTS
cache, stored recordings, reminders, insights take numbers, sync metadata). On
the desktop the same `onspot.db` was open through two SQLite stacks (sqlx and
rusqlite), each running migrations, guarded only by a 5 s busy timeout.

The review also found a data-loss path. Sync decides "has this device
changed?" from a device-local revision counter (`revision.ts`), bumped only by
the TypeScript adapter's prompt/session/take writes. Takes, renames and
deletions had moved to the Rust repositories, which never bumped it, so sync
could see an unchanged device and, with a changed remote, download over new
takes.

## Decision

- **The Rust core is the only code that reads or writes records.** New thin
  commands cover the remaining screens (`sessions.latest_setup`,
  `sessions.open_setup`, `sessions.save_setup`, `reminders.last_practised`,
  `audio.get`/`audio.put`, `sync.metadata`; `insights.build` returns take
  numbers). The use cases live in `onspot-app` (`session_setup`, `reminders`,
  `insights`, `prompts::prompt_candidates`); `practice.next_prompt` gathers
  and seeds its own candidates.
- **Desktop and Android: one connection.** `tauri-plugin-sql` and
  `@tauri-apps/plugin-sql` are removed with the file permissions only the
  TypeScript adapter used. The core opens `onspot.db` with rusqlite.
- **Web: the browser hosts the engine, nothing else.** `browserDatabase.ts`
  opens the OPFS sqlite-wasm worker and offers SQL plus whole-file
  export/import. The core migrates at boot, and `HostDatabaseFile` migrates
  and counts a database restored or synced down through the host
  (`HostAdapters.sql`).
- **The core owns the content revision** (`onspot-app::content_revision`).
  The records and history repositories are wrapped so prompt, session and take
  writes (and matched renames/deletes) bump it, whichever use case writes.
  `sync.now` reads it and records what each provider holds; a restore bumps it.
  It lives in the `DeviceStore` under the keys the web driver always used
  (`onspot.db.revision`, `onspot.sync.synced.<provider>`), so a device keeps its
  place.

## Consequences

- The TypeScript adapters, schema and revision tracker are archived under
  `deprecated/src/lib/adapters/db/`; `adapters/db/types.ts` keeps the record
  shapes screens read.
- The browser sync check proves a local write through the core makes the next
  sync ask before downloading.
- The dev long-takes seeder and storage check write through the format-1 JSON
  merge (`restore.legacy_json`), the app's own path; that format has no
  follow-up questions, so simulated takes show none.
