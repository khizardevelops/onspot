#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later
# Renders the paper textures in src/lib/textures/ from their SVG sources to WebP.
#
#   scripts/textures.sh
#
# The sources are SVG noise (feTurbulence). Used directly as CSS backgrounds, a browser
# renders that filter again whenever the surface moves or scrolls (measured on a Galaxy
# S24 FE: a slow drag of the Feedback sheet ran at 33 fps, with the sheet's tiles redrawn
# on every frame; 120 fps once the noise was a bitmap). As images they are drawn once and
# only composited after that, in every engine onspot runs in.
#
# Each texture is rendered at twice its CSS size: grain this fine looks the same on denser
# screens, and fine noise is what makes these files large.
#
# The Feedback panel's and the timeline's overall grain were dropped rather than rendered:
# at 6–7% opacity they changed the paper by under one grey level (light and dark), yet
# they were what made those surfaces redraw.
#
# Needs resvg and ImageMagick 7 (`magick`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEXTURES="$(cd "$HERE/../src/lib/textures" && pwd)"
WEBP_QUALITY=80

# name: width and height in px of the rendered image (twice the size the CSS draws it at).
declare -A RENDER_SIZE=(
	[tape-crepe]='320 80'
	[tape-grain]='240 240'
	[bookmark-grain]='240 240'
	[bookmark-fibres]='180 180'
)

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

for name in "${!RENDER_SIZE[@]}"; do
	read -r width height <<<"${RENDER_SIZE[$name]}"
	resvg -w "$width" -h "$height" "$TEXTURES/$name.svg" "$scratch/$name.png"
	magick "$scratch/$name.png" -quality "$WEBP_QUALITY" -define webp:alpha-quality=100 "$TEXTURES/$name.webp"
	echo "$name.webp  ${width}x${height}  $(du -h "$TEXTURES/$name.webp" | cut -f1)"
done
