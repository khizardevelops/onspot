#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-or-later

# Checks what an onspot AppImage bundles before it is released.
#
# - Some libraries must come from the host:
#   - libwayland-client: the host's Mesa EGL driver is built against the
#     host's Wayland and imports symbols an older bundled copy lacks
#     (wl_fixes_interface, Wayland 1.23+), so the driver fails to load and
#     WebKit aborts with "Could not create default EGL display:
#     EGL_BAD_PARAMETER" (onspot 0.1.0 on Arch).
#   - libreadline: the AppImage passes its library path on to the programs it
#     starts, and an older bundled copy breaks the host's /bin/sh, which
#     xdg-open runs under when the app opens a link.
# - WebKitGTK records, plays and decodes audio through GStreamer, and an
#   AppImage only finds the plugins it bundles
#   (bundle.linux.appimage.bundleMediaFramework).
#
# Usage: packaging/appimage/check.sh <path to .AppImage>

set -euo pipefail

readonly HOST_ONLY_LIBRARIES=(
	libwayland-client.so.0
	libreadline.so.8
)

# What onspot uses: WebM/Ogg Opus recording (MediaRecorder), WebM Opus
# streaming (MediaSource), decoding, and PulseAudio/PipeWire input and output.
readonly REQUIRED_GSTREAMER_PLUGINS=(
	libgstcoreelements.so
	libgstapp.so
	libgstplayback.so
	libgstaudioconvert.so
	libgstaudioresample.so
	libgstautodetect.so
	libgstpulseaudio.so
	libgstopus.so
	libgstmatroska.so
	libgstogg.so
)

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <path to .AppImage>" >&2
	exit 2
fi

appimage="$(realpath "$1")"
extract_dir="$(mktemp -d)"
trap 'rm -rf "$extract_dir"' EXIT

(cd "$extract_dir" && "$appimage" --appimage-extract >/dev/null)
library_dir="$extract_dir/squashfs-root/usr/lib"
plugin_dir="$library_dir/gstreamer-1.0"

problems=0

for library in "${HOST_ONLY_LIBRARIES[@]}"; do
	if [ -e "$library_dir/$library" ]; then
		echo "error: bundles $library, which must come from the host" >&2
		problems=$((problems + 1))
	fi
done

for plugin in "${REQUIRED_GSTREAMER_PLUGINS[@]}"; do
	if [ ! -f "$plugin_dir/$plugin" ]; then
		echo "error: missing GStreamer plugin $plugin" >&2
		problems=$((problems + 1))
	fi
done

if [ "$problems" -gt 0 ]; then
	echo "$(basename "$appimage"): $problems problem(s)" >&2
	exit 1
fi

echo "$(basename "$appimage"): no host-only libraries, all GStreamer plugins present."
