// SPDX-License-Identifier: AGPL-3.0-or-later

//! Hover word meanings and selected-phrase translation.

use once_cell::sync::Lazy;
use onspot_domain::{GlossedRange, LlmEndpoint, PhraseGloss, TextGlosses};
use onspot_ports::{CancelToken, CoreError};
use regex::Regex;
use serde_json::Value;

use crate::client::OpenAiEvaluator;
use crate::parse::extract_json;
use crate::prompt::ChatMessage;

static WORD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{L}\p{N}]+(?:['’\-\u{200c}][\p{L}\p{N}]+)*").expect("word regex"));

const MAX_EXPRESSION_WORDS: i64 = 6;

fn words_of(text: &str) -> Vec<String> {
    WORD.find_iter(text)
        .map(|word| word.as_str().to_owned())
        .collect()
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn aligned(raw: Option<&Value>, count: usize) -> Vec<String> {
    let mut glosses = vec![String::new(); count];
    match raw {
        Some(Value::Array(items)) if items.len() == count => {
            for (index, item) in items.iter().enumerate() {
                glosses[index] = text(Some(item));
            }
        }
        Some(Value::Object(fields)) => {
            for (number, gloss) in fields {
                if let Ok(number) = number.parse::<usize>() {
                    if number >= 1 && number <= count {
                        glosses[number - 1] = text(Some(gloss));
                    }
                }
            }
        }
        _ => {}
    }
    glosses
}

fn expressions(raw: Option<&Value>, count: usize) -> Vec<PhraseGloss> {
    let Some(items) = raw.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut output: Vec<PhraseGloss> = Vec::new();
    for item in items {
        let start = item.get("from").and_then(Value::as_i64).unwrap_or(0) - 1;
        let end = item.get("to").and_then(Value::as_i64).unwrap_or(0) - 1;
        let meaning = text(item.get("meaning"));
        let length = end - start + 1;
        let in_text = start >= 0 && end >= 0 && (end as usize) < count;
        let overlaps = output
            .iter()
            .any(|other| start <= other.end && end >= other.start);
        if meaning.is_empty()
            || !in_text
            || !(2..=MAX_EXPRESSION_WORDS).contains(&length)
            || overlaps
        {
            continue;
        }
        output.push(PhraseGloss {
            start,
            end,
            meaning,
            origin: String::from("expression"),
        });
    }
    output
}

fn gloss_messages(
    section: &str,
    words: &[String],
    source: &str,
    target: &str,
    with_pos: bool,
) -> Vec<ChatMessage> {
    let pos_instruction = if with_pos {
        "Also return a \"pos\" object: for every word number, a short English part-of-speech label: \"noun\", \"verb\", \"adj\", \"adv\", \"prep\", \"pron\", \"conj\", \"det\", \"num\", or \"other\". Proper nouns get \"noun\".\nReturn only JSON: { \"glosses\": { \"1\": string, ... }, \"pos\": { \"1\": string, ... }, \"expressions\": [ ... ] }, all word numbers covered."
    } else {
        "Return only JSON: { \"glosses\": { \"1\": string, \"2\": string, ... }, \"expressions\": [ { \"from\": number, \"to\": number, \"meaning\": string } ] }, with a gloss for every word number, keyed by that number."
    };
    let system = format!(
        "You give {source}-to-{target} word meanings for a language learner who hovers over words.
For every numbered word, give its meaning in {target} as it is used in that sentence:
- 1 to 4 words, lowercase unless {target} capitalises it (a name; in English, \"I\"); the inflected sense (\"allé\" → \"went\", \"j'ai\" → \"I have\"); no explanations.
- A name stays as it is. A misspoken or non-existent word gets its most likely intended meaning in brackets with a question mark, e.g. \"[late?]\".
Also list the expressions: runs of 2 to {MAX_EXPRESSION_WORDS} consecutive words that must be read together because translating them word by word gives a wrong or misleading meaning, such as compound nouns (\"pomme de terre\" → \"potato\"), fixed expressions (\"tout à fait\" → \"absolutely\", \"il y a\" → \"there is\", \"en retard\" → \"late\", \"tout à coup\" → \"suddenly\") and verb phrases (\"avoir besoin de\" → \"to need\").
If the word-by-word meanings already read correctly together, it is NOT an expression: ordinary phrases such as \"avec ma sœur\", \"nous avons acheté\", \"dans un petit café\", \"c'était très bon\" or \"au marché\" are not, and neither is any verb in a compound tense (an auxiliary plus a past participle, such as \"j'ai préféré\" or \"nous sommes allés\"). Most sentences have none or one. Give each expression as its first and last word number and its meaning in context, translating all of its words, subject included (\"il y a\" → \"there is\", never just \"is\").
{pos_instruction}"
    );
    let user = format!(
        "Text: \"\"\"{}\"\"\"\nWords:\n{}",
        section.trim(),
        words
            .iter()
            .enumerate()
            .map(|(index, word)| format!("{}. {word}", index + 1))
            .collect::<Vec<_>>()
            .join("\n")
    );
    vec![
        ChatMessage {
            role: String::from("system"),
            content: system,
        },
        ChatMessage {
            role: String::from("user"),
            content: user,
        },
    ]
}

impl OpenAiEvaluator {
    /// Glosses every word of a text and extracts its expressions.
    pub async fn gloss(
        &self,
        text_value: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        with_pos: bool,
        token: &CancelToken,
    ) -> Result<TextGlosses, CoreError> {
        let words = words_of(text_value);
        if words.is_empty() {
            return Ok(TextGlosses {
                words: Vec::new(),
                phrases: Vec::new(),
                pos: None,
                pos_sections: None,
                sections: None,
            });
        }
        let messages = gloss_messages(text_value, &words, language, translation_target, with_pos);
        let raw = self
            .complete(endpoint, &messages, 2048, true, 0.1, token)
            .await?;
        let parsed = extract_json(&raw).map_err(|message| {
            CoreError::new(
                "glosses.invalid_json",
                format!("The model returned unusable gloss JSON: {message}"),
            )
        })?;
        let glosses = aligned(parsed.get("glosses"), words.len());
        if glosses.iter().all(String::is_empty) {
            return Err(CoreError::new(
                "glosses.empty",
                "The model returned no word meanings. Please try again.",
            ));
        }
        let range = GlossedRange {
            start: 0,
            end: words.len() as i64 - 1,
        };
        let pos = with_pos.then(|| aligned(parsed.get("pos"), words.len()));
        Ok(TextGlosses {
            words: glosses,
            phrases: expressions(parsed.get("expressions"), words.len()),
            pos_sections: pos.as_ref().map(|_| vec![range.clone()]),
            pos,
            sections: Some(vec![range]),
        })
    }

    /// Translates a selected phrase in its surrounding text.
    pub async fn phrase(
        &self,
        phrase: &str,
        context: &str,
        endpoint: &LlmEndpoint,
        language: &str,
        translation_target: &str,
        token: &CancelToken,
    ) -> Result<String, CoreError> {
        let messages = vec![
            ChatMessage {
                role: String::from("system"),
                content: format!(
                    "You translate {language} phrases into {translation_target} for a language learner who selected them in a text.\nGive the meaning of the phrase as it is used in that text: natural {translation_target}, as short as the phrase allows, no explanations. A misspoken phrase gets its most likely intended meaning in brackets with a question mark.\nReturn only JSON: {{ \"meaning\": string }}"
                ),
            },
            ChatMessage {
                role: String::from("user"),
                content: format!("Text: \"{}\"\nPhrase: \"{}\"", context.trim(), phrase.trim()),
            },
        ];
        let raw = self
            .complete(endpoint, &messages, 640, true, 0.1, token)
            .await?;
        let parsed = extract_json(&raw)
            .map_err(|message| CoreError::new("phrases.invalid_json", message))?;
        let meaning = text(parsed.get("meaning"));
        if meaning.is_empty() {
            return Err(CoreError::new(
                "phrases.empty",
                "The model returned no meaning for that phrase. Please try again.",
            ));
        }
        Ok(meaning)
    }
}
