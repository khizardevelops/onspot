/**
 * Language-specific additions to the shared evaluation and translation
 * prompts. The shared rules are written for any language; these cover what a
 * language's script or grammar needs on top. Keyed by the registry's English
 * language name (`LanguageDefinition.name`), which is what the prompts carry.
 */

const JAPANESE_EVALUATION = `Japanese-specific rules:
- The transcript is written in kanji and kana with no spaces between words. Keep it that way: never insert spaces, never romanize it, and copy "original" character-for-character, including full-width punctuation (、。？！).
- Speech recognition picks the kanji/kana spelling, not the learner. Do not correct kanji-vs-kana choices, okurigana or punctuation unless the chosen word changes the meaning.
- Grammar errors: particles (は/が, に/で, を), verb and adjective conjugation (te-form, past, negative, potential), wrong counters, and mixing plain and polite forms within one sentence.
- Register: EXAM mode expects consistent polite です/ます forms and no casual contractions (e.g. じゃない → ではありません, って → と, ちゃう → てしまう); flag casual forms as "register". CASUAL mode accepts plain forms; only flag inconsistency or rudeness.
- Fillers: えーと, あの(ー), まあ, なんか, その(ー) are "filler". Suggest one natural hesitation device instead of repeated fillers.
- Connectors: prefer spoken connectors that match the mode (exam: そして, それから, しかし, ですから; casual: で, でも, だから). Avoid written-only ones such as 故に or しかしながら.
- Whenever a replacement, suggestion or connector contains kanji, add its reading for a beginner in the ${'${translationTarget}'} explanation or "why" field as kana plus romaji, e.g. 駅 (えき, eki).`;

const JAPANESE_TRANSLATION = `Japanese translation rules:
- Literal: keep the Japanese information order where ${'${translationTarget}'} grammar allows (time → topic → place → object → verb), and keep politeness-driven phrasing visible.
- Word-for-word: follow the Japanese token order exactly (subject–object–verb). Render particles as bracketed functions: は [topic], が [subject], を [object], に [to/at], で [at/by], の ['s/of], と [with/and], へ [toward], も [also], か [question]. Keep conjugated verbs as one token with their meaning, e.g. 食べました "ate (polite)".
- "wordBreakdown" (when requested): "source" is the Japanese token exactly as written; "target" starts with its romaji in parentheses, then the gloss, e.g. { "source": "駅", "target": "(eki) station" }, { "source": "を", "target": "(o) [object marker]" }.

Required contrastive example:
Japanese: "昨日、友達と駅の近くでラーメンを食べました。"
Idiomatic: "Yesterday I had ramen with a friend near the station."
Literal: "Yesterday, with a friend, at near the station, I ate ramen."
Word-for-word: "Yesterday, friend [with] station ['s] near [at] ramen [object] ate (polite)."`;

function fill(template: string, translationTarget: string): string {
	return template.replaceAll('${translationTarget}', translationTarget);
}

/** Extra rules for the evaluation prompt, or '' when the language needs none. */
export function evaluationGuidance(language: string, translationTarget: string): string {
	return language.toLowerCase() === 'japanese' ? fill(JAPANESE_EVALUATION, translationTarget) : '';
}

/** Extra translation rules (incl. a contrastive example), or '' when none. */
export function translationGuidance(language: string, translationTarget: string): string {
	return language.toLowerCase() === 'japanese' ? fill(JAPANESE_TRANSLATION, translationTarget) : '';
}

/**
 * How the learner's level should be read. CEFR levels are stored for every
 * language; Japanese learners and teachers usually think in JLPT levels.
 */
export function levelNote(language: string, level: string): string {
	if (language.toLowerCase() !== 'japanese') return '';
	const jlpt: Record<string, string> = { A1: 'N5', A2: 'N4', B1: 'N3', B2: 'N2', C1: 'N1', C2: 'N1+' };
	return jlpt[level] ? ` (roughly JLPT ${jlpt[level]})` : '';
}
