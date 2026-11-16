// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::{BTreeMap, HashMap};

use onspot_app::HistoryService;
use onspot_domain::{Attempt, Correction, Session};
use onspot_ports::{HistoryStore, RecordsStore};
use serde::Serialize;

use crate::db::Context;
use crate::error::CliError;

#[derive(Debug, Serialize)]
pub struct SessionDetail {
    pub session: Session,
    pub attempts: Vec<Attempt>,
    pub corrections: BTreeMap<String, Vec<Correction>>,
}

pub async fn list(ctx: &Context) -> Result<Vec<onspot_app::HistorySession>, CliError> {
    Ok(HistoryService::new(ctx.history.as_ref()).list().await?)
}

pub async fn show(ctx: &Context, id: &str) -> Result<SessionDetail, CliError> {
    let session = ctx
        .records
        .get_session(id)
        .await?
        .ok_or_else(|| CliError::message(format!("no session with id {id}")))?;
    let attempts = ctx.records.list_attempts(id).await?;
    let mut corrections = BTreeMap::new();
    for attempt in &attempts {
        corrections.insert(
            attempt.id.clone(),
            ctx.records.list_corrections(&attempt.id).await?,
        );
    }
    Ok(SessionDetail {
        session,
        attempts,
        corrections,
    })
}

/// The full attempt rows and corrections, for insights and exports.
pub async fn all(ctx: &Context) -> Result<(Vec<Session>, Vec<Attempt>, Vec<Correction>), CliError> {
    let sessions = ctx.history.list_sessions().await?;
    let attempts = ctx.records.list_all_attempts().await?;
    let corrections = ctx.records.list_all_corrections().await?;
    Ok((sessions, attempts, corrections))
}

pub async fn corrections_by_attempt(
    ctx: &Context,
    attempts: &[Attempt],
) -> Result<HashMap<String, Vec<Correction>>, CliError> {
    let mut by_attempt = HashMap::new();
    for attempt in attempts {
        by_attempt.insert(
            attempt.id.clone(),
            ctx.records.list_corrections(&attempt.id).await?,
        );
    }
    Ok(by_attempt)
}
