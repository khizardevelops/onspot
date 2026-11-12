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

fn core() -> (Core, Arc<HostReplies>) {
    let driver = Arc::new(RusqliteDriver::open_in_memory().expect("database"));
    futures::executor::block_on(migrate(driver.as_ref())).expect("migrate");
    let hosts = HostAdapters {
        history: Some(Arc::new(SqlHistoryStore::new(driver.clone()))),
        settings: None,
        records: Some(Arc::new(SqlRecordsStore::new(driver))),
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
fn a_prompt_choice_falls_back_when_the_driver_returns_no_generated_prompt() {
    let (core, replies) = core();
    let _ = futures::executor::block_on(dispatch(&core, PRACTICE_CONFIGURE, config()))
        .expect("configure");

    let caller = dispatch(
        &core,
        PRACTICE_NEXT_PROMPT,
        json!({
            "candidates": [
                { "id": "p-1", "title": "Le marché", "text": "Racontez votre matinée.", "englishFallback": false }
            ],
            "englishFallback": false
        }),
    );
    let replier = async {
        loop {
            let request = {
                let events = replies.0.lock().expect("host replies");
                events.iter().find_map(|event| match event {
                    UiEvent::HostRequest { id, method, .. } if method == "prompt.write" => {
                        Some(*id)
                    }
                    _ => None,
                })
            };
            if let Some(id) = request {
                assert!(core.host_rpc().reply(id, Ok(Value::Null)));
                break;
            }
            futures::pending!();
        }
    };
    let (result, ()) = futures::executor::block_on(async { futures::join!(caller, replier) });
    let result = result.expect("next prompt");
    assert_eq!(result["snapshot"]["prompt"]["id"], "p-1");
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
