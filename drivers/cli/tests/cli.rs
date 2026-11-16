// SPDX-License-Identifier: AGPL-3.0-or-later

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures::executor::block_on;
use onspot_app::{providers, AppSettings};
use onspot_cli::evaluation::{build_request, EvaluateOptions};
use onspot_cli::Context;
use onspot_domain::{Attempt, Session};
use onspot_ports::RecordsStore;

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("onspot-cli-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn run(db: &Path, keys: &Path, args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_onspot-cli"));
    command
        .arg("--db")
        .arg(db)
        .arg("--keys-file")
        .arg(keys)
        .args(args);
    for (name, value) in env {
        command.env(name, value);
    }
    command.output().expect("run onspot-cli")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "status {:?}\nstdout: {}\nstderr: {}",
        output.status,
        stdout(output),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_typed_settings_document_round_trips_through_the_core() {
    let dir = temp_dir("settings");
    let db = dir.join("onspot.db");
    let keys = dir.join("keys.json");

    let get = run(&db, &keys, &["settings", "get"], &[]);
    assert_success(&get);
    let document: serde_json::Value = serde_json::from_str(&stdout(&get)).expect("settings JSON");
    assert_eq!(document["llmProvider"], "groq");

    assert_success(&run(
        &db,
        &keys,
        &["settings", "set", "showWordPos", "true"],
        &[],
    ));
    assert_success(&run(&db, &keys, &["settings", "set", "level", "B2"], &[]));

    let get = run(&db, &keys, &["settings", "get", "showWordPos"], &[]);
    assert_success(&get);
    assert_eq!(stdout(&get).trim(), "true");

    let get = run(&db, &keys, &["settings", "get", "level"], &[]);
    assert_success(&get);
    assert_eq!(stdout(&get).trim(), "\"B2\"");

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn sessions_insights_and_a_database_export_work_on_an_empty_store() {
    let dir = temp_dir("empty");
    let db = dir.join("onspot.db");
    let keys = dir.join("keys.json");

    let list = run(&db, &keys, &["sessions", "list"], &[]);
    assert_success(&list);
    assert!(stdout(&list).contains("ID\tMODE"));

    let insights = run(&db, &keys, &["insights"], &[]);
    assert_success(&insights);
    assert!(stdout(&insights).contains("0 sessions · 0 takes"));

    let out = dir.join("export.sqlite");
    let export = run(
        &db,
        &keys,
        &[
            "export",
            "database",
            "--out",
            out.to_str().expect("utf-8 path"),
        ],
        &[],
    );
    assert_success(&export);
    let header = std::fs::read(&out).expect("export");
    assert!(header.starts_with(b"SQLite format 3\0"));

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_session_export_is_markdown_and_can_be_written_to_a_file() {
    let dir = temp_dir("export");
    let db = dir.join("onspot.db");
    let keys = dir.join("keys.json");

    let ctx = Context::open(&db).expect("context");
    block_on(async {
        ctx.records
            .put_session(&Session {
                id: "s1".to_owned(),
                title: "Morning routine".to_owned(),
                mode: "casual".to_owned(),
                started_at: "2026-01-01T09:00:00Z".to_owned(),
                ended_at: None,
                created_at: "2026-01-01T09:00:00Z".to_owned(),
                updated_at: "2026-01-01T09:00:00Z".to_owned(),
                setup: None,
            })
            .await
            .expect("session");
        ctx.records
            .put_attempt(&Attempt {
                id: "a1".to_owned(),
                session_id: "s1".to_owned(),
                prompt_id: None,
                prompt_text: "Parlez de votre matin.".to_owned(),
                transcript: "je me leve a sept heures".to_owned(),
                corrected_text: Some("Je me lève à sept heures.".to_owned()),
                translation: None,
                translations: None,
                tts_voice: None,
                explanation: Some("Bien.".to_owned()),
                follow_up: None,
                word_glosses: None,
                duration_sec: 4.0,
                word_count: 6,
                audio_key: None,
                created_at: "2026-01-01T09:00:05Z".to_owned(),
                updated_at: "2026-01-01T09:00:05Z".to_owned(),
            })
            .await
            .expect("attempt");
    });
    drop(ctx);

    let printed = run(&db, &keys, &["export", "session", "s1"], &[]);
    assert_success(&printed);
    let markdown = stdout(&printed);
    assert!(markdown.contains("Morning routine"), "{markdown}");
    assert!(markdown.contains("je me leve a sept heures"), "{markdown}");
    assert!(markdown.contains("Je me lève à sept heures."), "{markdown}");

    let out = dir.join("session.md");
    let written = run(
        &db,
        &keys,
        &[
            "export",
            "session",
            "s1",
            "--out",
            out.to_str().expect("utf-8 path"),
        ],
        &[],
    );
    assert_success(&written);
    let file = std::fs::read_to_string(&out).expect("markdown");
    assert!(file.contains("Morning routine"), "{file}");

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_evaluate_request_matches_the_gui_shape() {
    let settings = AppSettings {
        llm_provider: "groq".to_owned(),
        llm_model: providers::automatic_model().to_owned(),
        target_language: "fr".to_owned(),
        instruction_language: "en".to_owned(),
        ..AppSettings::default()
    };

    let request = build_request(
        &settings,
        &EvaluateOptions {
            transcript: "  bonjour  ".to_owned(),
            prompt: Some("Parlez.".to_owned()),
            mode: Some("exam".to_owned()),
            level: Some("B1".to_owned()),
            provider: None,
            model: None,
            target_language: None,
            instruction_language: None,
        },
    )
    .expect("request");

    assert_eq!(request.transcript, "bonjour");
    assert_eq!(request.mode, "exam");
    assert_eq!(request.level, "B1");
    assert_eq!(request.language, "French");
    assert_eq!(request.translation_target, "English");
    assert_eq!(request.endpoint.provider, "groq");
    assert_eq!(
        request.endpoint.base_url,
        providers::provider("groq").base_url
    );
    assert!(!request.endpoint.model.is_empty());
    assert_ne!(request.endpoint.model, providers::automatic_model());
}

#[test]
fn an_empty_transcript_is_refused_before_any_network_call() {
    let settings = AppSettings::default();
    let error = build_request(
        &settings,
        &EvaluateOptions {
            transcript: "   ".to_owned(),
            prompt: None,
            mode: None,
            level: None,
            provider: None,
            model: None,
            target_language: None,
            instruction_language: None,
        },
    )
    .expect_err("empty transcript");
    assert!(error.to_string().contains("transcript"));
}

#[test]
fn evaluate_sends_the_core_request_and_prints_the_validated_result() {
    let dir = temp_dir("evaluate");
    let db = dir.join("onspot.db");
    let keys = dir.join("keys.json");
    let transcript = dir.join("transcript.txt");
    std::fs::write(&transcript, "bonjour").expect("transcript");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let address = listener.local_addr().expect("address");
    let (request_tx, request_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let request = read_request(&mut stream);
        let content = serde_json::json!({
            "correctedText": "Bonjour.",
            "spokenLanguage": "French",
            "explanation": { "note": "Bien.", "mistakes": [] },
            "followUp": { "question": "Ça va ?", "translation": "How are you?" },
            "corrections": [],
            "vocabulary": [],
            "connectors": []
        })
        .to_string();
        let body = serde_json::json!({
            "choices": [{ "message": { "content": content }, "finish_reason": "stop" }]
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response");
        let _ = request_tx.send(request);
    });

    let base_url = format!("http://{address}/v1");
    assert_success(&run(
        &db,
        &keys,
        &["settings", "set", "llmProvider", "custom"],
        &[],
    ));
    assert_success(&run(
        &db,
        &keys,
        &["settings", "set", "customBaseUrl", &base_url],
        &[],
    ));
    assert_success(&run(
        &db,
        &keys,
        &["settings", "set", "customModel", "stub"],
        &[],
    ));
    assert_success(&run(
        &db,
        &keys,
        &["settings", "set", "llmModel", "stub"],
        &[],
    ));

    let output = run(
        &db,
        &keys,
        &[
            "evaluate",
            "--transcript",
            transcript.to_str().expect("utf-8 path"),
            "--prompt",
            "Parlez.",
            "--mode",
            "exam",
            "--level",
            "B1",
        ],
        &[("ONSPOT_CUSTOM_API_KEY", "test-key")],
    );
    assert_success(&output);
    let result: serde_json::Value = serde_json::from_str(&stdout(&output)).expect("result JSON");
    assert_eq!(result["correctedText"], "Bonjour.");
    assert_eq!(result["explanation"], "Bien.");

    let request = request_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("request");
    assert!(request.contains("\"model\":\"stub\""), "{request}");
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer test-key"),
        "{request}"
    );
    server.join().expect("server");

    let _ = std::fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn ctrl_c_cancels_an_in_flight_evaluation() {
    let dir = temp_dir("cancel");
    let db = dir.join("onspot.db");
    let keys = dir.join("keys.json");
    let transcript = dir.join("transcript.txt");
    std::fs::write(&transcript, "bonjour").expect("transcript");

    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let address = listener.local_addr().expect("address");
    let (accepted_tx, accepted_rx) = mpsc::channel();
    let (close_tx, close_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        accepted_tx.send(()).expect("accepted");
        let _ = close_rx.recv_timeout(Duration::from_secs(10));
        drop(stream);
    });

    let base_url = format!("http://{address}/v1");
    for (field, value) in [
        ("llmProvider", "custom"),
        ("customBaseUrl", base_url.as_str()),
        ("customModel", "stub"),
        ("llmModel", "stub"),
    ] {
        assert_success(&run(&db, &keys, &["settings", "set", field, value], &[]));
    }

    let mut child = Command::new(env!("CARGO_BIN_EXE_onspot-cli"))
        .arg("--db")
        .arg(&db)
        .arg("--keys-file")
        .arg(&keys)
        .args([
            "evaluate",
            "--transcript",
            transcript.to_str().expect("utf-8 path"),
        ])
        .env("ONSPOT_CUSTOM_API_KEY", "test-key")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn");

    accepted_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the evaluator connected");
    let signal = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) };
    assert_eq!(signal, 0, "SIGINT");

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            assert!(!status.success(), "ctrl-c must exit non-zero");
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("ctrl-c did not cancel the in-flight evaluation");
        }
        thread::sleep(Duration::from_millis(25));
    }
    let _ = close_tx.send(());
    server.join().expect("server");

    let _ = std::fs::remove_dir_all(dir);
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut data = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let read = stream.read(&mut buffer).expect("read request");
        if read == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..read]);
        if let Some(end) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&data[..end]);
            let length = head
                .lines()
                .find_map(|line| {
                    line.strip_prefix("Content-Length:")
                        .or_else(|| line.strip_prefix("content-length:"))
                })
                .and_then(|value| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if data.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8_lossy(&data).into_owned()
}
