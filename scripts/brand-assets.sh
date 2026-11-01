#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later
# Renders every app icon and installer image from brand-assets/.
#
#   scripts/brand-assets.sh
#
# 1. App icons for desktop, Android (legacy) and iOS from the macOS master (`tauri icon`).
# 2. The Android adaptive icon: the mark alone on the Ink background, plus the themed-icon
#    (monochrome) layer. `tauri icon` would put the whole macOS tile in the foreground, which
#    the launcher then crops past Android's safe zone.
# 3. Installer images: the NSIS header and sidebar, the WiX banner and dialog, the DMG
#    background (src-tauri/icons/installer/, referenced from tauri.conf.json).
#
# Needs bun, resvg and ImageMagick 7 (`magick`). See brand-assets/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BRAND="$ROOT/brand-assets"
INK='#151412'

ANDROID_RES="$ROOT/src-tauri/gen/android/app/src/main/res"
INSTALLER_OUT="$ROOT/src-tauri/icons/installer"

# Adaptive icon layers are 108 dp square; pixels per density bucket.
declare -A ADAPTIVE_LAYER_PX=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)

render_app_icons() {
	(cd "$ROOT" && bunx tauri icon brand-assets/app-icon-1024.png --ios-color "$INK")
}

render_android_adaptive_icon() {
	local density
	for density in "${!ADAPTIVE_LAYER_PX[@]}"; do
		local size="${ADAPTIVE_LAYER_PX[$density]}"
		local dir="$ANDROID_RES/mipmap-$density"
		resvg -w "$size" "$BRAND/android/ic_launcher_foreground.svg" "$dir/ic_launcher_foreground.png"
		resvg -w "$size" "$BRAND/android/ic_launcher_monochrome.svg" "$dir/ic_launcher_monochrome.png"
	done

	# `tauri icon` writes this file without the monochrome layer (Android 13 themed icons).
	cat >"$ANDROID_RES/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
XML
}

# NSIS and WiX read 24-bit BMPs (BITMAPINFOHEADER, no alpha).
render_bitmap() {
	local name="$1"
	local png
	png="$(mktemp --suffix=.png)"
	resvg "$BRAND/installer/$name.svg" "$png"
	magick "$png" -background white -alpha remove -alpha off -type TrueColor "BMP3:$INSTALLER_OUT/$name.bmp"
	rm -f "$png"
}

render_installer_images() {
	mkdir -p "$INSTALLER_OUT"
	local name
	for name in nsis-header nsis-sidebar wix-banner wix-dialog; do
		render_bitmap "$name"
	done
	resvg "$BRAND/installer/dmg-background.svg" "$INSTALLER_OUT/dmg-background.png"
}

render_app_icons
render_android_adaptive_icon
render_installer_images
echo "Rendered app icons, the Android adaptive icon and installer images from brand-assets/."
