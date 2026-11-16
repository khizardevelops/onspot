// SPDX-License-Identifier: AGPL-3.0-or-later

//! The CLI's host implementations: a blocking HTTP client with the BYOK key
//! added driver-side, and a wall clock.

use std::collections::BTreeMap;
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use onspot_ports::{
    CancelToken, Clock, CoreError, HttpBytesRequest, HttpBytesResponse, HttpClient, HttpRequest,
    HttpResponse,
};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};

use crate::secrets::CliSecrets;

type RawResponse = (u16, BTreeMap<String, String>, Vec<u8>);

pub struct NativeHttp {
    client: Client,
    secrets: Arc<CliSecrets>,
}

impl NativeHttp {
    pub fn new(secrets: Arc<CliSecrets>) -> Result<Self, CoreError> {
        let client = Client::builder()
            .user_agent(concat!("onspot-cli/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| CoreError::new("cli.http", error.to_string()))?;
        Ok(Self { client, secrets })
    }

    /// Sends on a worker thread so Ctrl-C can cancel while the socket is open.
    fn send_blocking(
        &self,
        method: String,
        url: String,
        headers: BTreeMap<String, String>,
        body: Vec<u8>,
        provider: Option<String>,
        token: &CancelToken,
    ) -> Result<RawResponse, CoreError> {
        if token.is_cancelled() {
            return Err(token.error());
        }

        let client = self.client.clone();
        let secrets = self.secrets.clone();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let result = (|| {
                let method = reqwest::Method::from_bytes(method.as_bytes())
                    .map_err(|error| CoreError::new("cli.http_method", error.to_string()))?;
                let mut request = client.request(method, url);

                let mut names: Vec<HeaderName> = Vec::new();
                for (name, value) in &headers {
                    let name = HeaderName::from_bytes(name.as_bytes())
                        .map_err(|error| CoreError::new("cli.http_header", error.to_string()))?;
                    let value = HeaderValue::from_str(value)
                        .map_err(|error| CoreError::new("cli.http_header", error.to_string()))?;
                    names.push(name.clone());
                    request = request.header(name, value);
                }

                if !names.contains(&AUTHORIZATION) {
                    if let Some(provider) = &provider {
                        if let Some(key) = secrets.key(provider) {
                            request = request.bearer_auth(key);
                        }
                    }
                }

                let response = request
                    .body(body)
                    .send()
                    .map_err(|error| CoreError::new("cli.http", error.to_string()))?;
                let status = response.status().as_u16();
                let headers = response_headers(response.headers());
                let body = response
                    .bytes()
                    .map_err(|error| CoreError::new("cli.http", error.to_string()))?
                    .to_vec();
                Ok((status, headers, body))
            })();
            let _ = sender.send(result);
        });

        loop {
            if token.is_cancelled() {
                return Err(token.error());
            }
            match receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(CoreError::new("cli.http", "the HTTP worker stopped"))
                }
            }
        }
    }
}

#[async_trait]
impl HttpClient for NativeHttp {
    async fn send(
        &self,
        request: &HttpRequest,
        token: &CancelToken,
    ) -> Result<HttpResponse, CoreError> {
        if token.is_cancelled() {
            return Err(token.error());
        }
        let (status, headers, bytes) = self.send_blocking(
            request.method.clone(),
            request.url.clone(),
            request.headers.clone(),
            request.body.clone().into_bytes(),
            request.provider.clone(),
            token,
        )?;
        Ok(HttpResponse {
            status,
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }

    async fn send_bytes(
        &self,
        request: &HttpBytesRequest,
        token: &CancelToken,
    ) -> Result<HttpBytesResponse, CoreError> {
        if token.is_cancelled() {
            return Err(token.error());
        }
        let (status, headers, body) = self.send_blocking(
            request.method.clone(),
            request.url.clone(),
            request.headers.clone(),
            request.body.clone(),
            None,
            token,
        )?;
        Ok(HttpBytesResponse {
            status,
            headers,
            body,
        })
    }
}

fn response_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_owned(), value.to_owned()))
        })
        .collect()
}

pub struct SystemClock;

#[async_trait]
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }

    async fn sleep(&self, milliseconds: u64, token: &CancelToken) -> bool {
        let step = Duration::from_millis(25);
        let mut left = Duration::from_millis(milliseconds);
        while left > Duration::ZERO {
            if token.is_cancelled() {
                return false;
            }
            let slice = left.min(step);
            std::thread::sleep(slice);
            left -= slice;
        }
        !token.is_cancelled()
    }
}
