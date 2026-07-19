use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

const DEFAULT_USER_AGENT: &str = "etzhayyim-crawler-fetch-rs/0.1.0";
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub user_agent: Option<String>,
    pub timeout_ms: Option<u64>,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FetchResponse {
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum FetchProviderError {
    #[error("invalid request header: {0}")]
    InvalidHeader(String),
    #[error("request build failed: {0}")]
    Build(String),
    #[error("transport failed: {0}")]
    Transport(String),
    #[error("body read failed: {0}")]
    Body(String),
}

pub struct FetchProvider {
    client: Client,
}

impl Default for FetchProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl FetchProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("default reqwest client");
        Self { client }
    }

    pub fn fetch(&self, req: FetchRequest) -> Result<FetchResponse, FetchProviderError> {
        let method = req.method.clone().unwrap_or_else(|| "GET".to_string());
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_str(req.user_agent.as_deref().unwrap_or(DEFAULT_USER_AGENT))
                .map_err(|err| FetchProviderError::InvalidHeader(err.to_string()))?,
        );
        for (name, value) in &req.headers {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|err| FetchProviderError::InvalidHeader(err.to_string()))?,
                HeaderValue::from_str(value)
                    .map_err(|err| FetchProviderError::InvalidHeader(err.to_string()))?,
            );
        }

        let client = if let Some(timeout_ms) = req.timeout_ms {
            Client::builder()
                .timeout(Duration::from_millis(timeout_ms))
                .redirect(reqwest::redirect::Policy::limited(10))
                .default_headers(headers.clone())
                .build()
                .map_err(|err| FetchProviderError::Build(err.to_string()))?
        } else {
            self.client.clone()
        };

        let response = client
            .request(
                reqwest::Method::from_bytes(method.as_bytes())
                    .map_err(|err| FetchProviderError::Build(err.to_string()))?,
                &req.url,
            )
            .headers(headers)
            .send()
            .map_err(|err| FetchProviderError::Transport(err.to_string()))?;

        let final_url = response.url().to_string();
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let body = response
            .bytes()
            .map_err(|err| FetchProviderError::Body(err.to_string()))?
            .to_vec();

        Ok(FetchResponse {
            url: req.url,
            final_url,
            status,
            content_type,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_header_name() {
        let provider = FetchProvider::new();
        let err = provider
            .fetch(FetchRequest {
                url: "https://example.com".into(),
                method: None,
                user_agent: None,
                timeout_ms: Some(1_000),
                headers: vec![("bad header".into(), "x".into())],
            })
            .expect_err("invalid header");

        assert!(matches!(err, FetchProviderError::InvalidHeader(_)));
    }
}
