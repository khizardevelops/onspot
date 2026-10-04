use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("download failed: {0}")]
    Download(#[from] reqwest::Error),
    #[error("download cancelled")]
    Cancelled,
    #[error("the downloaded model is corrupt (checksum mismatch); please try again")]
    Checksum,
    #[error("speech engine: {0}")]
    Whisper(#[from] whisper_rs::WhisperError),
    #[error("{0}")]
    Invalid(String),
}

/// Commands return errors to the webview as plain messages.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
