// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sample session Settings → Text size's live preview shows on the
 * practice screen: a short take (a sentence, which reads large) and a long
 * one (well past the length at which a take's text reaches its smallest
 * size, on every layout), so both take lengths' sizes are on screen. Each has
 * every text a card can show: a mistake, the correct version, an
 * explanation, a follow-up question with its translation, all three
 * translations with an alternative, and a word list. French, the language
 * onspot teaches first; the English is what the learner reads.
 *
 * The session is not live (see `stores/practiceSession.ts`): it lives in
 * memory only, and the screen does no real work for it.
 */
import { writable } from 'svelte/store';
import { TRANSLATION_SET_VERSION, type Correction } from '#lib/adapters/db/index.js';
import type { AttemptView, PracticeState } from '#lib/stores/practice.js';
import type { PracticeSession } from '#lib/stores/practiceSession.js';
import type { TakeLength } from '#lib/stores/textSize.svelte.js';

/** A mistake in a sample take, found in its transcript by its words. */
interface SampleMistake {
	label: string;
	original: string;
	replacement: string;
	replacementTranslation: string;
	explanation: string;
}

interface SampleTake {
	durationSec: number;
	transcript: string;
	mistakes: SampleMistake[];
	explanation: string;
	followUp: { question: string; translation: string };
	idiomatic: string;
	idiomaticVariant: string;
	literal: string;
	wordForWord: string;
	words: Array<[source: string, target: string]>;
}

const SHORT_TAKE: SampleTake = {
	durationSec: 6,
	transcript: "Samedi dernier, j'ai allé au marché avec ma sœur et on a acheté des fraises.",
	mistakes: [
		{
			label: 'Auxiliary with « aller »',
			original: "j'ai allé",
			replacement: 'je suis allé',
			replacementTranslation: 'I went',
			explanation: '« Aller » is a verb of movement: it takes « être » in the passé composé.'
		}
	],
	explanation:
		"Nice and clear! You said <wrong>j'ai allé</wrong>, but <key>aller</key> takes <key>être</key>: <right>je suis allé</right>.",
	followUp: {
		question: "Qu'est-ce que vous avez préparé avec ces fraises ?",
		translation: 'What did you make with those strawberries?'
	},
	idiomatic: 'Last Saturday I went to the market with my sister, and we bought some strawberries.',
	idiomaticVariant: 'My sister and I went to the market last Saturday and picked up some strawberries.',
	literal: 'Saturday last, I went to the market with my sister and one bought some strawberries.',
	wordForWord: 'Saturday last, I am gone to-the market with my sister and one has bought of-the strawberries.',
	words: [
		['samedi', 'Saturday'],
		['dernier', 'last'],
		['je suis allé', 'I went'],
		['au marché', 'to the market'],
		['avec', 'with'],
		['ma sœur', 'my sister'],
		['on a acheté', 'we bought'],
		['des fraises', 'some strawberries']
	]
};

const LONG_TAKE: SampleTake = {
	durationSec: 94,
	transcript:
		"L'été dernier, je suis parti à Lyon avec deux amis de l'université pour une semaine. Le premier jour, on a visité le Vieux Lyon et on a mangé dans un bouchon très traditionnel, où j'ai goûté des quenelles pour la première fois. C'était délicieux, mais un peu lourd pour le déjeuner. Le lendemain, nous avons monté à la colline de Fourvière à pied, parce que mon ami voulait faire du sport, et la vue sur la ville était magnifique. Après, on est descendus vers la Saône et on s'est promenés le long des quais jusqu'au soir. Le mercredi, il a plu toute la journée, donc on est allés au musée des Confluences, qui est très moderne et plein de choses intéressantes sur l'histoire des humains. Je me souviens que j'ai passé une heure devant les squelettes de dinosaures. Le jeudi, on a loué des vélos pour traverser le parc de la Tête d'Or, et on a vu des girafes dans le petit zoo gratuit. Le soir, nous avons dîné chez une amie de ma mère, qui habite à la Croix-Rousse depuis vingt ans. Elle nous a raconté beaucoup des histoires sur les canuts et les traboules. C'était un voyage vraiment inoubliable, et je veux y retourner l'année prochaine.",
	mistakes: [
		{
			label: '« Monter » as movement',
			original: 'nous avons monté à la colline',
			replacement: 'nous sommes montés sur la colline',
			replacementTranslation: 'we went up the hill',
			explanation: 'Going up somewhere is movement, so « monter » takes « être » and agrees: « nous sommes montés ».'
		},
		{
			label: 'Quantity: « beaucoup de »',
			original: 'beaucoup des histoires',
			replacement: "beaucoup d'histoires",
			replacementTranslation: 'lots of stories',
			explanation: 'After « beaucoup », use « de » alone, never « des ».'
		}
	],
	explanation:
		'What a lively week in Lyon! Two things to fix. When <key>monter</key> means going up somewhere, use <key>être</key>: <right>nous sommes montés</right>, not <wrong>nous avons monté</wrong>. After <key>beaucoup</key> it is just <key>de</key>: <right>beaucoup d\'histoires</right>. Your linking words (<key>le lendemain</key>, <key>après</key>, <key>donc</key>) made the story easy to follow.',
	followUp: {
		question: "Qu'est-ce qui vous a le plus surpris dans la cuisine lyonnaise ?",
		translation: 'What surprised you most about the food in Lyon?'
	},
	idiomatic:
		'Last summer I went to Lyon for a week with two friends from university. On the first day we explored Old Lyon and ate in a very traditional bouchon, where I tried quenelles for the first time. They were delicious, if a little heavy for lunch.',
	idiomaticVariant: 'Last summer two university friends and I spent a week in Lyon.',
	literal:
		'The summer last, I left for Lyon with two friends of the university for one week. The first day, we visited Old Lyon and we ate in a very traditional bouchon, where I tasted quenelles for the first time.',
	wordForWord:
		'The summer last, I am left to Lyon with two friends of the-university for one week. The first day, one has visited the Old Lyon.',
	words: [
		["l'été", 'the summer'],
		['dernier', 'last'],
		['je suis parti', 'I left'],
		['avec', 'with'],
		['deux amis', 'two friends'],
		['une semaine', 'a week'],
		['le premier jour', 'the first day'],
		['on a visité', 'we visited'],
		['un bouchon', 'a Lyon bistro'],
		["j'ai goûté", 'I tasted'],
		['délicieux', 'delicious'],
		['un peu lourd', 'a little heavy']
	]
};

const SAMPLE_TAKES: Record<TakeLength, SampleTake> = { short: SHORT_TAKE, long: LONG_TAKE };

/** The take's text with its mistakes put right. */
function correctedText(take: SampleTake): string {
	return take.mistakes.reduce((text, mistake) => text.replace(mistake.original, mistake.replacement), take.transcript);
}

function sampleCorrections(take: SampleTake, attemptId: string, createdAt: string): Correction[] {
	return take.mistakes.map((mistake, position) => {
		const start = take.transcript.indexOf(mistake.original);
		return {
			id: `${attemptId}-correction-${position}`,
			attemptId,
			category: 'grammar',
			severity: 'error',
			label: mistake.label,
			original: mistake.original,
			replacement: mistake.replacement,
			replacementTranslation: mistake.replacementTranslation,
			start: start === -1 ? null : start,
			end: start === -1 ? null : start + mistake.original.length,
			explanation: mistake.explanation,
			speakText: null,
			examStatus: null,
			formalAlternatives: [],
			sortOrder: position,
			createdAt
		};
	});
}

/**
 * A sample take as the card shows a real one.
 *
 * @param length Which sample: a short take or a long one.
 * @param instructionLanguage The learner's language of instruction: the translations count as written in it, so the card shows them.
 */
function sampleAttempt(length: TakeLength, instructionLanguage: string): AttemptView {
	const take = SAMPLE_TAKES[length];
	const id = `text-size-sample-${length}`;
	const createdAt = new Date(0).toISOString();
	const corrected = correctedText(take);
	return {
		id,
		transcript: take.transcript,
		correctedText: corrected,
		translation: take.idiomatic,
		translations: {
			version: TRANSLATION_SET_VERSION,
			instructionLanguage,
			idiomatic: take.idiomatic,
			idiomaticVariants: [take.idiomaticVariant],
			literal: take.literal,
			wordForWord: take.wordForWord,
			wordBreakdown: take.words.map(([source, target]) => ({ source, target }))
		},
		explanation: take.explanation,
		followUp: take.followUp,
		wordGlosses: {},
		corrections: sampleCorrections(take, id, createdAt),
		durationSec: take.durationSec,
		wordCount: take.transcript.split(/\s+/).length,
		createdAt,
		audioUrl: null,
		ttsVoice: null
	};
}

/** The bar's prompt, which the long take answers. */
const SAMPLE_PROMPT = {
	id: 'text-size-sample-prompt',
	title: 'A trip to Lyon (sample)',
	text: 'Tell me about a trip you enjoyed: where you went and what you did there.'
};

/**
 * A sample session for the practice screen: the short take first, the long
 * take on top.
 *
 * @param instructionLanguage The learner's language of instruction (see `sampleAttempt`).
 */
export function sampleSession(instructionLanguage: string): PracticeSession {
	const attempts = [sampleAttempt('short', instructionLanguage), sampleAttempt('long', instructionLanguage)];
	const state = writable<PracticeState>({
		phase: 'idle',
		prompt: SAMPLE_PROMPT,
		mode: 'casual',
		elapsed: 0,
		level: 0,
		progress: null,
		statusText: '',
		error: null,
		sessionId: 'text-size-sample-session',
		attempts,
		activeAttemptId: attempts[attempts.length - 1].id
	});
	return {
		state: { subscribe: state.subscribe },
		live: false,
		setActiveAttempt: (id) => state.update((current) => ({ ...current, activeAttemptId: id }))
	};
}
