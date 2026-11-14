// SPDX-License-Identifier: AGPL-3.0-or-later

//! WebDAV snapshot sync: PROPFIND, PUT, GET, MKCOL and DELETE over the
//! HttpClient port.
//!
//! Ported from `src/lib/adapters/sync/webdav.ts` in P7. The browser and the
//! desktop app send identical requests; only the driver's HTTP transport
//! differs, and CORS is the browser's concern, not this adapter's.

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine as _;
use onspot_ports::{
    CancelToken, CoreError, HttpBytesRequest, HttpBytesResponse, HttpClient, RemoteSnapshot,
    SyncAccount, SyncProvider,
};

/// The one file name a WebDAV destination holds for this app.
const SNAPSHOT_NAME: &str = "onspot.sqlite";

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:getlastmodified/>
    <d:getcontentlength/>
  </d:prop>
</d:propfind>"#;

/// Provider error bodies are shown to the learner, so keep the actionable tail.
const MAX_ERROR_BODY_CHARS: usize = 2000;

/// One configured WebDAV destination.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebdavConfig {
    /// The collection URL, e.g. `https://cloud.example.com/remote.php/dav/files/you`.
    pub base_url: String,
    /// Where the snapshot lives inside that collection.
    pub path: String,
    pub username: String,
    pub password: String,
}

impl WebdavConfig {
    /// The snapshot path, defaulting to the one file the app keeps.
    fn snapshot_path(&self) -> &str {
        let trimmed = self.path.trim();
        if trimmed.is_empty() {
            SNAPSHOT_NAME
        } else {
            trimmed
        }
    }
}

/// A parsed PROPFIND result.
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebdavStat {
    etag: Option<String>,
    last_modified: Option<String>,
    size: Option<u64>,
}

/// One WebDAV destination over the driver's HTTP client.
pub struct WebdavSync {
    config: WebdavConfig,
    http: Arc<dyn HttpClient>,
}

impl std::fmt::Debug for WebdavSync {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WebdavSync")
            .field("base_url", &self.config.base_url)
            .field("path", &self.config.snapshot_path())
            .finish()
    }
}

impl WebdavSync {
    /// Builds a destination, rejecting a missing URL or username up front.
    pub fn new(config: WebdavConfig, http: Arc<dyn HttpClient>) -> Result<Self, CoreError> {
        if config.base_url.trim().is_empty() {
            return Err(CoreError::new(
                "sync.webdav_url_missing",
                "Add the WebDAV server URL in Settings first.",
            ));
        }
        if config.username.trim().is_empty() {
            return Err(CoreError::new(
                "sync.webdav_username_missing",
                "Add the WebDAV username in Settings first.",
            ));
        }
        Ok(Self { config, http })
    }

    /// The absolute snapshot URL.
    fn url(&self) -> String {
        join_url(&self.config.base_url, self.config.snapshot_path())
    }

    fn headers(&self, extra: &[(&str, &str)]) -> BTreeMap<String, String> {
        let mut headers = BTreeMap::new();
        headers.insert(
            String::from("Authorization"),
            basic_authorization(&self.config.username, &self.config.password),
        );
        for (name, value) in extra {
            headers.insert((*name).to_owned(), (*value).to_owned());
        }
        headers
    }

    /// Looks the snapshot up. `None` means the file does not exist yet.
    async fn stat(&self) -> Result<Option<WebdavStat>, CoreError> {
        let request = HttpBytesRequest {
            method: String::from("PROPFIND"),
            url: self.url(),
            headers: self.headers(&[
                ("Depth", "0"),
                ("Content-Type", "application/xml; charset=utf-8"),
            ]),
            body: PROPFIND_BODY.as_bytes().to_vec(),
        };
        let response = self.http.send_bytes(&request, &CancelToken::new()).await?;

        if response.status == 404 {
            return Ok(None);
        }
        require_ok(&response, "WebDAV lookup")?;
        Ok(Some(parse_propfind(&response.text())?))
    }

    /// Creates each missing collection on the way to the snapshot.
    async fn ensure_parent(&self) -> Result<(), CoreError> {
        let parent = parent_path(self.config.snapshot_path());
        if parent.is_empty() {
            return Ok(());
        }

        let mut current = String::new();
        for segment in parent.split('/') {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(segment);

            let request = HttpBytesRequest {
                method: String::from("MKCOL"),
                url: join_url(&self.config.base_url, &current),
                headers: self.headers(&[]),
                body: Vec::new(),
            };
            let response = self.http.send_bytes(&request, &CancelToken::new()).await?;
            // 405 means the collection already exists.
            if !response.is_success() && response.status != 405 {
                require_ok(&response, "WebDAV folder creation")?;
            }
        }

        Ok(())
    }

    fn remote_for(&self, stat: &WebdavStat) -> RemoteSnapshot {
        let path = self.config.snapshot_path();
        let name = path.rsplit('/').next().unwrap_or(SNAPSHOT_NAME);
        let etag = normalize_etag(stat.etag.as_deref())
            .or_else(|| stat.last_modified.clone())
            .or_else(|| stat.size.map(|size| size.to_string()))
            .unwrap_or_default();

        RemoteSnapshot {
            id: path.to_owned(),
            name: name.to_owned(),
            modified_at: stat.last_modified.clone().unwrap_or_else(epoch_iso8601),
            etag,
            size: stat.size,
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SyncProvider for WebdavSync {
    fn id(&self) -> &'static str {
        "webdav"
    }

    async fn connect(&self) -> Result<SyncAccount, CoreError> {
        // A missing file is a reachable destination; auth and network failures
        // still surface.
        let _ = self.stat().await?;
        Ok(SyncAccount {
            label: host_of(&self.config.base_url),
        })
    }

    async fn probe(&self) -> Result<Option<RemoteSnapshot>, CoreError> {
        Ok(self
            .stat()
            .await?
            .as_ref()
            .map(|stat| self.remote_for(stat)))
    }

    async fn download(&self, _remote: &RemoteSnapshot) -> Result<Vec<u8>, CoreError> {
        let request = HttpBytesRequest {
            method: String::from("GET"),
            url: self.url(),
            headers: self.headers(&[]),
            body: Vec::new(),
        };
        let response = self.http.send_bytes(&request, &CancelToken::new()).await?;
        require_ok(&response, "WebDAV download")?;
        Ok(response.body)
    }

    async fn upload(
        &self,
        bytes: &[u8],
        _remote: Option<&RemoteSnapshot>,
    ) -> Result<RemoteSnapshot, CoreError> {
        self.ensure_parent().await?;

        let request = HttpBytesRequest {
            method: String::from("PUT"),
            url: self.url(),
            headers: self.headers(&[
                ("Content-Type", "application/vnd.sqlite3"),
                ("Content-Length", &bytes.len().to_string()),
            ]),
            body: bytes.to_vec(),
        };
        let response = self.http.send_bytes(&request, &CancelToken::new()).await?;
        require_ok(&response, "WebDAV upload")?;

        let stat = self.stat().await?.ok_or_else(|| {
            CoreError::new(
                "sync.webdav_upload_missing",
                "WebDAV accepted the upload but the backup could not be found.",
            )
        })?;
        Ok(self.remote_for(&stat))
    }
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn parent_path(path: &str) -> String {
    let relative = path.trim_start_matches('/');
    match relative.rsplit_once('/') {
        Some((parent, _)) => parent.to_owned(),
        None => String::new(),
    }
}

fn basic_authorization(username: &str, password: &str) -> String {
    let credentials = format!("{username}:{password}");
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(credentials)
    )
}

fn normalize_etag(etag: Option<&str>) -> Option<String> {
    let etag = etag?;
    let normalized = etag.strip_prefix("W/").unwrap_or(etag).replace('"', "");
    (!normalized.is_empty()).then_some(normalized)
}

fn host_of(url: &str) -> String {
    let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    without_scheme.split('/').next().unwrap_or(url).to_owned()
}

fn epoch_iso8601() -> String {
    String::from("1970-01-01T00:00:00Z")
}

fn parse_propfind(xml: &str) -> Result<WebdavStat, CoreError> {
    if !xml.contains("response") {
        return Err(CoreError::new(
            "sync.webdav_unreadable",
            "The WebDAV server returned an unreadable response.",
        ));
    }

    let size = tag_text(xml, "getcontentlength").and_then(|value| value.parse::<u64>().ok());

    Ok(WebdavStat {
        etag: tag_text(xml, "getetag"),
        last_modified: tag_text(xml, "getlastmodified"),
        size,
    })
}

/// Reads a DAV property's text, with or without a namespace prefix.
fn tag_text(xml: &str, name: &str) -> Option<String> {
    let after_open = xml
        .find(&format!(":{name}>"))
        .map(|index| index + name.len() + 2)
        .or_else(|| {
            xml.find(&format!("<{name}>"))
                .map(|index| index + name.len() + 2)
        })?;
    let rest = &xml[after_open..];
    let close = rest.find('<')?;
    let value = unescape(&rest[..close]);
    (!value.trim().is_empty()).then(|| value.trim().to_owned())
}

fn unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
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
    let code = match response.status {
        401 | 403 => "sync.unauthorized",
        _ => "sync.request_failed",
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

    fn response(status: u16, body: &[u8]) -> HttpBytesResponse {
        HttpBytesResponse {
            status,
            headers: BTreeMap::new(),
            body: body.to_vec(),
        }
    }

    fn config() -> WebdavConfig {
        WebdavConfig {
            base_url: String::from("https://cloud.example.com/dav/me/"),
            path: String::from("/onspot/onspot.sqlite"),
            username: String::from("learner"),
            password: String::from("secret"),
        }
    }

    fn propfind(etag: &str, size: u64) -> HttpBytesResponse {
        response(
            207,
            format!(
                "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\"><d:response>\
                 <d:href>/onspot/onspot.sqlite</d:href><d:propstat><d:prop>\
                 <d:getetag>&quot;{etag}&quot;</d:getetag>\
                 <d:getlastmodified>Thu, 13 Nov 2026 10:00:00 GMT</d:getlastmodified>\
                 <d:getcontentlength>{size}</d:getcontentlength>\
                 </d:prop></d:propstat></d:response></d:multistatus>"
            )
            .as_bytes(),
        )
    }

    #[test]
    fn a_missing_snapshot_is_not_an_error() {
        let http = FakeHttp::with(vec![response(404, b"")]);
        let provider = WebdavSync::new(config(), http.clone()).expect("provider");
        let remote = futures::executor::block_on(provider.probe()).expect("probe");
        assert!(remote.is_none());

        let requests = http.requests.lock().expect("requests");
        assert_eq!(requests[0].method, "PROPFIND");
        assert_eq!(
            requests[0].url,
            "https://cloud.example.com/dav/me/onspot/onspot.sqlite"
        );
        assert!(requests[0].headers["Authorization"].starts_with("Basic "));
    }

    #[test]
    fn the_propfind_stat_becomes_a_remote_snapshot() {
        let http = FakeHttp::with(vec![propfind("abc", 4096)]);
        let provider = WebdavSync::new(config(), http).expect("provider");
        let remote = futures::executor::block_on(provider.probe())
            .expect("probe")
            .expect("remote");

        assert_eq!(remote.id, "/onspot/onspot.sqlite");
        assert_eq!(remote.name, "onspot.sqlite");
        assert_eq!(remote.etag, "abc");
        assert_eq!(remote.size, Some(4096));
        assert_eq!(remote.modified_at, "Thu, 13 Nov 2026 10:00:00 GMT");
    }

    #[test]
    fn a_weak_etag_is_normalised() {
        let http = FakeHttp::with(vec![response(
            207,
            b"<d:response><d:prop><d:getetag>W/&quot;strong&quot;</d:getetag></d:prop></d:response>",
        )]);
        let provider = WebdavSync::new(config(), http).expect("provider");
        let remote = futures::executor::block_on(provider.probe())
            .expect("probe")
            .expect("remote");
        assert_eq!(remote.etag, "strong");
    }

    #[test]
    fn an_upload_creates_the_parent_then_puts_the_image() {
        let http = FakeHttp::with(vec![
            response(201, b""),
            response(405, b""),
            response(201, b""),
            propfind("after", 12),
        ]);
        let provider = WebdavSync::new(
            WebdavConfig {
                path: String::from("/onspot/backup/onspot.sqlite"),
                ..config()
            },
            http.clone(),
        )
        .expect("provider");
        let remote =
            futures::executor::block_on(provider.upload(b"SQLite format", None)).expect("upload");

        assert_eq!(remote.etag, "after");
        assert_eq!(remote.size, Some(12));

        let requests = http.requests.lock().expect("requests");
        assert_eq!(requests[0].method, "MKCOL");
        assert_eq!(requests[0].url, "https://cloud.example.com/dav/me/onspot");
        assert_eq!(requests[1].method, "MKCOL");
        assert_eq!(
            requests[1].url,
            "https://cloud.example.com/dav/me/onspot/backup"
        );
        assert_eq!(requests[2].method, "PUT");
        assert_eq!(requests[2].body, b"SQLite format");
        assert_eq!(
            requests[2].headers["Content-Type"],
            "application/vnd.sqlite3"
        );
        assert_eq!(requests[3].method, "PROPFIND");
    }

    #[test]
    fn a_download_returns_the_snapshot_bytes() {
        let http = FakeHttp::with(vec![response(200, b"SQLite format 3\0")]);
        let provider = WebdavSync::new(config(), http).expect("provider");
        let remote = RemoteSnapshot {
            id: String::from("/onspot/onspot.sqlite"),
            name: String::from("onspot.sqlite"),
            modified_at: String::from("2026-11-13T10:00:00Z"),
            etag: String::from("e1"),
            size: Some(16),
        };
        let bytes = futures::executor::block_on(provider.download(&remote)).expect("download");
        assert_eq!(bytes, b"SQLite format 3\0");
    }

    #[test]
    fn a_rejected_login_reports_the_reconnect_code() {
        let http = FakeHttp::with(vec![response(401, b"Invalid credentials")]);
        let provider = WebdavSync::new(config(), http).expect("provider");
        let error = futures::executor::block_on(provider.probe()).expect_err("unauthorized");
        assert_eq!(error.code, "sync.unauthorized");
        assert!(error.message.contains("HTTP 401"));
    }

    #[test]
    fn missing_settings_are_refused_before_any_request() {
        let http = FakeHttp::default();
        let error = WebdavSync::new(
            WebdavConfig {
                base_url: String::new(),
                ..config()
            },
            Arc::new(http),
        )
        .expect_err("url");
        assert_eq!(error.code, "sync.webdav_url_missing");
    }

    #[test]
    fn the_account_label_is_the_server_host() {
        let http = FakeHttp::with(vec![response(404, b"")]);
        let provider = WebdavSync::new(config(), http).expect("provider");
        let account = futures::executor::block_on(provider.connect()).expect("connect");
        assert_eq!(account.label, "cloud.example.com");
    }
}
