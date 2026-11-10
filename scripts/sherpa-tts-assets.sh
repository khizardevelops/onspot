#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Puts the official prebuilt sherpa-onnx text-to-speech WebAssembly runtime in
# static/sherpa-onnx/, where the on-device voice worker loads it (Supertonic).
#
# sherpa-onnx publishes its browser build only as GitHub release tarballs, each
# with a demo model baked in. The runtime files are identical across them, so
# this takes them from the smallest one and leaves the demo model behind. Each
# file is checked against the SHA-256 pinned below: upgrading means changing
# SHERPA_VERSION and every hash together (see .agents/handoff/references/commands.md).
#
# Usage: scripts/sherpa-tts-assets.sh   (idempotent; does nothing when the files match)
#        SHERPA_TTS_TARBALL=path/to/tarball scripts/sherpa-tts-assets.sh
#          uses an already-downloaded release tarball instead (it is still verified).

set -euo pipefail

SHERPA_VERSION="2.0.1"
TARBALL_NAME="sherpa-onnx-wasm-simd-${SHERPA_VERSION}-vits-piper-en_US-libritts_r-medium"
TARBALL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/${TARBALL_NAME}.tar.bz2"
TARBALL_SHA256="dabcdcbde457756143a28e1b3d249dcee8899477774009fa53e9d01404bc4947"

# The runtime: Emscripten glue, the WebAssembly binary, and the JavaScript TTS API.
RUNTIME_FILES=(
	"sherpa-onnx-wasm-main-tts.js bd80e2d3a1260eaea0f8e914c642d90fc96fa3e7645e179b029b8e77ff0aec54"
	"sherpa-onnx-wasm-main-tts.wasm b0a84503747bbefd2e06003518ba6588edaae8e4057ad72af9c5853d231531f1"
	"sherpa-onnx-tts.js 0f66769feeb012282c984014c56c7e3b5239d4ef9559298d196affda3b9e751e"
)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="${REPO_ROOT}/static/sherpa-onnx"

# sherpa-onnx is Apache-2.0 and the tarball carries no licence, so the served
# runtime gets the upstream LICENSE (from the v2.0.1 tag) committed beside its code.
LICENSE_SOURCE="${REPO_ROOT}/src/lib/speech/tts/supertonic/vendor/sherpa-onnx-LICENSE"

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	else
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

runtime_is_installed() {
	for entry in "${RUNTIME_FILES[@]}"; do
		read -r name expected <<<"${entry}"
		[[ -f "${DESTINATION}/${name}" ]] || return 1
		[[ "$(sha256_of "${DESTINATION}/${name}")" == "${expected}" ]] || return 1
	done
	cmp -s "${LICENSE_SOURCE}" "${DESTINATION}/LICENSE" || return 1
	return 0
}

if runtime_is_installed; then
	echo "sherpa-onnx ${SHERPA_VERSION} TTS runtime already in static/sherpa-onnx/"
	exit 0
fi

WORK_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "${WORK_DIRECTORY}"' EXIT

TARBALL="${SHERPA_TTS_TARBALL:-}"
if [[ -z "${TARBALL}" ]]; then
	TARBALL="${WORK_DIRECTORY}/runtime.tar.bz2"
	echo "Downloading ${TARBALL_URL}"
	curl --fail --location --silent --show-error --output "${TARBALL}" "${TARBALL_URL}"
fi

actual_tarball_sha="$(sha256_of "${TARBALL}")"
if [[ "${actual_tarball_sha}" != "${TARBALL_SHA256}" ]]; then
	echo "The sherpa-onnx tarball does not match its pinned SHA-256 (got ${actual_tarball_sha})." >&2
	exit 1
fi

runtime_paths=()
for entry in "${RUNTIME_FILES[@]}"; do
	read -r name _ <<<"${entry}"
	# Members are stored as ./<tarball name>/<file>.
	runtime_paths+=("./${TARBALL_NAME}/${name}")
done
tar -xjf "${TARBALL}" -C "${WORK_DIRECTORY}" "${runtime_paths[@]}"

mkdir -p "${DESTINATION}"
for entry in "${RUNTIME_FILES[@]}"; do
	read -r name expected <<<"${entry}"
	extracted="${WORK_DIRECTORY}/${TARBALL_NAME}/${name}"
	actual="$(sha256_of "${extracted}")"
	if [[ "${actual}" != "${expected}" ]]; then
		echo "${name} does not match its pinned SHA-256 (got ${actual})." >&2
		exit 1
	fi
	cp "${extracted}" "${DESTINATION}/${name}"
done
cp "${LICENSE_SOURCE}" "${DESTINATION}/LICENSE"

echo "Installed the sherpa-onnx ${SHERPA_VERSION} TTS runtime in static/sherpa-onnx/"
