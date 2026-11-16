#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Regenerates the checked-in v0.2.4 SQLite fixture from its source SQL.
#
#   scripts/make-fixture.sh
#
# The fixture (crates/adapters/repo-sql/tests/fixtures/onspot-v0.2.4.sqlite)
# is a synthetic schema-9 database the repository and migration tests open; its
# source is `v9.sql` next to it. CI and fresh clones can rebuild it with this
# script if the binary is ever missing, and the Rust test asserts the source
# exists so the fixture never becomes unreproducible.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
FIXTURES="$ROOT/crates/adapters/repo-sql/tests/fixtures"
SQLITE="${SQLITE:-sqlite3}"

command -v "$SQLITE" >/dev/null || {
	echo "make-fixture: sqlite3 not found (set SQLITE=/path/to/sqlite3)" >&2
	exit 1
}

rm -f "$FIXTURES/onspot-v0.2.4.sqlite"
"$SQLITE" "$FIXTURES/onspot-v0.2.4.sqlite" < "$FIXTURES/v9.sql"
echo "wrote $FIXTURES/onspot-v0.2.4.sqlite"
