// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cooperative cancellation shared by every port call.
//!
//! The core bumps a token when the learner starts a new take, changes session
//! or cancels. Adapters check it before expensive work and between chunks; a
//! cancelled call returns `CoreError` with code `core.cancelled`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Why a cancelled call stopped.
pub const CANCELLED_CODE: &str = "core.cancelled";

/// A cheap, cloneable cancellation flag.
#[derive(Debug, Clone, Default)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
}

impl CancelToken {
    /// A token that is not cancelled.
    pub fn new() -> Self {
        Self::default()
    }

    /// Marks the token cancelled. Idempotent and callable from another thread.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Whether two handles share the same cancellation flag.
    pub fn same(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }

    /// An error for a call that observed cancellation.
    pub fn error(&self) -> crate::CoreError {
        crate::CoreError::new(CANCELLED_CODE, "the operation was cancelled")
    }
}
