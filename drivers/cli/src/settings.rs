// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::BTreeMap;

use onspot_app::{AppSettings, SettingsService};
use serde_json::Value;

use crate::db::Context;
use crate::error::CliError;

pub async fn load(ctx: &Context) -> Result<AppSettings, CliError> {
    let service = SettingsService::new(ctx.settings.as_ref());
    let (loaded, _rows) = service.load_document().await?;
    Ok(loaded.settings)
}

pub async fn get(ctx: &Context, field: Option<&str>) -> Result<Value, CliError> {
    let document = serde_json::to_value(load(ctx).await?)?;
    let Some(field) = field else {
        return Ok(document);
    };
    document
        .get(field)
        .cloned()
        .ok_or_else(|| CliError::message(format!("unknown settings field: {field}")))
}

pub async fn set(ctx: &Context, field: &str, raw: &str) -> Result<Value, CliError> {
    let known = serde_json::to_value(AppSettings::default())?;
    if !known
        .as_object()
        .is_some_and(|document| document.contains_key(field))
    {
        return Err(CliError::message(format!(
            "unknown settings field: {field}; run `settings get` to see the document"
        )));
    }

    // Accept JSON when it parses, otherwise treat the argument as a string so
    // `settings set level C1` works without quoting the JSON.
    let value =
        serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_owned()));
    let mut patch = BTreeMap::new();
    patch.insert(field.to_owned(), serde_json::to_string(&value)?);

    let service = SettingsService::new(ctx.settings.as_ref());
    let result = service.patch_document(&patch).await?;
    Ok(serde_json::to_value(result.settings)?)
}
