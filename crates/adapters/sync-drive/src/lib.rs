// SPDX-License-Identifier: AGPL-3.0-or-later

//! Google Drive snapshot sync: list, download and upload over the HttpClient
//! and OAuthBroker ports.
//!
//! Ported from `src/lib/adapters/sync/google/drive.ts` in P7. The backup stays
//! in the app-private `appDataFolder`, so the learner's normal Drive listing
//! never shows it. The upload is resumable because the database carries base64
//! audio and can exceed the simple-upload size limit.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use onspot_ports::{
    CancelToken, CoreError, HttpBytesRequest, HttpBytesResponse, HttpClient, OAuthBroker,
    RemoteSnapshot, SyncAccount, SyncProvider,
};

const FILE_NAME: &str = "onspot.sqlite";
const FILE_FIELDS: &str = "id,name,modifiedTime,size,md5Checksum";
const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const SQLITE_MIME: &str = "application/vnd.sqlite3";
const MAX_ERROR_BODY_CHARS: usize = 2000;

/// The Drive implementation of the sync provider contract.
pub struct DriveSync {
    http: Arc<dyn HttpClient>,
    oauth: Arc<dyn OAuthBroker>,
}

impl DriveSync {
    /// Builds the provider over the driver's HTTP client and token broker.
    pub fn new(http: Arc<dyn HttpClient>, oauth: Arc<dyn OAuthBroker>) -> Self {
        Self { http, oauth }
    }

    /// Sends an authorized request, retrying once with a refreshed token.
    async fn authorized(&self, request: &HttpBytesRequest) -> Result<HttpBytesResponse, CoreError> {
        let token = self.oauth.access_token(false).await?;
        let response = self
            .http
            .send_bytes(&with_authorization(request, &token), &CancelToken::new())
            .await?;

        if response.status != 401 {
            return Ok(response);
        }

        let refreshed = self.oauth.access_token(true).await?;
        self.http
            .send_bytes(
                &with_authorization(request, &refreshed),
                &CancelToken::new(),
            )
            .await
    }

    /// Finds the one snapshot in the app-private folder.
    async fn find_remote(&self) -> Result<Option<RemoteSnapshot>, CoreError> {
        let query = format!(
            "spaces=appDataFolder&q={}&fields={}",
            encode_component("name = 'onspot.sqlite' and trashed = false"),
            encode_component(&format!("files({FILE_FIELDS})"))
        );
        let request = HttpBytesRequest {
            method: String::from("GET"),
            url: format!("{FILES_URL}?{query}"),
            headers: BTreeMap::new(),
            body: Vec::new(),
        };
        let response = self.authorized(&request).await?;
        require_ok(&response, "Google Drive lookup")?;

        let body = json_body(&response.body, "Google Drive lookup")?;
        Ok(first_file(&body).map(remote_from_file))
    }

    async fn start_upload_session(
        &self,
        bytes: &[u8],
        remote: Option<&RemoteSnapshot>,
    ) -> Result<String, CoreError> {
        let file_path = remote
            .map(|remote| format!("/{}", encode_component(&remote.id)))
            .unwrap_or_default();
        let query = format!(
            "uploadType=resumable&fields={}",
            encode_component(FILE_FIELDS)
        );
        let metadata = match remote {
            Some(_) => format!(r#"{{"name":"{FILE_NAME}"}}"#),
            None => format!(r#"{{"name":"{FILE_NAME}","parents":["appDataFolder"]}}"#),
        };
        let mut headers = BTreeMap::new();
        headers.insert(
            String::from("Content-Type"),
            String::from("application/json; charset=UTF-8"),
        );
        headers.insert(
            String::from("X-Upload-Content-Type"),
            String::from(SQLITE_MIME),
        );
        headers.insert(
            String::from("X-Upload-Content-Length"),
            bytes.len().to_string(),
        );

        let request = HttpBytesRequest {
            method: if remote.is_some() {
                String::from("PATCH")
            } else {
                String::from("POST")
            },
            url: format!("{UPLOAD_URL}{file_path}?{query}"),
            headers,
            body: metadata.into_bytes(),
        };
        let response = self.authorized(&request).await?;
        require_ok(&response, "Google Drive upload")?;

        header_value(&response.headers, "location").ok_or_else(|| {
            CoreError::new(
                "sync.drive_session_missing",
                "Google Drive did not return an upload session. Try again.",
            )
        })
    }

    async fn upload_file(
        &self,
        bytes: &[u8],
        remote: Option<&RemoteSnapshot>,
    ) -> Result<RemoteSnapshot, CoreError> {
        let session_url = self.start_upload_session(bytes, remote).await?;

        let mut headers = BTreeMap::new();
        headers.insert(String::from("Content-Type"), String::from(SQLITE_MIME));
        headers.insert(String::from("Content-Length"), bytes.len().to_string());

        let request = HttpBytesRequest {
            method: String::from("PUT"),
            url: session_url,
            headers,
            body: bytes.to_vec(),
        };
        let response = self.authorized(&request).await?;
        require_ok(&response, "Google Drive upload")?;

        if let Ok(body) = json_body(&response.body, "Google Drive upload") {
            if body.get("id").and_then(|id| id.as_str()).is_some() {
                return Ok(remote_from_file(&body));
            }
        }

        // A few proxies drop the final metadata body; re-read the file instead
        // of reporting a failed upload that actually succeeded.
        self.find_remote().await?.ok_or_else(|| {
            CoreError::new(
                "sync.drive_upload_missing",
                "Google Drive finished the upload but the backup could not be found.",
            )
        })
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SyncProvider for DriveSync {
    fn id(&self) -> &'static str {
        "google-drive"
    }

    async fn connect(&self) -> Result<SyncAccount, CoreError> {
        let _ = self.find_remote().await?;
        Ok(SyncAccount {
            label: String::from("Google Drive"),
        })
    }

    async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError> {
        self.find_remote().await
    }

    async fn download(&self, remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError> {
        let request = HttpBytesRequest {
            method: String::from("GET"),
            url: format!("{FILES_URL}/{}?alt=media", encode_component(&remote.id)),
            headers: BTreeMap::new(),
            body: Vec::new(),
        };
        let response = self.authorized(&request).await?;
        require_ok(&response, "Google Drive download")?;
        Ok(response.body)
    }

    async fn upload(
        &self,
        bytes: &[u8],
        remote: Option<&RemoteSnapshot>,
    ) -> Result<RemoteSnapshot, CoreError> {
        self.upload_file(bytes, remote).await
    }
}

fn with_authorization(request: &HttpBytesRequest, token: &str) -> HttpBytesRequest {
    let mut authorized = request.clone();
    authorized
        .headers
        .insert(String::from("Authorization"), format!("Bearer {token}"));
    authorized
}

fn remote_from_file(file: &serde_json::Value) -> RemoteSnapshot {
    let text = |key: &str| {
        file.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned()
    };
    let size = file
        .get("size")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<u64>().ok());
    let modified_at = text("modifiedTime");

    RemoteSnapshot {
        id: text("id"),
        name: text("name"),
        modified_at: modified_at.clone(),
        // Drive always returns md5Checksum for a completed binary upload. The
        // modification time is a safe fallback if a proxy strips the checksum.
        etag: {
            let checksum = text("md5Checksum");
            if checksum.is_empty() {
                modified_at
            } else {
                checksum
            }
        },
        size,
    }
}

fn first_file(body: &serde_json::Value) -> Option<&serde_json::Value> {
    body.get("files")?.as_array()?.first()
}

fn json_body(body: &[u8], action: &str) -> Result<serde_json::Value, CoreError> {
    serde_json::from_slice(body).map_err(|error| {
        CoreError::new(
            "sync.drive_unreadable",
            format!("{action} returned an unreadable response: {error}"),
        )
    })
}

fn header_value(headers: &BTreeMap<String, String>, name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

fn require_ok(response: &HttpBytesResponse, action: &str) -> Result<(), CoreError> {
    if response.is_success() {
        return Ok(());
    }

    let body = response.text();
    let trimmed = body.trim();
    let detail = if trimmed.is_empty() {
        String::new()
    } else {
        format!(": {}", truncate(trimmed))
    };
    let code = if response.status == 401 {
        "sync.reconnect_required"
    } else {
        "sync.request_failed"
    };

    Err(CoreError::new(
        code,
        format!("{action} failed (HTTP {}){detail}.", response.status),
    ))
}

fn truncate(value: &str) -> String {
    let mut truncated: String = value.chars().take(MAX_ERROR_BODY_CHARS).collect();
    if truncated.len() < value.len() {
        truncated.push('…');
    }
    truncated
}

/// Percent-encodes one query value (RFC 3986 unreserved characters stay).
fn encode_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        let unreserved = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if unreserved {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct FakeHttp {
        responses: Mutex<Vec<HttpBytesResponse>>,
        requests: Mutex<Vec<HttpBytesRequest>>,
    }

    impl FakeHttp {
        fn with(responses: Vec<HttpBytesResponse>) -> Arc<Self> {
            let fake = FakeHttp::default();
            *fake.responses.lock().expect("responses") = responses;
            Arc::new(fake)
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait]
    impl HttpClient for FakeHttp {
        async fn send(
            &self,
            _request: &onspot_ports::HttpRequest,
            _token: &CancelToken,
        ) -> Result<onspot_ports::HttpResponse, CoreError> {
            Err(CoreError::new(
                "test.unused",
                "text requests are not expected",
            ))
        }

        async fn send_bytes(
            &self,
            request: &HttpBytesRequest,
            _token: &CancelToken,
        ) -> Result<HttpBytesResponse, CoreError> {
            self.requests
                .lock()
                .expect("requests")
                .push(request.clone());
            Ok(self.responses.lock().expect("responses").remove(0))
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait(?Send)]
    impl HttpClient for FakeHttp {
        async fn send(
            &self,
            _request: &onspot_ports::HttpRequest,
            _token: &CancelToken,
        ) -> Result<onspot_ports::HttpResponse, CoreError> {
            Err(CoreError::new(
                "test.unused",
                "text requests are not expected",
            ))
        }

        async fn send_bytes(
            &self,
            request: &HttpBytesRequest,
            _token: &CancelToken,
        ) -> Result<HttpBytesResponse, CoreError> {
            self.requests
                .lock()
                .expect("requests")
                .push(request.clone());
            Ok(self.responses.lock().expect("responses").remove(0))
        }
    }

    #[derive(Default)]
    struct FakeOAuth {
        tokens: Mutex<Vec<bool>>,
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[async_trait]
    impl OAuthBroker for FakeOAuth {
        async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError> {
            self.tokens.lock().expect("tokens").push(force_refresh);
            Ok(if force_refresh {
                String::from("fresh-token")
            } else {
                String::from("token")
            })
        }
    }

    #[cfg(target_arch = "wasm32")]
    #[async_trait(?Send)]
    impl OAuthBroker for FakeOAuth {
        async fn access_token(&self, force_refresh: bool) -> Result<String, CoreError> {
            self.tokens.lock().expect("tokens").push(force_refresh);
            Ok(if force_refresh {
                String::from("fresh-token")
            } else {
                String::from("token")
            })
        }
    }

    fn response(status: u16, headers: &[(&str, &str)], body: &[u8]) -> HttpBytesResponse {
        HttpBytesResponse {
            status,
            headers: headers
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
            body: body.to_vec(),
        }
    }

    fn provider(http: Arc<FakeHttp>, oauth: Arc<FakeOAuth>) -> DriveSync {
        DriveSync::new(http, oauth)
    }

    #[test]
    fn a_probe_finds_the_app_private_file() {
        let http = FakeHttp::with(vec![response(
            200,
            &[],
            br#"{"files":[{"id":"f1","name":"onspot.sqlite","modifiedTime":"2026-11-13T10:00:00Z","size":"4096","md5Checksum":"abc"}]}"#,
        )]);
        let oauth = Arc::new(FakeOAuth::default());
        let remote = futures::executor::block_on(provider(http.clone(), oauth).probe())
            .expect("probe")
            .expect("remote");

        assert_eq!(remote.id, "f1");
        assert_eq!(remote.etag, "abc");
        assert_eq!(remote.size, Some(4096));

        let requests = http.requests.lock().expect("requests");
        assert!(requests[0].url.contains("spaces=appDataFolder"));
        assert_eq!(requests[0].headers["Authorization"], "Bearer token");
    }

    #[test]
    fn an_empty_folder_has_no_remote_file() {
        let http = FakeHttp::with(vec![response(200, &[], b"{}")]);
        let oauth = Arc::new(FakeOAuth::default());
        let remote = futures::executor::block_on(provider(http, oauth).probe()).expect("probe");
        assert!(remote.is_none());
    }

    #[test]
    fn an_expired_token_is_refreshed_and_the_request_retried_once() {
        let http = FakeHttp::with(vec![
            response(401, &[], b"expired"),
            response(200, &[], br#"{"files":[]}"#),
        ]);
        let oauth = Arc::new(FakeOAuth::default());
        let remote = futures::executor::block_on(provider(http.clone(), oauth.clone()).probe())
            .expect("probe");

        assert!(remote.is_none());
        assert_eq!(*oauth.tokens.lock().expect("tokens"), vec![false, true]);
        let requests = http.requests.lock().expect("requests");
        assert_eq!(requests[1].headers["Authorization"], "Bearer fresh-token");
    }

    #[test]
    fn an_upload_opens_a_resumable_session_then_puts_the_bytes() {
        let http = FakeHttp::with(vec![
            response(
                200,
                &[("Location", "https://upload.example/session/1")],
                b"{}",
            ),
            response(
                200,
                &[],
                br#"{"id":"f1","name":"onspot.sqlite","modifiedTime":"2026-11-13T10:00:00Z","size":"12","md5Checksum":"after"}"#,
            ),
        ]);
        let oauth = Arc::new(FakeOAuth::default());
        let remote = futures::executor::block_on(
            provider(http.clone(), oauth).upload(b"SQLite format", None),
        )
        .expect("upload");

        assert_eq!(remote.id, "f1");
        assert_eq!(remote.etag, "after");

        let requests = http.requests.lock().expect("requests");
        assert_eq!(requests[0].method, "POST");
        assert!(requests[0]
            .url
            .starts_with("https://www.googleapis.com/upload/drive/v3/files"));
        let metadata = String::from_utf8(requests[0].body.clone()).expect("json");
        assert!(metadata.contains("appDataFolder"));
        assert_eq!(requests[1].method, "PUT");
        assert_eq!(requests[1].url, "https://upload.example/session/1");
        assert_eq!(requests[1].body, b"SQLite format");
    }

    #[test]
    fn a_replaced_file_uses_patch_and_no_parent() {
        let http = FakeHttp::with(vec![
            response(
                200,
                &[("location", "https://upload.example/session/2")],
                b"{}",
            ),
            response(200, &[], br#"{"id":"f1","name":"onspot.sqlite"}"#),
        ]);
        let oauth = Arc::new(FakeOAuth::default());
        let existing = RemoteSnapshot {
            id: String::from("f1"),
            name: String::from("onspot.sqlite"),
            modified_at: String::from("2026-11-13T10:00:00Z"),
            etag: String::from("before"),
            size: Some(8),
        };
        futures::executor::block_on(
            provider(http.clone(), oauth).upload(b"SQLite", Some(&existing)),
        )
        .expect("upload");

        let requests = http.requests.lock().expect("requests");
        assert_eq!(requests[0].method, "PATCH");
        assert!(requests[0].url.ends_with(
            "/f1?uploadType=resumable&fields=id%2Cname%2CmodifiedTime%2Csize%2Cmd5Checksum"
        ));
        let metadata = String::from_utf8(requests[0].body.clone()).expect("json");
        assert!(!metadata.contains("parents"));
    }

    #[test]
    fn a_download_returns_the_snapshot_bytes() {
        let http = FakeHttp::with(vec![response(200, &[], b"SQLite format 3\0")]);
        let oauth = Arc::new(FakeOAuth::default());
        let remote = RemoteSnapshot {
            id: String::from("f1"),
            name: String::from("onspot.sqlite"),
            modified_at: String::from("2026-11-13T10:00:00Z"),
            etag: String::from("e1"),
            size: Some(16),
        };
        let bytes = futures::executor::block_on(provider(http.clone(), oauth).download(&remote))
            .expect("download");
        assert_eq!(bytes, b"SQLite format 3\0");

        let requests = http.requests.lock().expect("requests");
        assert!(requests[0].url.ends_with("/f1?alt=media"));
    }

    #[test]
    fn a_permanent_auth_failure_asks_the_learner_to_reconnect() {
        let http = FakeHttp::with(vec![response(401, &[], b"bad"), response(401, &[], b"bad")]);
        let oauth = Arc::new(FakeOAuth::default());
        let error =
            futures::executor::block_on(provider(http, oauth).probe()).expect_err("unauthorized");
        assert_eq!(error.code, "sync.reconnect_required");
    }

    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(encode_component("name = 'x'"), "name%20%3D%20%27x%27");
    }
}
