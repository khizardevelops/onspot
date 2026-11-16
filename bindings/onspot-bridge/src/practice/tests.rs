// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::{Arc, Mutex};

use onspot_adapter_repo_sql::{migrate, RusqliteDriver, SqlHistoryStore, SqlRecordsStore};
use onspot_app::{CoreConfig, EventSink, HostAdapters, UiEvent};
use serde_json::{json, Value};

use crate::commands::dispatch;
use crate::practice::{PRACTICE_CONFIGURE, PRACTICE_NEXT_PROMPT, PRACTICE_SNAPSHOT};
use crate::Core;

struct HostReplies(Mutex<Vec<UiEvent>>);

impl EventSink for HostReplies {
    fn emit(&self, event: &UiEvent) {
        self.0.lock().expect("host replies").push(event.clone());
    }
}

/// The device's own values (usage ledger, sync revision), in memory.
#[derive(Default)]
struct MemoryDevice(Mutex<std::collections::BTreeMap<String, String>>);

#[async_trait::async_trait]
impl onspot_ports::DeviceStore for MemoryDevice {
    async fn read(&self, key: &str) -> Result<Option<String>, onspot_ports::CoreError> {
        Ok(self.0.lock().expect("device").get(key).cloned())
    }

    async fn write(&self, key: &str, value: &str) -> Result<(), onspot_ports::CoreError> {
        self.0
            .lock()
            .expect("device")
            .insert(key.to_owned(), value.to_owned());
        Ok(())
    }
}

fn core() -> (Core, Arc<HostReplies>) {
    let driver = Arc::new(RusqliteDriver::open_in_memory().expect("database"));
    futures::executor::block_on(migrate(driver.as_ref())).expect("migrate");
    let hosts = HostAdapters {
        history: Some(Arc::new(SqlHistoryStore::new(driver.clone()))),
        settings: None,
        records: Some(Arc::new(SqlRecordsStore::new(driver))),
        device: Some(Arc::new(MemoryDevice::default())),
        ..HostAdapters::default()
    };
    let core = Core::with_hosts(
        CoreConfig {
            app_version: String::from("test"),
        },
        hosts,
    );
    let replies = Arc::new(HostReplies(Mutex::new(Vec::new())));
    core.add_sink(replies.clone() as Arc<dyn EventSink>);
    (core, replies)
}

fn config() -> Value {
    json!({
        "config": {
            "targetLanguageId": "fr",
            "targetLanguageName": "French",
            "instructionLanguageId": "en",
            "instructionLanguageName": "English",
            "level": "b1",
            "mode": "exam",
            "ttsMode": "local",
            "sttMode": "local",
            "ttsVoice": "fr_FR-siwis",
            "explanationVoice": "en_US-amy",
            "llmEndpoint": {
                "baseUrl": "http://127.0.0.1:4330/v1",
                "provider": "custom",
                "model": "stub",
                "fallbackModels": []
            },
            "llmConfigured": true,
            "pace": 1.0,
            "explanationAudioAvailable": true,
            "maxSeconds": 60
        }
    })
}

#[test]
fn configure_creates_the_session_and_snapshot_returns_it() {
    let (core, _) = core();
    let configured = futures::executor::block_on(dispatch(&core, PRACTICE_CONFIGURE, config()))
        .expect("configure");
    assert_eq!(configured["snapshot"]["phase"], "idle");
    assert_eq!(configured["snapshot"]["mode"], "exam");

    let snapshot = futures::executor::block_on(dispatch(&core, PRACTICE_SNAPSHOT, Value::Null))
        .expect("snapshot");
    assert_eq!(snapshot["snapshot"]["phase"], "idle");
}

#[test]
fn a_prompt_choice_falls_back_when_the_model_cannot_write_one() {
    let (core, replies) = core();
    let _ = futures::executor::block_on(dispatch(&core, PRACTICE_CONFIGURE, config()))
        .expect("configure");

    let caller = dispatch(&core, PRACTICE_NEXT_PROMPT, json!({}));
    // The host has no stored usage ledger, and the provider refuses the
    // request outright (a 400 is not retried; a 5xx or 429 would be).
    let replier = async {
        let mut answered = std::collections::HashSet::new();
        loop {
            let pending: Vec<(u32, String)> = {
                let events = replies.0.lock().expect("host replies");
                events
                    .iter()
                    .filter_map(|event| match event {
                        UiEvent::HostRequest { id, method, .. } if !answered.contains(id) => {
                            Some((*id, method.clone()))
                        }
                        _ => None,
                    })
                    .collect()
            };
            let mut refused = false;
            for (id, method) in pending {
                answered.insert(id);
                let reply = match method.as_str() {
                    "device.read" => json!({ "value": null }),
                    "http.request" => {
                        refused = true;
                        json!({ "status": 400, "headers": {}, "body": "no" })
                    }
                    _ => json!({}),
                };
                assert!(core.host_rpc().reply(id, Ok(reply)));
            }
            if refused {
                break;
            }
            futures::pending!();
        }
    };
    let (result, ()) = futures::executor::block_on(async { futures::join!(caller, replier) });
    let result = result.expect("next prompt");
    // The model refused, so a seeded catalogue prompt for French taught in
    // English stands in.
    let prompt_id = result["snapshot"]["prompt"]["id"]
        .as_str()
        .expect("prompt id");
    assert!(prompt_id.starts_with("en-"), "{prompt_id}");
}

#[test]
fn an_unknown_host_reply_is_reported_not_panicking() {
    let (core, _) = core();
    let response = futures::executor::block_on(dispatch(
        &core,
        "core.host_reply",
        json!({ "id": 999, "result": null }),
    ))
    .expect("reply command");
    assert_eq!(response["accepted"], false);
}

#[test]
fn a_legacy_json_backup_is_merged_through_the_core() {
    let (core, _) = core();
    let restored = futures::executor::block_on(dispatch(
        &core,
        crate::portability::RESTORE_LEGACY_JSON,
        json!({
            "json": r#"{
                "app": "onspot",
                "format": 1,
                "sessions": [{ "id": "s-legacy", "title": "Old", "mode": "casual",
                    "startedAt": "2026-01-01T00:00:00.000Z" }],
                "attempts": [{ "id": "a-legacy", "sessionId": "s-legacy",
                    "transcript": "Bonjour", "durationSec": 2.0, "wordCount": 1 }]
            }"#,
            "now": "2026-11-15T00:00:00.000Z"
        }),
    ))
    .expect("legacy restore");
    assert_eq!(restored["sessions"], 1);
    assert_eq!(restored["attempts"], 1);
    assert_eq!(restored["corrections"], 0);
    assert_eq!(restored["recordings"], 0);
    assert_eq!(restored["settings"], 0);

    let history = core.hosts().history.clone().expect("history");
    let records = core.hosts().records.clone().expect("records");
    assert_eq!(
        futures::executor::block_on(history.list_sessions())
            .expect("sessions")
            .len(),
        1
    );
    assert_eq!(
        futures::executor::block_on(records.list_attempts("s-legacy"))
            .expect("attempts")
            .len(),
        1
    );
}

#[test]
fn submission_flush_is_a_no_op_while_offline_or_unconfigured() {
    let (core, _) = core();
    let offline = futures::executor::block_on(dispatch(
        &core,
        crate::practice::PROMPTS_FLUSH_SUBMISSIONS,
        json!({ "endpoint": "https://example.test/prompts", "online": false }),
    ))
    .expect("offline flush");
    assert_eq!(offline["sent"], 0);
    assert_eq!(offline["pending"], 0);

    let unconfigured = futures::executor::block_on(dispatch(
        &core,
        crate::practice::PROMPTS_FLUSH_SUBMISSIONS,
        json!({ "endpoint": "", "online": true }),
    ))
    .expect("unconfigured flush");
    assert_eq!(unconfigured["sent"], 0);
}

#[test]
fn an_unrecorded_session_setup_is_inferred_in_the_core() {
    let (core, _) = core();
    let settings = json!({
        "targetLanguage": "ja",
        "instructionLanguage": "fa",
        "ttsMode": "local",
        "ttsVoice": "not-a-voice",
        "explanationVoice": "not-a-voice",
        "targetSpeechPace": 0.9
    });
    let inferred = futures::executor::block_on(dispatch(
        &core,
        crate::practice::SESSIONS_INFER_SETUP,
        json!({
            "attempts": [{ "transcript": "Bonjour je vais au marché" }],
            "settings": settings.clone()
        }),
    ))
    .expect("infer setup");
    assert_eq!(inferred["targetLanguage"], "fr");
    assert_ne!(inferred["ttsVoice"], "not-a-voice");

    let stored = futures::executor::block_on(dispatch(
        &core,
        crate::practice::SESSIONS_PARSE_SETUP,
        json!({ "setup": settings }),
    ))
    .expect("parse setup");
    assert_eq!(stored["setup"]["targetLanguage"], "ja");
}
