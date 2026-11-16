// SPDX-License-Identifier: AGPL-3.0-or-later

use onspot_app::{compute_insights, InsightsData};

use crate::db::Context;
use crate::error::CliError;

pub async fn build(ctx: &Context) -> Result<InsightsData, CliError> {
    let (sessions, attempts, corrections) = crate::sessions::all(ctx).await?;
    Ok(compute_insights(&sessions, &attempts, &corrections))
}
