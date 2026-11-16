// SPDX-License-Identifier: AGPL-3.0-or-later

//! Prompt-topic generation, ported from `src/lib/adapters/llm/promptTopic.ts`.
//!
//! The prompt is written directly in the language of instruction, then checked
//! for script, length, word count and recent topics before the practice loop
//! may use it.

use serde_json::Value;

use onspot_dsp::speech::count_words;
use onspot_dsp::text_language::could_be_written_in;
use onspot_ports::PromptTopicRequest;

use crate::parse::extract_json;
use crate::prompt::ChatMessage;

/// A title short enough for the practice bar.
const MAX_TITLE_CHARS: usize = 50;
/// A task of 5-6 words, never a paragraph.
const MAX_PROMPT_WORDS: usize = 6;
/// Catches one runaway token in a language with long words.
const MAX_TEXT_CHARS: usize = 140;
/// The answer is two short strings; this caps a runaway reply.
pub const PROMPT_TOPIC_TOKENS: u32 = 300;
/// Recent topics named in the request.
const MAX_AVOIDED_TOPICS: usize = 12;

/// A validated prompt: a short title and the task to answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedPrompt {
    pub title: String,
    pub text: String,
}

fn mode_guidance(mode: &str) -> String {
    match mode {
        "casual" => String::from("a relaxed, everyday conversation topic"),
        "exam" => String::from("a structured topic of the kind an oral exam asks for"),
        "freeflow" => String::from("an open, personal topic"),
        other => format!("a {other} task"),
    }
}

/// Renders the byte-identical system message and user turn.
pub fn build_prompt_messages(request: &PromptTopicRequest) -> Vec<ChatMessage> {
    let avoid_topics: Vec<&str> = request
        .avoid_topics
        .iter()
        .take(MAX_AVOIDED_TOPICS)
        .map(String::as_str)
        .collect();
    let avoid_line = if avoid_topics.is_empty() {
        String::new()
    } else {
        format!(
            "Do not repeat any of these recent topics: {}.",
            avoid_topics
                .iter()
                .map(|topic| format!("\"{topic}\""))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let system = [
        format!(
            "You write one speaking-practice prompt for a learner studying {} at level {}.",
            request.target_language, request.level
        ),
        format!(
            "Write both the title and the task in {}, never in {}.",
            request.instruction_language, request.target_language
        ),
        format!("Make it {}.", mode_guidance(&request.mode)),
        String::from("The task is 5 or 6 words, never more than 6, telling the learner what to talk about. Do not answer it, offer vocabulary, or write dialogue; never write a paragraph."),
        avoid_line,
        String::from("Return only JSON: { \"title\": string, \"text\": string }"),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n");

    vec![
        ChatMessage {
            role: String::from("system"),
            content: system,
        },
        ChatMessage {
            role: String::from("user"),
            content: format!("Write the next prompt in {}.", request.instruction_language),
        },
    ]
}

/// Pulls the two strings out of the model reply.
pub fn parse_prompt_topic(raw: &str) -> Result<GeneratedPrompt, String> {
    let parsed = extract_json(raw)?;
    let object: Option<&serde_json::Map<String, Value>> = parsed.as_object();
    let title = object
        .and_then(|fields| fields.get("title"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let text = object
        .and_then(|fields| fields.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();

    if title.is_empty() || text.is_empty() {
        return Err(String::from(
            "The model returned no prompt. Please try again.",
        ));
    }
    if title.encode_utf16().count() > MAX_TITLE_CHARS {
        return Err(String::from(
            "The model’s prompt title was too long. Please try again.",
        ));
    }
    if text.encode_utf16().count() > MAX_TEXT_CHARS {
        return Err(String::from(
            "The model’s prompt was too long. Please try again.",
        ));
    }
    if count_words(&text) > MAX_PROMPT_WORDS {
        return Err(format!(
            "The model’s prompt was longer than {MAX_PROMPT_WORDS} words. Please try again."
        ));
    }
    Ok(GeneratedPrompt { title, text })
}

/// Checks the prompt is in the instruction language and not a recent repeat.
pub fn validate_prompt_topic(
    generated: &GeneratedPrompt,
    request: &PromptTopicRequest,
) -> Result<(), String> {
    let in_language = could_be_written_in(
        &generated.title,
        &request.instruction_language_id,
        &request.instruction_scripts,
    ) && could_be_written_in(
        &generated.text,
        &request.instruction_language_id,
        &request.instruction_scripts,
    );
    if !in_language {
        return Err(format!(
            "The model did not write the prompt in {}. Please try again.",
            request.instruction_language
        ));
    }

    let title = normalize_topic(&generated.title);
    if request
        .avoid_topics
        .iter()
        .take(MAX_AVOIDED_TOPICS)
        .any(|topic| normalize_topic(topic) == title)
    {
        return Err(String::from(
            "The model repeated a recent prompt. Please try again.",
        ));
    }
    Ok(())
}

/// A title without case or punctuation, so two spellings still match.
fn normalize_topic(topic: &str) -> String {
    topic
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use onspot_domain::LlmEndpoint;

    fn request(avoid: &[&str]) -> PromptTopicRequest {
        PromptTopicRequest {
            endpoint: LlmEndpoint {
                provider: String::from("groq"),
                base_url: String::from("https://example.test/v1"),
                model: String::from("model"),
                fallback_models: Vec::new(),
            },
            instruction_language: String::from("English"),
            instruction_language_id: String::from("en"),
            instruction_scripts: vec![String::from("Latin")],
            target_language: String::from("French"),
            level: String::from("B1"),
            mode: String::from("casual"),
            avoid_topics: avoid.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    #[test]
    fn messages_match_the_typescript_template() {
        let messages = build_prompt_messages(&request(&["A café", "At work"]));
        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.starts_with(
            "You write one speaking-practice prompt for a learner studying French at level B1."
        ));
        assert!(messages[0]
            .content
            .contains("Do not repeat any of these recent topics: \"A café\", \"At work\"."));
        assert_eq!(messages[0].content.matches('\n').count(), 5);
        assert_eq!(messages[1].content, "Write the next prompt in English.");
    }

    #[test]
    fn parser_rejects_long_or_missing_prompts() {
        assert_eq!(
            parse_prompt_topic(r#"{"title":"Café","text":"Order a coffee"}"#).unwrap(),
            GeneratedPrompt {
                title: String::from("Café"),
                text: String::from("Order a coffee"),
            }
        );
        assert!(parse_prompt_topic(r#"{"title":"","text":"Order a coffee"}"#).is_err());
        assert!(parse_prompt_topic(
            r#"{"title":"Café","text":"one two three four five six seven"}"#
        )
        .is_err());
        assert!(parse_prompt_topic(&format!(
            r#"{{"title":"Café","text":"{}"}}"#,
            "a".repeat(141)
        ))
        .is_err());
    }

    #[test]
    fn validator_checks_script_and_recent_topics() {
        let generated = GeneratedPrompt {
            title: String::from("Au café"),
            text: String::from("Order a coffee"),
        };
        assert!(validate_prompt_topic(&generated, &request(&[])).is_ok());
        assert!(validate_prompt_topic(&generated, &request(&["AU CAFÉ!"])).is_err());

        let wrong_script = GeneratedPrompt {
            title: String::from("在咖啡馆"),
            text: String::from("点一杯咖啡"),
        };
        assert!(validate_prompt_topic(&wrong_script, &request(&[])).is_err());
    }
}
