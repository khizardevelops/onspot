// SPDX-License-Identifier: AGPL-3.0-or-later

//! Which display protocol GTK draws the window with on Linux.

/// Runs the AppImage on X11 (XWayland in a Wayland session).
///
/// The AppImage carries the GTK 3 and WebKitGTK of the Ubuntu 22.04 machine it
/// is built on. On a current Wayland compositor their Wayland code lets the page
/// and the window fall out of step: after maximise or restore the page keeps its
/// old size (cut off, or with an empty strip beside it), and resizing lags.
/// Under X11 the same libraries resize correctly (KDE Plasma 6, 2026-11-01).
/// The Flatpak and the .deb/.rpm use the system's current GTK and stay on Wayland.
///
/// Leaves `GDK_BACKEND` alone when the user has set it, and needs `DISPLAY`
/// (an X server, which Wayland desktops provide through XWayland).
/// Must run before GTK starts and before any other thread exists.
pub fn prefer_x11_inside_appimage() {
  let is_appimage = std::env::var_os("APPIMAGE").is_some();
  let backend_chosen = std::env::var_os("GDK_BACKEND").is_some();
  let has_x_server = std::env::var_os("DISPLAY").is_some();

  if is_appimage && !backend_chosen && has_x_server {
    std::env::set_var("GDK_BACKEND", "x11");
  }
}
