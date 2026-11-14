// SPDX-License-Identifier: AGPL-3.0-or-later

//! wasm-bindgen exports for the web driver.
//!
//! Events leave the core through the JavaScript callback a driver passes to
//! `init_core_wasm`; commands are plain functions returning the same JSON
//! shapes the Tauri transport returns. The module keeps one core per page.
//!
//! P2 adds the browser's SQL host: the driver passes an object whose methods
//! delegate to the existing `sqlite.worker.ts`/`OpfsSqliteAdapter` machinery,
//! and this module implements `SqlDriver` over those promises. SQL text and
//! parameters originate in Rust; the engine stays the vendor's wasm.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use js_sys::{Function, Promise, Reflect};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use onspot_app::{Core, CoreConfig, EventSink, HostAdapters, UiEvent};
use onspot_ports::{SqlDriver, SqlError, SqlRow, SqlStatement, SqlValue};

use crate::commands::{dispatch, initialize};
use crate::error::BridgeError;

thread_local! {
    static CORE: RefCell<Option<Arc<Core>>> = RefCell::new(None);
}

/// Delivers a core event by calling the driver's JavaScript callback.
struct CallbackSink(Function);

impl EventSink for CallbackSink {
    fn emit(&self, event: &UiEvent) {
        if let Ok(value) = to_js(event) {
            let _ = self.0.call1(&JsValue::NULL, &value);
        }
    }
}

/// A `SqlDriver` whose calls are the driver's JavaScript methods.
///
/// The object is `{ execute, select, batch, close }`; each takes JSON-friendly
/// arguments and returns a promise. The page owns the connection so a command
/// cannot close the database out from under the legacy adapter.
struct WasmSqlDriver {
    execute: Function,
    select: Function,
    batch: Function,
}

impl WasmSqlDriver {
    fn from_host(host: &JsValue) -> Result<Self, JsValue> {
        let member = |name: &str| -> Result<Function, JsValue> {
            Reflect::get(host, &JsValue::from_str(name))?
                .dyn_into::<Function>()
                .map_err(|_| JsValue::from_str(&format!("SQL host is missing `{name}`")))
        };
        Ok(Self {
            execute: member("execute")?,
            select: member("select")?,
            batch: member("batch")?,
        })
    }

    async fn call(&self, function: &Function, args: &[JsValue]) -> Result<JsValue, SqlError> {
        let promise = function
            .apply(
                &JsValue::NULL,
                &js_sys::Array::from_iter(args.iter().cloned()),
            )
            .map_err(js_error)?
            .dyn_into::<Promise>()
            .map_err(|_| SqlError::new("the SQL host did not return a promise"))?;
        JsFuture::from(promise).await.map_err(js_error)
    }
}

fn js_error(error: JsValue) -> SqlError {
    let message = error
        .as_string()
        .or_else(|| {
            Reflect::get(&error, &JsValue::from_str("message"))
                .ok()
                .and_then(|value| value.as_string())
        })
        .unwrap_or_else(|| String::from("the SQL host failed"));
    SqlError::new(message)
}

#[async_trait(?Send)]
impl SqlDriver for WasmSqlDriver {
    fn supports_batch(&self) -> bool {
        true
    }

    async fn execute(&self, sql: &str, params: &[SqlValue]) -> Result<(), SqlError> {
        let params = serde_wasm_bindgen::to_value(params).map_err(serialization_error)?;
        self.call(&self.execute, &[sql.into(), params]).await?;
        Ok(())
    }

    async fn select(&self, sql: &str, params: &[SqlValue]) -> Result<Vec<SqlRow>, SqlError> {
        let params = serde_wasm_bindgen::to_value(params).map_err(serialization_error)?;
        let rows = self.call(&self.select, &[sql.into(), params]).await?;
        serde_wasm_bindgen::from_value::<Vec<BTreeMap<String, SqlValue>>>(rows)
            .map_err(serialization_error)
    }

    async fn batch(&self, statements: &[SqlStatement]) -> Result<(), SqlError> {
        let statements = serde_wasm_bindgen::to_value(statements).map_err(serialization_error)?;
        self.call(&self.batch, &[statements]).await?;
        Ok(())
    }

    async fn close(&self) -> Result<(), SqlError> {
        // The driver owns the worker for the page's lifetime; closing it here
        // would break the legacy adapter that shares the same database.
        Ok(())
    }
}

fn serialization_error(error: impl std::fmt::Display) -> SqlError {
    SqlError::new(format!("the SQL host value is not JSON: {error}"))
}

/// Boots the web core: stores the configuration, registers the event callback
/// and, when a SQL host is supplied, opens the storage adapter and migrates it
/// before the handshake returns.
///
/// @param config `{ appVersion }`; omitted or null uses the default.
/// @param event_callback Called with each event object, e.g. `{ event: "pong" }`.
/// @param sql_host Optional `{ execute, select, batch, close }` over the page's
///   SQLite worker. Without it, storage commands answer `bridge.unavailable`.
#[wasm_bindgen]
pub async fn init_core_wasm(
    config: JsValue,
    event_callback: Function,
    sql_host: JsValue,
) -> Result<JsValue, JsValue> {
    let config: CoreConfig = if config.is_undefined() || config.is_null() {
        CoreConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config)
            .map_err(|error| to_js_error(&BridgeError::invalid_payload("core.init", error)))?
    };

    let hosts = if sql_host.is_undefined() || sql_host.is_null() {
        HostAdapters::default()
    } else {
        let driver = WasmSqlDriver::from_host(&sql_host)?;
        let driver: Arc<dyn SqlDriver> = Arc::new(driver);
        onspot_adapter_repo_sql::migrate(driver.as_ref())
            .await
            .map_err(|error| {
                to_js_error(&BridgeError::new(
                    "storage.migration_failed",
                    format!("the database could not be migrated: {error}"),
                ))
            })?;
        HostAdapters {
            history: Some(Arc::new(onspot_adapter_repo_sql::SqlHistoryStore::new(
                driver.clone(),
            ))),
            settings: Some(Arc::new(onspot_adapter_repo_sql::SqlSettingsStore::new(
                driver.clone(),
            ))),
            records: Some(Arc::new(onspot_adapter_repo_sql::SqlRecordsStore::new(
                driver,
            ))),
            ..HostAdapters::default()
        }
    };

    let core = Arc::new(Core::with_hosts(config, hosts));
    let response = initialize(&core, Arc::new(CallbackSink(event_callback)));

    CORE.with(|slot| *slot.borrow_mut() = Some(core));

    to_js(&response).map_err(serialization_error_js)
}

/// Runs one command against the page's core.
///
/// Rejects with the `BridgeError` object on failure, so a driver sees the same
/// `{ code, message }` shape as the Tauri transport.
#[wasm_bindgen]
pub async fn dispatch_wasm(command: &str, payload: JsValue) -> Result<JsValue, JsValue> {
    let payload: serde_json::Value = if payload.is_undefined() || payload.is_null() {
        serde_json::Value::Null
    } else {
        serde_wasm_bindgen::from_value(payload).map_err(|error| {
            to_js_error(&BridgeError::invalid_payload(
                command,
                format!("payload is not JSON: {error}"),
            ))
        })?
    };

    // Clone the `Arc` out of the thread-local before awaiting: a core cannot be
    // borrowed across an await, and the clone keeps it alive for the command.
    let core = CORE.with(|slot| slot.borrow().clone()).ok_or_else(|| {
        to_js_error(&BridgeError::new(
            "bridge.not_initialized",
            "init_core_wasm must be called before any command",
        ))
    })?;

    let response = dispatch(&core, command, payload)
        .await
        .map_err(|error| to_js_error(&error))?;

    to_js(&response).map_err(serialization_error_js)
}

fn serialization_error_js(error: serde_wasm_bindgen::Error) -> JsValue {
    to_js_error(&BridgeError::new(
        "bridge.serialize_failed",
        format!("the core could not serialize a value: {error}"),
    ))
}

/// Serializes with JSON-compatible JavaScript: plain objects, not `Map`s, and
/// numbers, not `BigInt`. Both transports must hand a driver the same shapes.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
}

fn to_js_error(error: &BridgeError) -> JsValue {
    to_js(error)
        .unwrap_or_else(|_| JsValue::from_str(&format!("{}: {}", error.code, error.message)))
}
