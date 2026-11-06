#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later
# Renders every app icon, the favicon and the installer images from brand-assets/v2/platform/.
#
#   scripts/brand-assets.sh
#
# 1. The master PNG and the app icons for desktop, Android (legacy) and iOS (`tauri icon`).
# 2. The Android adaptive icon: the mark alone on the card-stock background, plus the themed-icon
#    (monochrome) layer, the glyph. `tauri icon` would put the whole circle icon in the foreground,
#    and the launcher would draw its shape around the icon's own ring.
# 3. Installer images: the NSIS header and sidebar, the WiX banner and dialog, the DMG
#    background (src-tauri/icons/installer/, referenced from tauri.conf.json).
# 4. The web: the favicon and the in-app logo files in static/, then the PWA icons and the iOS
#    launch images (scripts/pwa-assets.sh).
#
# Regenerate the SVGs first if the art changed (brand-assets/v2/README.md, "On the platforms").
# Needs bun, resvg and ImageMagick 7 (`magick`).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
V2="$ROOT/brand-assets/v2"
PLATFORM="$V2/platform"
# The icon's disc: the raised keys' card stock (--key in src/app.css, light theme).
DISC='#faf6ef'

ANDROID_RES="$ROOT/src-tauri/gen/android/app/src/main/res"
INSTALLER_OUT="$ROOT/src-tauri/icons/installer"

# Adaptive icon layers are 108 dp square; pixels per density bucket.
declare -A ADAPTIVE_LAYER_PX=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)

render_app_icons() {
	resvg -w 1024 "$PLATFORM/app-icon.svg" "$PLATFORM/app-icon-1024.png"
	# iOS icons are opaque: the disc's colour fills the square, so the ring sits inside iOS's mask.
	(cd "$ROOT" && bunx tauri icon brand-assets/v2/platform/app-icon-1024.png --ios-color "$DISC")
}

render_android_adaptive_icon() {
	local density
	for density in "${!ADAPTIVE_LAYER_PX[@]}"; do
		local size="${ADAPTIVE_LAYER_PX[$density]}"
		local dir="$ANDROID_RES/mipmap-$density"
		resvg -w "$size" "$PLATFORM/android/ic_launcher_foreground.svg" "$dir/ic_launcher_foreground.png"
		resvg -w "$size" "$PLATFORM/android/ic_launcher_monochrome.svg" "$dir/ic_launcher_monochrome.png"
	done

	cat >"$ANDROID_RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">$DISC</color>
</resources>
XML

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
	resvg "$PLATFORM/installer/$name.svg" "$png"
	magick "$png" -background white -alpha remove -alpha off -type TrueColor "BMP3:$INSTALLER_OUT/$name.bmp"
	rm -f "$png"
}

render_installer_images() {
	mkdir -p "$INSTALLER_OUT"
	local name
	for name in nsis-header nsis-sidebar wix-banner wix-dialog; do
		render_bitmap "$name"
	done
	resvg "$PLATFORM/installer/dmg-background.svg" "$INSTALLER_OUT/dmg-background.png"
}

copy_web_assets() {
	# The favicon fills its box: the icon cropped to its keyline.
	cp "$PLATFORM/app-icon-tile.svg" "$ROOT/static/app-icon.svg"
	# The in-app logo (AppHeader, the welcome page): masks over the accent colour.
	cp "$V2/app-icon-circle-light-tile.svg" "$V2/app-icon-circle-dark-tile.svg" "$ROOT/static/"
	"$HERE/pwa-assets.sh"
}

render_app_icons
render_android_adaptive_icon
render_installer_images
copy_web_assets
echo "Rendered the app icons, the Android adaptive icon, installer images and web assets from brand-assets/v2/."
echo "If the icon changed, bump ?v= on its links in src/app.html and static/manifest.webmanifest: browsers keep icons by URL."
