#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prints the GitHub release description for a tag, from docs/releases/<tag>.md.
#
# The file's "# onspot X.Y.Z" heading is dropped, because the release page
# already shows the version as its title. Fails if the file does not exist,
# so a release is never published without its notes.
#
# Usage:
#   scripts/release-notes.sh v0.2.3                 # print the description
#   scripts/release-notes.sh v0.2.3 > notes.md      # for gh or a workflow
#
# To fix the description of a release that is already published:
#   scripts/release-notes.sh v0.2.3 | gh release edit v0.2.3 --notes-file -

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tag="${1:?Usage: scripts/release-notes.sh <tag, e.g. v0.2.3>}"
notes_file="$ROOT/docs/releases/$tag.md"

if [[ ! -f "$notes_file" ]]; then
	echo "No release notes for $tag: write docs/releases/$tag.md before tagging." >&2
	exit 1
fi

# Skip a first-line "# " heading, then any blank lines before the text starts.
awk '
	NR == 1 && /^# / { next }
	!started && /^[[:space:]]*$/ { next }
	{ started = 1; print }
' "$notes_file"
