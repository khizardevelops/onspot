// SPDX-License-Identifier: AGPL-3.0-or-later

//! Evaluation prompt rendering, ported byte-for-byte from
//! `src/lib/adapters/llm/prompt.ts` (invariant I5).

use crate::explanation::EXPLANATION_MAX_MISTAKES;
use crate::language_guidance::{evaluation_guidance, level_note};

/// Output budget for one evaluation request.
pub const MAX_EVALUATION_TOKENS: u32 = 3072;

/// Vocabulary upgrades suggested for one take, at most.
pub const MAX_VOCABULARY_SUGGESTIONS: usize = 3;
const EXPLANATION_MAX_LINE_WORDS: usize = 25;
const EXPLANATION_MAX_NOTE_WORDS: usize = 15;

/// One chat message sent to an OpenAI-compatible endpoint.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// The part of a long take a request checks, 1-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvaluationPart {
    pub number: usize,
    pub count: usize,
}

fn schema(language: &str, translation_target: &str) -> String {
    r#"{
  "spokenLanguage": string,       // the language the learner mainly spoke, named in English, e.g. "{{language}}", "English"
  "correctedText": string,        // "Did you mean to say…?": what the learner was trying to say, in correct, natural {{language}}
  "explanation": {                // what the teacher says out loud (see Explanation rules)
    "note": string,
    "mistakes": [ { "said": string, "say": string, "line": string } ]
  },
  "followUp": {                   // the question that keeps them talking (see Explanation rules)
    "question": string,           // in {{language}}, never in {{translationTarget}}
    "translation": string         // the same question in {{translationTarget}}
  },
  "corrections": [
    {
      "category": "grammar" | "register" | "filler" | "style",
      "severity": "error" | "warning" | "suggestion",
      "label": string,            // specific issue, e.g. "Greeting used for someone else"; never repeat category/severity
      "original": string,         // the exact substring to change
      "replacement": string,      // what it should be; EXACTLY "" when original should simply be removed
      "replacementTranslation": string, // native-language meaning of the replacement
      "explanation": string,      // why, in the learner's native language, aimed at a learner
      "speakText": string,        // OPTIONAL: one corrected sentence to read aloud
      "examStatus": "strictly-avoid" | "avoid" | "use-sparingly" | "allowed",
      "formalAlternatives": string[] // OPTIONAL: formal replacements for a casual connector
    }
  ],
  "vocabulary": [
    { "original": string, "suggestion": string, "why": string }
  ],
  "connectors": [
    { "connector": string, "insteadOf": string, "why": string }
  ]
}"#
        .replace("{{language}}", language)
        .replace("{{translationTarget}}", translation_target)
}

fn explanation_rules(language: &str, translation_target: &str) -> String {
    let template = r#"Explanation rules (the top-level "explanation" and "followUp" fields):
- "explanation" is what a friendly, direct {{language}} teacher says out loud to the student right after they finish speaking. It is spoken by text-to-speech, so write natural spoken {{translationTarget}}: talk to them ("you"), contractions are fine, short and warm. Never sound like a report or a grammar label.
  - Bad: "Incorrect article usage before a proper name."
  - Good: "Just say <right>New York</right>; city names don't take an article."
- Keep it compact: one quick spoken line per mistake and nothing extra.
- "mistakes": at most {{maxMistakes}} real mistakes, most important first, each also present in "corrections". [] when there are none.
  - A mistake is something wrong or clearly unnatural that has a better way to say it. "say" must differ from "said". Never list something you would repeat unchanged.
  - Only list a mistake when you are sure what the learner meant. If you would have to guess the fix, it is not a mistake (see the next rule).
  - "said": the learner's words, copied exactly from the transcript (the shortest phrase that shows the mistake).
  - "say": the corrected {{language}}; "" only when the words should simply be left out.
  - "line": the teacher's spoken sentence about this mistake, at most {{lineWords}} words: what they said, what to say instead, and the reason in everyday words. It must contain "say" in <right>…</right> and quote "said" in <wrong>…</wrong>.
  - Name each mistake once; never list the same words twice. Skip optional suggestions.
- A phrase that is grammatical but whose meaning is unclear, or that looks like a speech-recognition slip, is NOT a mistake and NOT a correction: never invent what they might have meant. If it matters, say in "note" which words you didn't catch, and let "followUp" ask what they meant.
- "note": an optional short opening the teacher says first, at most {{noteWords}} words: a quick genuine reaction to what they said or specific praise, or which words were unclear. Never preview or repeat a mistake the lines cover. With no mistakes, it is the whole reply: say it was correct and name one specific thing they did well.
- Wrap every other {{language}} word you mention in <key>…</key> (a verb, an auxiliary, a grammar term). No other tags, no markdown, no lists.
- "followUp": always one short question in {{language}} that continues their topic, at their level, so they keep speaking in their next take; "translation" is that question in natural {{translationTarget}}. Plain text, no tags. The question is read aloud by a {{language}} voice: write it in {{language}}, never in {{translationTarget}}, even where the two languages share a script or words.
- Examples (for a French learner; write your own words, react to what this student actually said{{exampleLanguageNote}}):
  "explanation": { "note": "You described that trip really vividly.", "mistakes": [
    { "said": "dans Paris", "say": "à Paris", "line": "You said <wrong>dans Paris</wrong>, but with a city we say <right>à Paris</right>." },
    { "said": "j'ai allé", "say": "je suis allé", "line": "And it's <right>je suis allé</right>, not <wrong>j'ai allé</wrong>: <key>aller</key> uses <key>être</key> in the past." } ] },
  "followUp": { "question": "Qu'est-ce que vous avez préféré à Paris ?", "translation": "What did you like best in Paris?" }

  "explanation": { "note": "That was all correct, and <key>du coup</key> sounded really natural.", "mistakes": [] },
  "followUp": { "question": "Vous y retournez cet été ?", "translation": "Are you going back this summer?" }"#;
    let example_language_note = if translation_target == "English" {
        String::new()
    } else {
        format!(
            "; they are in English only to show the form, so write yours in {translation_target}"
        )
    };
    template
        .replace("{{language}}", language)
        .replace("{{translationTarget}}", translation_target)
        .replace("{{maxMistakes}}", &EXPLANATION_MAX_MISTAKES.to_string())
        .replace("{{lineWords}}", &EXPLANATION_MAX_LINE_WORDS.to_string())
        .replace("{{noteWords}}", &EXPLANATION_MAX_NOTE_WORDS.to_string())
        .replace("{{exampleLanguageNote}}", &example_language_note)
}

fn rules(language: &str, translation_target: &str) -> String {
    let template = r#"Rules:
- The transcript comes from speech recognition. Ignore obvious transcription artefacts (misheard proper nouns, missing punctuation) unless they change the meaning; do not "correct" the recogniser's mistakes as if they were the learner's.
- Only correct what the learner actually said. Never invent context or content.
- "correctedText" is the sentence the learner was trying to say, said correctly and naturally. Stay faithful to them: keep their meaning, ideas, order and amount of detail; fix every error and warning; do not add, drop or embellish content, and do not apply optional suggestions. If there is nothing to fix, copy the transcript unchanged.
- The learner must answer in {{language}}. Set "spokenLanguage" to the language most of the transcript is in. If it is not {{language}}, return an empty "corrections" array and no explanation mistakes, give the {{language}} version of what they meant as "correctedText", and use "explanation.note" to tell them they answered in the wrong language.
- A word or phrase from another language inside {{language}} speech is a mistake: correct it to {{language}} with category "grammar", severity "error" (unless it is a proper noun or a loanword {{language}} speakers really use).
- grammar → severity "error". register and filler issues → "warning". optional polish → "suggestion".
- For register/filler corrections, set "examStatus" and give "formalAlternatives" where a formal connector exists.
- Connectors: prefer connectors that are appropriate for spoken {{language}} and, in exam mode, formal. Do not suggest written-only connectors the learner cannot say.
- Vocabulary: suggest at most {{maxVocabulary}} upgrades that a fluent speaker would plausibly use. If there is nothing worth changing, return [].
- Corrections must use "original" exactly as it appears in the transcript.
- If a word or phrase should be omitted, put it in "original" and set "replacement" to the empty string. Do not use arrows, dashes, "remove", or explanatory text as a replacement.
- Make "label" name the concrete learning issue. Do not repeat its category or severity (bad: "Register inappropriate"; good: "Greeting used for someone else").
- A correction must change something: its "replacement" never has the same words as its "original". Something that is only unclear is not a correction.
- When the learner made no mistakes, return an empty "corrections" array and say so in "explanation.note".
- Write every correction "explanation", "replacementTranslation", "why", "note" and "line" field in {{translationTarget}}; keep "correctedText", suggested replacements and "say" in {{language}}.
- Every correction with a non-empty "replacement" must include "replacementTranslation": the {{translationTarget}} meaning of the suggested replacement.
- Return ONLY the JSON object. No markdown, no commentary outside it.{{guidance}}"#;
    let guidance = evaluation_guidance(language, translation_target);
    let guidance = if guidance.is_empty() {
        String::new()
    } else {
        format!("\n\n{guidance}")
    };
    template
        .replace("{{language}}", language)
        .replace("{{translationTarget}}", translation_target)
        .replace("{{maxVocabulary}}", &MAX_VOCABULARY_SUGGESTIONS.to_string())
        .replace("{{guidance}}", &guidance)
}

fn part_note(part: EvaluationPart) -> String {
    let follow_up = if part.number == part.count {
        "Ask the follow-up question about the answer as a whole, as far as you can see it."
    } else {
        "The follow-up question of this part is not used; keep it short."
    };
    format!(
        "This transcript is part {} of {} of one longer answer; the other parts are checked separately. Check and correct only this part: \"correctedText\" and \"corrections\" cover this part alone. In the explanation, pick this part's most useful mistakes. {}",
        part.number, part.count, follow_up
    )
}

/// Renders the two messages for one evaluation request.
pub fn build_evaluation_messages(
    transcript: &str,
    prompt: &str,
    mode: &str,
    level: &str,
    language: &str,
    translation_target: &str,
    part: Option<EvaluationPart>,
) -> Vec<ChatMessage> {
    let is_freeflow = mode == "freeflow";
    let tone = if mode == "exam" {
        format!(
            "This is EXAM practice: prioritise formal, correct {language} suitable for the exam."
        )
    } else if is_freeflow {
        String::from("This is FREE-FLOW practice: the learner is speaking freely about whatever they choose, without a set prompt. Focus on grammar, vocabulary and register. Also assess coherence and substance: was the speech logically connected and meaningful (even if brief), or was it rambling/incoherent/gibberish? Note this honestly but kindly in the explanation. The follow-up should ask an open question about what they actually said.")
    } else {
        format!("This is CASUAL practice: prioritise natural, idiomatic spoken {language}; note formality differences but do not insist on them.")
    };

    let system = [
        format!("You are a patient {language} speaking coach for a {translation_target}-speaking learner. The user message gives their level, the kind of practice and the prompt they answered."),
        format!("Analyse the spoken {language} transcript they produced and respond with JSON matching this schema:"),
        schema(language, translation_target),
        rules(language, translation_target),
        explanation_rules(language, translation_target),
    ]
    .join("\n\n");

    let prompt_line = if is_freeflow {
        String::from("They were speaking freely — no specific prompt was given. Evaluate grammar, vocabulary and coherence/substance.")
    } else {
        format!("They were given this prompt: \"{prompt}\".")
    };

    let mut user_lines = vec![
        format!(
            "The learner is at CEFR level {level}{}.",
            level_note(language, level)
        ),
        tone,
        prompt_line,
        String::new(),
    ];
    if let Some(part) = part {
        user_lines.push(String::new());
        user_lines.push(part_note(part));
    }
    user_lines.push(String::new());
    user_lines.push(String::from("Transcript of the learner speaking:"));
    user_lines.push(String::from("\"\"\""));
    user_lines.push(transcript.trim().to_owned());
    user_lines.push(String::from("\"\"\""));

    vec![
        ChatMessage {
            role: String::from("system"),
            content: system,
        },
        ChatMessage {
            role: String::from("user"),
            content: user_lines.join("\n"),
        },
    ]
}

/// Whether a value is one of the correction categories.
pub fn is_category(value: &str) -> bool {
    matches!(value, "grammar" | "register" | "filler" | "style")
}

/// Whether a value is one of the correction severities.
pub fn is_severity(value: &str) -> bool {
    matches!(value, "error" | "warning" | "suggestion")
}

/// Whether a value is one of the exam statuses.
pub fn is_exam_status(value: &str) -> bool {
    matches!(
        value,
        "strictly-avoid" | "avoid" | "use-sparingly" | "allowed"
    )
}
