// SPDX-License-Identifier: AGPL-3.0-or-later

//! Applies the schema chain exactly as `SqlDatabaseAdapter.init()` does.
//!
//! A migration and its `schema_migrations` row are written together when the
//! driver supports `batch`; otherwise the statements run in order, matching the
//! legacy fallback. Either way an applied version is never replayed.

use std::collections::HashSet;

use onspot_ports::{SqlDriver, SqlError, SqlStatement, SqlValue};

use crate::schema::{migration, SCHEMA_VERSION};

/// The timestamp SQLite writes for an applied migration, in the same
/// `YYYY-MM-DDTHH:MM:SS.sssZ` shape as JavaScript's `toISOString()`.
const NOW_SQL: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// Creates `schema_migrations` and applies every missing version.
pub async fn migrate(db: &dyn SqlDriver) -> Result<(), SqlError> {
    db.execute("PRAGMA foreign_keys = ON", &[]).await?;
    db.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        &[],
    )
    .await?;

    let rows = db
        .select(
            "SELECT version FROM schema_migrations ORDER BY version",
            &[],
        )
        .await?;
    let applied: HashSet<i64> = rows
        .iter()
        .filter_map(|row| row.get("version").and_then(SqlValue::as_i64))
        .collect();

    for version in 1..=SCHEMA_VERSION {
        if applied.contains(&version) {
            continue;
        }
        let Some(sql) = migration(version) else {
            continue;
        };
        let mut statements: Vec<SqlStatement> = split_statements(sql)
            .into_iter()
            .map(SqlStatement::new)
            .collect();
        statements.push(SqlStatement::with_params(
            format!("INSERT INTO schema_migrations (version, applied_at) VALUES (?, {NOW_SQL})"),
            vec![SqlValue::Integer(version)],
        ));

        if db.supports_batch() {
            db.batch(&statements).await?;
        } else {
            for statement in statements {
                db.execute(&statement.sql, &statement.params).await?;
            }
        }
    }

    Ok(())
}

/// Splits a migration into statements, respecting single-quoted string
/// literals and doubled quotes, exactly like the legacy `splitStatements`.
pub fn split_statements(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut chars = sql.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_string {
            current.push(ch);
            if ch == '\'' {
                if chars.peek() == Some(&'\'') {
                    current.push(chars.next().expect("peeked doubled quote"));
                } else {
                    in_string = false;
                }
            }
        } else if ch == '\'' {
            in_string = true;
            current.push(ch);
        } else if ch == ';' {
            if !current.trim().is_empty() {
                out.push(current.trim().to_owned());
            }
            current.clear();
        } else {
            current.push(ch);
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_owned());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitter_respects_semicolons_inside_strings() {
        let statements = split_statements(
            "UPDATE prompts SET language = 'fr; en' WHERE language IS NULL;\n\
             INSERT INTO settings (key, value) VALUES ('a', 'it''s; fine');",
        );
        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains("'fr; en'"));
        assert!(statements[1].contains("'it''s; fine'"));
    }
}
