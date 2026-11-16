// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use futures::executor::block_on;
use onspot_adapter_llm_openai::client::OpenAiEvaluator;
use onspot_cli::evaluation::{evaluate_with, EvaluateOptions};
use onspot_cli::http::{NativeHttp, SystemClock};
use onspot_cli::{settings, CliError, CliSecrets, Context};
use onspot_ports::CancelToken;
use serde::Serialize;

#[derive(Debug)]
struct Cli {
    db: Option<PathBuf>,
    keys_file: Option<PathBuf>,
    json: bool,
    command: Command,
}

#[derive(Debug)]
enum Command {
    Settings(SettingsCommand),
    Sessions(SessionsCommand),
    Evaluate(EvaluateArgs),
    Insights,
    Export(ExportCommand),
}

#[derive(Debug)]
enum SettingsCommand {
    Get(Option<String>),
    Set(String, String),
}

#[derive(Debug)]
enum SessionsCommand {
    List,
    Show(String),
}

#[derive(Debug)]
struct EvaluateArgs {
    transcript: PathBuf,
    prompt: Option<String>,
    mode: Option<String>,
    level: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    target_language: Option<String>,
    instruction_language: Option<String>,
}

#[derive(Debug)]
enum ExportCommand {
    Session {
        id: String,
        format: String,
        out: Option<PathBuf>,
    },
    Database {
        out: PathBuf,
    },
}

static CANCEL: OnceLock<CancelToken> = OnceLock::new();

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), CliError> {
    let cli = parse_args()?;

    let token = CancelToken::new();
    let _ = CANCEL.set(token.clone());
    install_cancel_handler();

    let secrets = Arc::new(CliSecrets::load(CliSecrets::keys_file_path(cli.keys_file))?);
    let db = cli.db.unwrap_or_else(onspot_cli::default_db_path);
    let ctx = Context::open(&db)?;

    block_on(async {
        match cli.command {
            Command::Settings(command) => match command {
                SettingsCommand::Get(field) => {
                    print_json(&settings::get(&ctx, field.as_deref()).await?)?;
                }
                SettingsCommand::Set(field, value) => {
                    print_json(&settings::set(&ctx, &field, &value).await?)?;
                }
            },
            Command::Sessions(command) => match command {
                SessionsCommand::List => {
                    let sessions = onspot_cli::sessions::list(&ctx).await?;
                    if cli.json {
                        let rows = sessions
                            .iter()
                            .map(|session| {
                                serde_json::json!({
                                    "session": session.session,
                                    "attempts": session.attempts,
                                })
                            })
                            .collect::<Vec<_>>();
                        print_json(&rows)?;
                    } else {
                        println!("ID\tMODE\tTAKES\tSTARTED\tTITLE");
                        for row in sessions {
                            println!(
                                "{}\t{}\t{}\t{}\t{}",
                                row.session.id,
                                row.session.mode,
                                row.attempts.len(),
                                row.session.started_at,
                                row.session.title
                            );
                        }
                    }
                }
                SessionsCommand::Show(id) => {
                    let detail = onspot_cli::sessions::show(&ctx, &id).await?;
                    if cli.json {
                        print_json(&detail)?;
                    } else {
                        print_session(&detail);
                    }
                }
            },
            Command::Evaluate(args) => {
                let settings = settings::load(&ctx).await?;
                let options = EvaluateOptions {
                    transcript: std::fs::read_to_string(&args.transcript)?,
                    prompt: args.prompt,
                    mode: args.mode,
                    level: args.level,
                    provider: args.provider,
                    model: args.model,
                    target_language: args.target_language,
                    instruction_language: args.instruction_language,
                };
                let http = Arc::new(NativeHttp::new(secrets.clone())?);
                let evaluator = OpenAiEvaluator::new(http, Arc::new(SystemClock));
                let (request, result) =
                    evaluate_with(&settings, &options, &evaluator, &token).await?;
                event(serde_json::json!({
                    "event": "evaluated",
                    "provider": request.endpoint.provider,
                    "model": request.endpoint.model,
                }));
                print_json(&result)?;
            }
            Command::Insights => {
                let data = onspot_cli::insights::build(&ctx).await?;
                if cli.json {
                    print_json(&data)?;
                } else {
                    println!(
                        "{} sessions · {} takes · {} words · {} errors · {} warnings · {} suggestions",
                        data.totals.sessions,
                        data.totals.attempts,
                        data.totals.words,
                        data.totals.errors,
                        data.totals.warnings,
                        data.totals.suggestions
                    );
                    for pattern in data.patterns {
                        println!(
                            "{}\t{}\t{}\t{}",
                            pattern.severity, pattern.category, pattern.count, pattern.label
                        );
                    }
                }
            }
            Command::Export(command) => match command {
                ExportCommand::Session { id, format, out } => {
                    debug_assert_eq!(format, "md");
                    let (stem, document) = onspot_cli::exports::session_markdown(&ctx, &id).await?;
                    match out {
                        Some(out) => {
                            let path = if out.is_dir() {
                                out.join(format!("{stem}.md"))
                            } else {
                                out
                            };
                            if let Some(parent) = path.parent() {
                                if !parent.as_os_str().is_empty() {
                                    std::fs::create_dir_all(parent)?;
                                }
                            }
                            std::fs::write(&path, document)?;
                            println!("{}", path.display());
                        }
                        None => print!("{document}"),
                    }
                }
                ExportCommand::Database { out } => {
                    onspot_cli::exports::database(&ctx, &out).await?;
                    println!("{}", out.display());
                }
            },
        }
        Ok::<(), CliError>(())
    })
}

fn parse_args() -> Result<Cli, CliError> {
    let mut args = std::env::args().skip(1).peekable();
    let mut db = std::env::var_os("ONSPOT_DB").map(PathBuf::from);
    let mut keys_file = std::env::var_os("ONSPOT_KEYS_FILE").map(PathBuf::from);
    let mut json = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--db" => db = Some(PathBuf::from(next_value(&mut args, "--db")?)),
            "--keys-file" => keys_file = Some(PathBuf::from(next_value(&mut args, "--keys-file")?)),
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--version" | "-V" => {
                println!("{}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            other if other.starts_with("--db=") => {
                db = Some(PathBuf::from(&other["--db=".len()..]));
            }
            other if other.starts_with("--keys-file=") => {
                keys_file = Some(PathBuf::from(&other["--keys-file=".len()..]));
            }
            other if other.starts_with('-') => {
                return Err(CliError::message(format!("unknown option {other}")));
            }
            other => {
                let rest = args.collect::<Vec<_>>();
                return Ok(Cli {
                    db,
                    keys_file,
                    json,
                    command: parse_command(other, &rest)?,
                });
            }
        }
    }
    Err(CliError::message("missing command; try --help"))
}

fn parse_command(name: &str, args: &[String]) -> Result<Command, CliError> {
    match name {
        "settings" => {
            let (sub, rest) = split_subcommand(args, "settings")?;
            match sub {
                "get" => {
                    let field = rest.first().cloned();
                    if rest.len() > 1 {
                        return usage("settings get takes at most one field");
                    }
                    Ok(Command::Settings(SettingsCommand::Get(field)))
                }
                "set" => {
                    if rest.len() != 2 {
                        return usage("settings set needs a field and a value");
                    }
                    Ok(Command::Settings(SettingsCommand::Set(
                        rest[0].clone(),
                        rest[1].clone(),
                    )))
                }
                other => usage(&format!("unknown settings command {other}")),
            }
        }
        "sessions" => {
            let (sub, rest) = split_subcommand(args, "sessions")?;
            match sub {
                "list" => {
                    if !rest.is_empty() {
                        return usage("sessions list takes no arguments");
                    }
                    Ok(Command::Sessions(SessionsCommand::List))
                }
                "show" => match rest {
                    [id] => Ok(Command::Sessions(SessionsCommand::Show(id.clone()))),
                    _ => usage("sessions show needs one session id"),
                },
                other => usage(&format!("unknown sessions command {other}")),
            }
        }
        "evaluate" => Ok(Command::Evaluate(parse_evaluate(args)?)),
        "insights" => {
            if !args.is_empty() {
                return usage("insights takes no arguments");
            }
            Ok(Command::Insights)
        }
        "export" => parse_export(args),
        other => usage(&format!("unknown command {other}")),
    }
}

fn parse_evaluate(args: &[String]) -> Result<EvaluateArgs, CliError> {
    let mut transcript = None;
    let mut prompt = None;
    let mut mode = None;
    let mut level = None;
    let mut provider = None;
    let mut model = None;
    let mut target_language = None;
    let mut instruction_language = None;

    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let mut take = |name: &str| -> Result<String, CliError> {
            index += 1;
            args.get(index)
                .cloned()
                .ok_or_else(|| CliError::message(format!("{name} needs a value")))
        };
        match arg.as_str() {
            "--transcript" => transcript = Some(PathBuf::from(take("--transcript")?)),
            "--prompt" => prompt = Some(take("--prompt")?),
            "--mode" => mode = Some(take("--mode")?),
            "--level" => level = Some(take("--level")?),
            "--provider" => provider = Some(take("--provider")?),
            "--model" => model = Some(take("--model")?),
            "--target-language" | "--target" => target_language = Some(take("--target-language")?),
            "--instruction-language" | "--instruction" => {
                instruction_language = Some(take("--instruction-language")?)
            }
            other => return usage(&format!("unknown evaluate option {other}")),
        }
        index += 1;
    }

    let transcript = transcript.ok_or_else(|| CliError::message("evaluate needs --transcript"))?;
    if let Some(mode) = mode.as_deref() {
        if !matches!(mode, "exam" | "casual" | "freeflow") {
            return usage("mode must be exam, casual or freeflow");
        }
    }
    if let Some(level) = level.as_deref() {
        if !matches!(level, "A2" | "B1" | "B2" | "C1") {
            return usage("level must be A2, B1, B2 or C1");
        }
    }
    Ok(EvaluateArgs {
        transcript,
        prompt,
        mode,
        level,
        provider,
        model,
        target_language,
        instruction_language,
    })
}

fn parse_export(args: &[String]) -> Result<Command, CliError> {
    let (sub, rest) = split_subcommand(args, "export")?;
    match sub {
        "session" => {
            let mut id = None;
            let mut format = "md".to_owned();
            let mut out = None;
            let mut index = 0;
            while index < rest.len() {
                let arg = &rest[index];
                match arg.as_str() {
                    "--format" => {
                        index += 1;
                        format = rest
                            .get(index)
                            .cloned()
                            .ok_or_else(|| CliError::message("--format needs a value"))?;
                    }
                    "--out" => {
                        index += 1;
                        out = Some(PathBuf::from(
                            rest.get(index)
                                .cloned()
                                .ok_or_else(|| CliError::message("--out needs a value"))?,
                        ));
                    }
                    other if other.starts_with('-') => {
                        return usage(&format!("unknown export option {other}"))
                    }
                    other => {
                        if id.is_some() {
                            return usage("export session takes one session id");
                        }
                        id = Some(other.to_owned());
                    }
                }
                index += 1;
            }
            if format != "md" {
                return usage("only --format md is supported");
            }
            Ok(Command::Export(ExportCommand::Session {
                id: id.ok_or_else(|| CliError::message("export session needs a session id"))?,
                format,
                out,
            }))
        }
        "database" => {
            let mut out = None;
            let mut index = 0;
            while index < rest.len() {
                match rest[index].as_str() {
                    "--out" => {
                        index += 1;
                        out = Some(PathBuf::from(
                            rest.get(index)
                                .cloned()
                                .ok_or_else(|| CliError::message("--out needs a value"))?,
                        ));
                    }
                    other => return usage(&format!("unknown export database option {other}")),
                }
                index += 1;
            }
            Ok(Command::Export(ExportCommand::Database {
                out: out.ok_or_else(|| CliError::message("export database needs --out"))?,
            }))
        }
        other => usage(&format!("unknown export command {other}")),
    }
}

fn split_subcommand<'a>(
    args: &'a [String],
    parent: &str,
) -> Result<(&'a str, &'a [String]), CliError> {
    let (sub, rest) = args
        .split_first()
        .ok_or_else(|| CliError::message(format!("{parent} needs a subcommand")))?;
    Ok((sub.as_str(), rest))
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, CliError> {
    args.next()
        .ok_or_else(|| CliError::message(format!("{flag} needs a value")))
}

fn usage<T>(message: &str) -> Result<T, CliError> {
    Err(CliError::message(format!("{message}\n\ntry --help")))
}

fn print_help() {
    println!(
        "onspot-cli {}\n\n\
Usage: onspot-cli [--db PATH] [--keys-file PATH] [--json] <command>\n\n\
Commands:\n\
  settings get [FIELD]              read the typed settings document\n\
  settings set FIELD VALUE          write one setting (JSON or string)\n\
  sessions list                     list sessions\n\
  sessions show ID                  show takes and corrections\n\
  evaluate --transcript FILE        evaluate a spoken transcript\n\
      [--prompt TEXT] [--mode exam|casual|freeflow] [--level A2|B1|B2|C1]\n\
      [--provider ID] [--model ID] [--target-language CODE]\n\
      [--instruction-language CODE]\n\
  insights                          aggregate corrections\n\
  export session ID [--format md] [--out PATH]\n\
  export database --out PATH        write a .sqlite image\n\n\
Environment: ONSPOT_DB, ONSPOT_KEYS_FILE, GROQ_API_KEY, DEEPSEEK_API_KEY,\n\
ONSPOT_API_KEY, ONSPOT_<PROVIDER>_API_KEY",
        env!("CARGO_PKG_VERSION")
    );
}

fn event(value: serde_json::Value) {
    eprintln!("{value}");
}

fn print_json(value: &impl Serialize) -> Result<(), CliError> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_session(detail: &onspot_cli::sessions::SessionDetail) {
    println!("{} — {}", detail.session.id, detail.session.title);
    println!(
        "mode: {} · started: {} · takes: {}",
        detail.session.mode,
        detail.session.started_at,
        detail.attempts.len()
    );
    for (index, attempt) in detail.attempts.iter().enumerate() {
        println!();
        println!("[{}] {}", index + 1, attempt.transcript);
        if let Some(corrected) = attempt.corrected_text.as_deref() {
            if corrected != attempt.transcript {
                println!("    corrected: {corrected}");
            }
        }
        if let Some(corrections) = detail.corrections.get(&attempt.id) {
            for correction in corrections {
                println!(
                    "    {}: {} → {} — {}",
                    correction.category,
                    correction.original,
                    correction.replacement,
                    correction.explanation
                );
            }
        }
    }
}

#[cfg(unix)]
fn install_cancel_handler() {
    unsafe {
        libc::signal(
            libc::SIGINT,
            handle_sigint as *const () as libc::sighandler_t,
        );
    }
}

#[cfg(not(unix))]
fn install_cancel_handler() {}

#[cfg(unix)]
extern "C" fn handle_sigint(_signal: libc::c_int) {
    if let Some(token) = CANCEL.get() {
        token.cancel();
    }
}
