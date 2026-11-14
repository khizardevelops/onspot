#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds the web bridge package (P1) into static/core-bridge/, which is
# gitignored. The Svelte driver loads it at runtime through
# src/lib/core-client/transport.ts, so the app builds and runs without it while
# the legacy backend is the default.
#
# Needs:
#   - the wasm32-unknown-unknown standard library. With rustup:
#     `rustup target add wasm32-unknown-unknown`. On a distro Rust without the
#     target (Arch's `rust` without `rust-wasm`), the `rust-src` component is
#     enough: the script falls back to `-Z build-std=std,panic_abort`.
#   - the wasm-bindgen CLI, at exactly the `wasm-bindgen` version Cargo resolved:
#       cargo install wasm-bindgen-cli --version <see Cargo.lock> --locked
#     or the matching prebuilt release archive on PATH.
#
# Run with `bun run bridge:wasm`. A custom CLI can be named with WASM_BINDGEN.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="wasm32-unknown-unknown"
TARGET_DIR="${CARGO_TARGET_DIR:-target}"
OUT_DIR="static/core-bridge"

if ! command -v wasm-bindgen >/dev/null 2>&1; then
	RESOLVED="$(awk '/^name = "wasm-bindgen"$/{found=1; next} found && /^version = /{gsub(/[version = "]/, ""); print; exit}' Cargo.lock)"
	echo "wasm-bindgen CLI not found. Install the version this tree resolved (${RESOLVED:-see Cargo.lock}):" >&2
	echo "  cargo install wasm-bindgen-cli --version ${RESOLVED:-<version>} --locked" >&2
	exit 1
fi

# A distro toolchain often ships only the host std. `rust-src` lets cargo build
# the missing target std from the same compiler, which keeps the metadata
# compatible (a stock rust-std component from another build does not).
BUILD_STD=()
TARGET_LIB_DIR="$(rustc --print target-libdir --target "$TARGET" 2>/dev/null || true)"
if [ ! -d "$TARGET_LIB_DIR" ]; then
	if [ ! -d "$(rustc --print sysroot)/lib/rustlib/src/rust/library" ]; then
		echo "The $TARGET standard library is missing and rust-src is not installed." >&2
		echo "Install one of them, or run with a rustup toolchain that has the target." >&2
		exit 1
	fi
	echo "The $TARGET standard library is missing; building it from rust-src."
	BUILD_STD=(-Z build-std=std,panic_abort)
	export RUSTC_BOOTSTRAP=1
fi

cargo build -p onspot-bridge --target "$TARGET" --features wasm --release "${BUILD_STD[@]}"
mkdir -p "$OUT_DIR"

wasm-bindgen "$TARGET_DIR/$TARGET/release/onspot_bridge.wasm" \
	--target web \
	--out-dir "$OUT_DIR" \
	--out-name onspot_bridge

echo "wrote $OUT_DIR/onspot_bridge.js and onspot_bridge_bg.wasm"
