#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Generates the PWA icons and iOS launch (splash) images from the app icon
# (brand-assets/v2/platform/). The outputs are committed under static/pwa/;
# scripts/brand-assets.sh reruns this after the brand icon changes. Requires
# ImageMagick 7 (`magick`) and resvg.
#
# The splash list must stay in step with the media queries in src/app.html:
# iOS only uses an apple-touch-startup-image whose media query matches the
# device exactly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/brand-assets/v2/platform/app-icon-1024.png"
FOREGROUND="$ROOT/brand-assets/v2/platform/android/ic_launcher_foreground.svg"
OUT="$ROOT/static/pwa"
PAPER="#efeae0"
# The icon's disc (the raised keys' card stock): the background wherever an icon must be opaque.
DISC="#faf6ef"

for tool in magick resvg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ImageMagick 7 (magick) and resvg are required." >&2
    exit 1
  fi
done

if [[ ! -f "$SOURCE" ]]; then
  echo "App icon master not found: $SOURCE" >&2
  exit 1
fi

mkdir -p "$OUT/icons" "$OUT/splash"

# Standard PWA icons: the round icon on transparency ("any"), and on the disc
# colour where it must be opaque (iOS's home-screen icon). The maskable one is
# the Android adaptive icon's foreground, the mark alone on the disc colour: the
# launcher draws the shape. Rendered at 614 px and cropped to 512, the mark takes
# the same share of the maskable safe circle (80 %) as of the round icon's keyline.
magick "$SOURCE" -resize 192x192 "$OUT/icons/icon-192.png"
magick "$SOURCE" -resize 512x512 "$OUT/icons/icon-512.png"
foreground="$(mktemp --suffix=.png)"
resvg -w 614 "$FOREGROUND" "$foreground"
magick -size 512x512 "canvas:$DISC" \( "$foreground" -gravity center -crop 512x512+0+0 +repage \) \
  -gravity center -composite -alpha off "$OUT/icons/maskable-512.png"
rm -f "$foreground"
magick "$SOURCE" -resize 180x180 -background "$DISC" -alpha remove -alpha off "$OUT/icons/apple-touch-icon.png"

# CSS viewport sizes of current iPhones and iPads, and their pixel ratios.
# <name> <width> <height> <pixel-ratio>
while read -r name width height ratio; do
  screenshot_width=$((width * ratio))
  screenshot_height=$((height * ratio))
  smaller=$((width < height ? width : height))
  icon=$((smaller * ratio * 28 / 100))

  magick "$SOURCE" -resize "${icon}x${icon}" "/tmp/onspot-splash-icon-${name}.png"

  magick -size "${screenshot_width}x${screenshot_height}" "canvas:${PAPER}" \
    "/tmp/onspot-splash-icon-${name}.png" -gravity center -composite \
    "$OUT/splash/${name}-portrait.png"

  magick -size "${screenshot_height}x${screenshot_width}" "canvas:${PAPER}" \
    "/tmp/onspot-splash-icon-${name}.png" -gravity center -composite \
    "$OUT/splash/${name}-landscape.png"

  rm -f "/tmp/onspot-splash-icon-${name}.png"
done <<'DEVICES'
iphone-16-pro-max 440 956 3
iphone-16-pro 402 874 3
iphone-16 393 852 3
iphone-14-plus 428 926 3
iphone-12-13-14 390 844 3
iphone-11-xr 414 896 2
iphone-8-plus 414 736 3
iphone-13-mini 375 812 3
iphone-se 375 667 2
ipad-pro-12 1024 1366 2
ipad-pro-11 834 1194 2
ipad-air-10 820 1180 2
ipad-10 810 1080 2
ipad-mini 744 1133 2
DEVICES

echo "PWA assets written to $OUT"
