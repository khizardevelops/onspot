//! Microphone access in the Linux desktop app.
//!
//! The window is a WebKitGTK webview, which denies every `getUserMedia`
//! request unless the app answers WebKit's permission request itself; the
//! learner then saw "Not allowed: the microphone" with no way to change it.
//! This enables media streams and allows microphone/camera requests only.
//! The webview only ever loads onspot's own pages. Windows (WebView2), macOS
//! and Android show the operating system's own permission prompt instead.

use tauri::{Manager, Runtime};
use webkit2gtk::glib::prelude::Cast;
use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

pub fn allow_in_main_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
  let Some(window) = app.get_webview_window("main") else {
    return Ok(());
  };
  window.with_webview(|webview| {
    let view = webview.inner();
    if let Some(settings) = WebViewExt::settings(&view) {
      settings.set_enable_media_stream(true);
    }
    view.connect_permission_request(|_, request| {
      if request.downcast_ref::<UserMediaPermissionRequest>().is_none() {
        return false; // not ours to decide: WebKit's default (deny) applies
      }
      request.allow();
      true
    });
  })
}
