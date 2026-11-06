#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Deploys the built SPA to Cloudflare Workers static assets with `cf`.
#
# `cf deploy` cannot build a SvelteKit project yet, but its `--prebuilt` path
# accepts a Build Output Specification. This script builds the SPA, assembles
# that output and deploys it. The Worker serves the app at its root and uses
# Cloudflare's single-page-application fallback for deep links.
#
# Usage:
#   scripts/cf-deploy.sh            # build and deploy
#   CF_DRY_RUN=1 scripts/cf-deploy.sh
#
# Auth: `cf auth login` (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
# Optional: CF_WORKER_NAME (default onspot), CF_COMPATIBILITY_DATE.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_NAME="${CF_WORKER_NAME:-onspot}"
COMPATIBILITY_DATE="${CF_COMPATIBILITY_DATE:-2026-11-06}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/onspot-cf.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required." >&2
  exit 1
fi

if ! command -v cf >/dev/null 2>&1; then
  echo "The Cloudflare CLI (cf) is required: bun add -g cf" >&2
  exit 1
fi

cd "$ROOT"
bun run build

OUTPUT="$STAGE/.cloudflare/output/v0"
ASSETS="$OUTPUT/workers/default/assets"
mkdir -p "$ASSETS"
cp -a "$ROOT/build/." "$ASSETS/"

# Workers static assets handles the SPA fallback in worker.config.json; the
# Pages _redirects form is rejected as an infinite loop there.
rm -f "$ASSETS/_redirects"

# The default on-device speech path is WASM (the 23.5 MiB asyncify runtime).
# The 26.5 MiB WebGPU-only ORT binary exceeds Workers' 25 MiB per-asset limit
# and is not used unless VITE_STT_DEVICE=webgpu is explicitly built.
if [[ -d "$ASSETS/_app/immutable/workers/assets" ]]; then
  find "$ASSETS/_app/immutable/workers/assets" \
    -name 'ort-wasm-simd-threaded.jsep-*.wasm' -delete
fi

if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  printf '{"buildContext":{"isPreview":false},"accountId":"%s"}\n' "$CLOUDFLARE_ACCOUNT_ID" \
    >"$OUTPUT/config.json"
else
  printf '{"buildContext":{"isPreview":false}}\n' >"$OUTPUT/config.json"
fi

cat >"$OUTPUT/workers/default/worker.config.json" <<EOF
{
  "name": "$WORKER_NAME",
  "compatibilityDate": "$COMPATIBILITY_DATE",
  "assets": { "notFoundHandling": "single-page-application" }
}
EOF

cd "$STAGE"
if [[ "${CF_DRY_RUN:-0}" == "1" ]]; then
  cf deploy --prebuilt --dry-run
else
  cf deploy --prebuilt
fi
