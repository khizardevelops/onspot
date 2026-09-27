#!/usr/bin/env bash
# Android build pipeline for onspot (Tauri v2).
#
#   scripts/android.sh init                 generate src-tauri/gen/android (once)
#   scripts/android.sh dev                  run on a connected device / emulator with hot reload
#   scripts/android.sh build [tauri args]   build (default: release APK for arm64 phones)
#   scripts/android.sh emulator-apk         debug APK for x86_64 emulators
#   scripts/android.sh env                  print the resolved toolchain
#
# Toolchain locations come from the environment, optionally from a gitignored
# scripts/android.local.env next to this file (see android.local.env.example).
# Android's Gradle needs JDK 17 or 21 and Rust needs the Android std targets
# (rustup), so neither has to be the system default.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [[ -f "$HERE/android.local.env" ]]; then
	# shellcheck disable=SC1091
	source "$HERE/android.local.env"
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/sdk}"
if [[ -z "${NDK_HOME:-}" ]]; then
	NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
fi
export NDK_HOME
[[ -n "${JAVA_HOME:-}" ]] && export JAVA_HOME && export PATH="$JAVA_HOME/bin:$PATH"
if [[ -n "${RUSTUP_HOME:-}" && -n "${CARGO_HOME:-}" ]]; then
	export RUSTUP_HOME CARGO_HOME
	export PATH="$CARGO_HOME/bin:$PATH"
fi
# Rust build output is large; keep it wherever android.local.env points.
[[ -n "${CARGO_TARGET_DIR:-}" ]] && export CARGO_TARGET_DIR

fail() { echo "android.sh: $*" >&2; exit 1; }
check() {
	[[ -d "$ANDROID_HOME" ]] || fail "Android SDK not found at ANDROID_HOME=$ANDROID_HOME"
	[[ -n "$NDK_HOME" && -d "$NDK_HOME" ]] || fail "Android NDK not found (set NDK_HOME or install one under \$ANDROID_HOME/ndk)"
	command -v java >/dev/null || fail "java not found (set JAVA_HOME to a JDK 17 or 21)"
	local major
	major="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/{print $2}')"
	[[ "$major" == 17 || "$major" == 21 ]] || fail "Android Gradle needs JDK 17 or 21, found $major (set JAVA_HOME)"
	command -v rustup >/dev/null || fail "rustup not found (set RUSTUP_HOME/CARGO_HOME); a distro Rust cannot add Android targets"
	rustup target list --installed | grep -q aarch64-linux-android || fail "missing Rust target: rustup target add aarch64-linux-android x86_64-linux-android"
}

cd "$ROOT"
cmd="${1:-help}"; shift || true
case "$cmd" in
	env)
		echo "ANDROID_HOME=$ANDROID_HOME"; echo "NDK_HOME=$NDK_HOME"; echo "JAVA_HOME=${JAVA_HOME:-<system>}"
		echo "rustc=$(command -v rustc) ($(rustc --version))"; echo "CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-<default>}"
		java -version 2>&1 | head -1 ;;
	init)  check; npx tauri android init "$@" ;;
	dev)   check; npx tauri android dev "$@" ;;
	build) check; if [[ $# -eq 0 ]]; then set -- --apk --target aarch64; fi; npx tauri android build "$@" ;;
	emulator-apk) check; npx tauri android build --apk --debug --target x86_64 "$@" ;;
	*) sed -n '2,11p' "$0"; exit 1 ;;
esac
