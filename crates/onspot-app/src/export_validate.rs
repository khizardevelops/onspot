// SPDX-License-Identifier: AGPL-3.0-or-later

//! Backup format checks, ported from `src/lib/utils/export.ts`.

/// SQLite's file-format header.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// Tables every onspot database must declare.
const REQUIRED_TABLES: &[&str] = &[
    "schema_migrations",
    "sessions",
    "attempts",
    "corrections",
    "audio_assets",
    "settings",
];

/// True when the bytes start with SQLite's file-format header.
pub fn is_sqlite_database(data: &[u8]) -> bool {
    data.starts_with(SQLITE_MAGIC)
}

/// Rejects a foreign SQLite file before it can replace the local database.
///
/// SQLite stores each table's `CREATE TABLE` text in the file, so the schema is
/// visible without opening a connection.
pub fn is_onspot_database(data: &[u8]) -> bool {
    let text = String::from_utf8_lossy(data).to_lowercase();
    REQUIRED_TABLES.iter().all(|table| {
        let quoted = "create table";
        let mut search_from = 0;
        while let Some(position) = text[search_from..].find(quoted) {
            let after = &text[search_from + position + quoted.len()..];
            let after = after.trim_start();
            let after = after
                .strip_prefix("if not exists")
                .unwrap_or(after)
                .trim_start();
            let after = after.trim_start_matches(['"', '\'', '`']);
            if after.starts_with(table) {
                return true;
            }
            search_from += position + quoted.len();
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_header_is_checked_byte_for_byte() {
        assert!(is_sqlite_database(b"SQLite format 3\0and more"));
        assert!(!is_sqlite_database(b"SQLite format 2\0"));
        assert!(!is_sqlite_database(b"short"));
    }

    #[test]
    fn requires_every_onspot_table_with_sql_quoting() {
        let schema = REQUIRED_TABLES
            .iter()
            .map(|table| format!("CREATE TABLE IF NOT EXISTS \"{table}\" (id text)"))
            .collect::<Vec<_>>()
            .join(";");
        assert!(is_onspot_database(schema.as_bytes()));
        assert!(!is_onspot_database(b"CREATE TABLE sessions (id text)"));
    }
}
