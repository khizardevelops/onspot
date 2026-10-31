// SPDX-License-Identifier: AGPL-3.0-or-later

//! Loopback redirect capture for the Google OAuth installed-app flow.
//!
//! Google redirects the system browser to `http://127.0.0.1:<port>`. A listener
//! bound by `oauth_loopback_start` accepts that one request, answers with a
//! small page, and hands the authorization code back to the webview.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const DEFAULT_TIMEOUT_MS: u64 = 5 * 60_000;
const MAX_REQUEST_BYTES: usize = 8 * 1024;

const SUCCESS_HTML: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>onspot</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.5">
<h1>Google Drive connected</h1>
<p>You can close this window and return to onspot.</p>
</body></html>"#;

const ERROR_HTML: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>onspot</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; line-height: 1.5">
<h1>Google Drive was not connected</h1>
<p>Return to onspot and try again.</p>
</body></html>"#;

/// The query values Google sent back to the loopback address.
#[derive(Debug, Serialize)]
pub struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// One pending loopback listener per app process.
#[derive(Default)]
pub struct OAuthState {
    pending: Mutex<Option<oneshot::Receiver<OAuthCallback>>>,
}

/// Binds a loopback port and waits in the background for Google's redirect.
///
/// @returns The ephemeral port the webview must use as `redirect_uri`.
#[tauri::command]
pub async fn oauth_loopback_start(state: State<'_, OAuthState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Could not start the Google sign-in listener: {error}"))?;

    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the sign-in listener address: {error}"))?
        .port();

    let (sender, receiver) = oneshot::channel();

    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "The sign-in listener state is unavailable.".to_string())?;

        *pending = Some(receiver);
    }

    tauri::async_runtime::spawn(async move {
        let callback = accept_callback(listener)
            .await
            .unwrap_or_else(|message| OAuthCallback {
                code: None,
                state: None,
                error: Some(message),
            });

        let _ = sender.send(callback);
    });

    Ok(port)
}

/// Waits for the browser to reach the loopback listener.
///
/// @param timeout_ms How long to wait for the learner to finish signing in.
/// @returns The authorization code and state, or Google's error.
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: State<'_, OAuthState>,
    timeout_ms: Option<u64>,
) -> Result<OAuthCallback, String> {
    let receiver = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "The sign-in listener state is unavailable.".to_string())?;

        pending
            .take()
            .ok_or_else(|| "No Google sign-in is waiting. Start the connection again.".to_string())?
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));

    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(callback)) => Ok(callback),
        Ok(Err(_)) => Err("The sign-in listener closed before Google answered.".into()),
        Err(_) => Err("Google sign-in timed out. Try again.".into()),
    }
}

async fn accept_callback(listener: TcpListener) -> Result<OAuthCallback, String> {
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|error| format!("The sign-in listener stopped: {error}"))?;

    let mut buffer = vec![0u8; MAX_REQUEST_BYTES];
    let read = stream
        .read(&mut buffer)
        .await
        .map_err(|error| format!("Could not read the sign-in response: {error}"))?;

    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request.lines().next().unwrap_or_default();
    let target = request_line.split_whitespace().nth(1).unwrap_or("/");

    let callback = parse_callback(target)?;

    let body = if callback.error.is_some() {
        ERROR_HTML
    } else {
        SUCCESS_HTML
    };

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;

    Ok(callback)
}

fn parse_callback(target: &str) -> Result<OAuthCallback, String> {
    let url = url::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|error| format!("Google returned an unreadable sign-in response: {error}"))?;

    let parameters: HashMap<String, String> = url.query_pairs().into_owned().collect();

    Ok(OAuthCallback {
        code: parameters.get("code").cloned(),
        state: parameters.get("state").cloned(),
        error: parameters.get("error").cloned(),
    })
}

#[cfg(test)]
mod tests {
    use super::{accept_callback, parse_callback};
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn loopback_returns_the_code_and_state() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a loopback listener");
        let address = listener.local_addr().expect("a bound address");
        let server = tokio::spawn(accept_callback(listener));

        let mut client = tokio::net::TcpStream::connect(address)
            .await
            .expect("a loopback client");
        client
            .write_all(b"GET /?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .await
            .expect("the request");
        client.shutdown().await.ok();

        let callback = server
            .await
            .expect("the listener task")
            .expect("the callback");

        assert_eq!(callback.code.as_deref(), Some("abc"));
        assert_eq!(callback.state.as_deref(), Some("xyz"));
    }

    #[test]
    fn reads_code_and_state() {
        let callback = parse_callback("/?code=abc&state=xyz").expect("a valid callback");

        assert_eq!(callback.code.as_deref(), Some("abc"));
        assert_eq!(callback.state.as_deref(), Some("xyz"));
        assert!(callback.error.is_none());
    }

    #[test]
    fn reads_a_denied_authorization() {
        let callback = parse_callback("/?error=access_denied").expect("a valid callback");

        assert_eq!(callback.error.as_deref(), Some("access_denied"));
        assert!(callback.code.is_none());
        assert!(callback.state.is_none());
    }
}
