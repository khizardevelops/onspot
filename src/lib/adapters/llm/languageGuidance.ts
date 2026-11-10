// SPDX-License-Identifier: AGPL-3.0-or-later

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

const PERSIAN_EVALUATION = `Persian-specific rules:
- Persian is written right-to-left in the Perso-Arabic script. Keep the transcript and every correction in Persian script; never romanise, transliterate or switch to Arabic. Preserve the zero-width non-joiner (U+200C, نیم‌فاصله) inside compounds such as می‌خواهم and کتاب‌ها unless the correction itself changes the word. Use Persian punctuation (، ؛ ؟) and Persian ی/ک in corrections.
- Do not treat speech-recognition artefacts (missing diacritics, spacing around the ZWNJ, punctuation) as learner errors.
- Grammar focus: verb endings and person, tense/aspect, the را object marker, ezafe, plural/possessive forms, compound verbs (e.g. تصمیم گرفتن / تصمیم کردن), می/نمی prefixes and prepositions.
- Register: EXAM mode expects formal Persian (می‌خواهم، نمی‌توانم، شما); CASUAL mode accepts natural colloquial Tehrani forms (می‌خوام، نمی‌تونم، تو). Flag mixing registers, and do not make casual speech stiff unless exam mode calls for it.
- Fillers: خب، یعنی، دیگه، آخه، راستش are "filler". Suggest one natural hesitation device instead of repeated fillers.
- Connectors: prefer spoken connectors that match the mode (exam: بنابراین، همچنین، سپس، اما، زیرا; casual: ولی، چون، بعد، خب). Avoid written-only constructions.
- For a formal alternative, give the Persian form a learner can actually say in the requested register, not an Arabic-heavy construction.`;

const PERSIAN_TRANSLATION = `Persian translation rules:
- Persian is right-to-left and verb-final (SOV). Literal keeps the Persian clause order, ezafe links and verb-final structure where ${'${translationTarget}'} grammar allows.
- Word-for-word follows the Persian token order exactly. Render grammatical markers as bracketed functions: را [object marker], ezafe [of/link], به [to], از [from], در [in], با [with], برای [for], که [that]. Keep compound verbs as one token with their meaning, e.g. تصمیم گرفتم "decided".
- "wordBreakdown" (when requested): "source" is the exact Persian token or meaningful unit; "target" starts with its plain ${'${translationTarget}'} gloss, e.g. { "source": "بازار", "target": "market" }. Do not romanise unless the learner's instruction language is Latin-script and a reading is genuinely needed.
- Preserve Persian names and ZWNJ exactly.

Required contrastive example:
Persian: "دیروز با دوستم به بازار رفتم و کمی میوه خریدم."
Idiomatic: "Yesterday I went to the market with my friend and bought some fruit."
Literal: "Yesterday with my friend to the market I went and a little fruit I bought."
Word-for-word: "Yesterday friend-with to market went-I and little fruit bought-I."`;

function fill(template: string, translationTarget: string): string {
	return template.replaceAll('${translationTarget}', translationTarget);
}

/** Extra rules for the evaluation prompt, or '' when the language needs none. */
export function evaluationGuidance(language: string, translationTarget: string): string {
	const name = language.toLowerCase();
	if (name === 'japanese') return fill(JAPANESE_EVALUATION, translationTarget);
	if (name === 'persian') return fill(PERSIAN_EVALUATION, translationTarget);
	return '';
}

/** Extra translation rules (incl. a contrastive example), or '' when none. */
export function translationGuidance(language: string, translationTarget: string): string {
	const name = language.toLowerCase();
	if (name === 'japanese') return fill(JAPANESE_TRANSLATION, translationTarget);
	if (name === 'persian') return fill(PERSIAN_TRANSLATION, translationTarget);
	return '';
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
