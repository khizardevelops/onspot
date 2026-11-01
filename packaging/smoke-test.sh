#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later

# Starts a Linux build of onspot under a virtual X server and waits until its
# frontend has loaded.
#
# The desktop app creates its database (<config>/app.onspot.desktop/onspot.db)
# from the frontend, so the file appearing means the webview started, rendered
# the page and ran its JavaScript. A webview that aborts, for example with
# "Could not create default EGL display", never gets that far.
#
# It uses throwaway XDG directories, so it never touches real app data.
#
# Usage: packaging/smoke-test.sh <command> [args...]
#   packaging/smoke-test.sh src-tauri/target/release/onspot
#   APPIMAGE_EXTRACT_AND_RUN=1 packaging/smoke-test.sh ./onspot_0.1.0_amd64.AppImage
# Needs xvfb-run (and xauth).

set -euo pipefail

readonly LOAD_TIMEOUT_SECONDS=120
readonly APP_IDENTIFIER="app.onspot.desktop"

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <command> [args...]" >&2
	exit 2
fi

profile_dir="$(mktemp -d)"
log_file="$profile_dir/app.log"

export XDG_CONFIG_HOME="$profile_dir/config"
export XDG_DATA_HOME="$profile_dir/data"
export XDG_CACHE_HOME="$profile_dir/cache"
export XDG_STATE_HOME="$profile_dir/state"
unset WAYLAND_DISPLAY

database="$XDG_CONFIG_HOME/$APP_IDENTIFIER/onspot.db"

# setsid makes the app the leader of its own process group, so stopping the
# group also stops Xvfb and the webview's helper processes.
setsid xvfb-run --auto-servernum "$@" >"$log_file" 2>&1 &
app_pid=$!

stop_app() {
	kill -TERM -- "-$app_pid" 2>/dev/null || true
	wait "$app_pid" 2>/dev/null || true
	rm -rf "$profile_dir"
}
trap stop_app EXIT

print_output() {
	echo "--- app output ---" >&2
	cat "$log_file" >&2
}

for ((waited_seconds = 0; waited_seconds < LOAD_TIMEOUT_SECONDS; waited_seconds++)); do
	if [ -f "$database" ]; then
		echo "onspot loaded its UI after ${waited_seconds}s."
		exit 0
	fi

	if ! kill -0 "$app_pid" 2>/dev/null; then
		echo "onspot exited before its UI loaded." >&2
		print_output
		exit 1
	fi

	sleep 1
done

echo "onspot did not load its UI within ${LOAD_TIMEOUT_SECONDS}s." >&2
print_output
exit 1
