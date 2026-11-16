// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use onspot_app::{build_session_markdown, export_timestamp, session_file_stem};
use onspot_ports::DatabaseFile;

use crate::db::Context;
use crate::error::CliError;

pub async fn session_markdown(ctx: &Context, id: &str) -> Result<(String, String), CliError> {
    let detail = crate::sessions::show(ctx, id).await?;
    let corrections = detail
        .corrections
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();
    let document = build_session_markdown(
        &detail.session,
        &detail.attempts,
        &corrections,
        &export_timestamp(),
    );
    Ok((session_file_stem(&detail.session.title), document))
}

pub async fn database(ctx: &Context, out: &Path) -> Result<(), CliError> {
    let bytes = ctx.driver.export_bytes().await?;
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(out, bytes)?;
    Ok(())
}
