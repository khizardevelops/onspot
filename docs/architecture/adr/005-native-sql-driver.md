# ADR-005 — Native SQL driver: rusqlite, one SQLite, plugin-sql kept

Status: accepted (P2, 2026-11-12); plugin-sql removed by ADR-012 (2026-11-16). The rusqlite pin is no longer forced and can move with a deliberate upgrade.

## Context

P2 moves the schema, migrations and repositories into `onspot-adapter-repo-sql`,
which needs a native SQL engine on desktop and Android. The shell still
registers `tauri-plugin-sql` for the legacy TypeScript path until P8, and that
plugin already links SQLite through sqlx.

## Decision

- Use **`rusqlite` 0.32 with the `bundled` feature** as the native `SqlDriver`.
  The version is pinned by `libsqlite3-sys`: it declares `links = "sqlite3"`, so
  only one copy may exist in the graph, and `tauri-plugin-sql` 2.0 (sqlx 0.8)
  needs the 0.30 generation. rusqlite 0.37 would force 0.35 and downgrade sqlx,
  changing the legacy path in a data-compatibility phase. 0.32 shares 0.30.
- One connection behind a `std::sync::Mutex`, `busy_timeout` 5 s and
  `PRAGMA foreign_keys = ON` per connection. This mirrors the legacy adapter's
  one engine per process; queries are short and local.
- **Keep `tauri-plugin-sql` registered** until P8, as the phase prompt
  recommends. Both paths open the same `onspot.db` in the app config directory;
  the migration chain is idempotent and `schema_migrations` is the arbiter, so
  booting either path first is safe.
- `SqlDriver::batch` stays optional. rusqlite runs a real transaction;
  drivers without connection-scoped transactions report unsupported and the
  migration runner applies statements in order, exactly the legacy fallback.
- Do not change `journal_mode` or any other pragma that affects the file: the
  legacy path and restored backups must see the same layout.

## Consequences

- Desktop and Android compile bundled SQLite (slower cold builds); no host
  SQLite version can change behaviour.
- Commands that touch storage block briefly on the command thread, as the
  plugin's synchronous wrappers did. A worker actor would be a later change
  behind the same port.
- The web driver still uses `sqlite-wasm` in the existing worker through a host
  shim; SQL text and the migration chain are shared, the engines are not.
- `VACUUM INTO` export/import remains on the legacy adapter until P7/P8.

## Rejected

- **sqlx for the core:** it would tie the core's driver to the plugin's pool
  semantics and the same `links` constraint, for no capability P2 needs.
- **Dropping plugin-sql now:** the legacy UI is still the default and the phase
  explicitly keeps it until P8.
- **Two SQLite libraries:** impossible with `links = "sqlite3"`.
