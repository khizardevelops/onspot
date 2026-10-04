#!/usr/bin/env bash
# Builds whisper.cpp with ggml's WebGPU backend for the browser (model lab spike).
#
# Needs emsdk and a whisper.cpp checkout; defaults match this machine
# (see .agents/handoff/references/commands.md). Output: src/routes/model-lab/vendor/whisper-webgpu/
# (gitignored), loaded by src/routes/model-lab/whispergpu.worker.ts. Not static/: Vite serves
# static files without the COOP/COEP headers, and the pthread workers then never start.
#
#   tools/whisper-webgpu/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DEV_CACHE="${DEV_CACHE:-/mnt/data/not_synced/dev-cache}"
EMSDK="${EMSDK_DIR:-$DEV_CACHE/emsdk}"
WHISPER="${WHISPER_DIR:-$DEV_CACHE/whisper.cpp}"
BUILD="${BUILD_DIR:-$DEV_CACHE/whisper-webgpu-build}"
OUT="$ROOT/src/routes/model-lab/vendor/whisper-webgpu"

# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

emcmake cmake -S "$WHISPER" -B "$BUILD" -G Ninja \
	-DCMAKE_BUILD_TYPE=Release \
	-DGGML_WEBGPU=ON \
	-DGGML_WEBGPU_JSPI=ON \
	-DGGML_OPENMP=OFF \
	-DWHISPER_BUILD_EXAMPLES=OFF \
	-DWHISPER_BUILD_TESTS=OFF \
	-DWHISPER_BUILD_SERVER=OFF \
	-DBUILD_SHARED_LIBS=OFF
cmake --build "$BUILD" --target whisper -j"$(nproc)"

mapfile -t LIBS < <(find "$BUILD" -name '*.a' | sort)

mkdir -p "$OUT"
em++ -O3 -std=c++17 -pthread -fwasm-exceptions \
	-I"$WHISPER/include" -I"$WHISPER/ggml/include" \
	"$HERE/binding.cpp" \
	-Wl,--start-group "${LIBS[@]}" -Wl,--end-group \
	--use-port=emdawnwebgpu \
	-sJSPI \
	-sJSPI_EXPORTS='["wgpu_init","wgpu_init_stream","wgpu_full"]' \
	-sEXPORTED_FUNCTIONS='["_wgpu_init","_wgpu_init_stream","_wgpu_full","_wgpu_text","_wgpu_system_info","_wgpu_free","_malloc","_free"]' \
	-sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","UTF8ToString","stringToNewUTF8"]' \
	-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB \
	-sSTACK_SIZE=5MB -sPTHREAD_POOL_SIZE=4 \
	-o "$OUT/whisper-webgpu.js"

ls -la "$OUT"
