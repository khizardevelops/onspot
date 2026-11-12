#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds the web bridge package (P1) into static/core-bridge/, which is
# gitignored. The Svelte driver loads it at runtime through
# src/lib/core-client/transport.ts, so the app builds and runs without it while
# the legacy backend is the default.
#
# Needs:
#   - the wasm32-unknown-unknown target (`rustup target add wasm32-unknown-unknown`)
#   - the wasm-bindgen CLI, at exactly the `wasm-bindgen` version Cargo resolved:
#       cargo install wasm-bindgen-cli --version <see Cargo.lock> --locked
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

cargo build -p onspot-bridge --target "$TARGET" --features wasm --release
mkdir -p "$OUT_DIR"

wasm-bindgen "$TARGET_DIR/$TARGET/release/onspot_bridge.wasm" \
	--target web \
	--out-dir "$OUT_DIR" \
	--out-name onspot_bridge

echo "wrote $OUT_DIR/onspot_bridge.js and onspot_bridge_bg.wasm"
