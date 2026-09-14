<script lang="ts">
	import MockAttemptStream from './components/MockAttemptStream.svelte';
	import MockFeedbackPanel from './components/MockFeedbackPanel.svelte';
	import type { MockAttempt, MockTranslationSet } from './components/MockAttemptCard.svelte';

	/**
	 * UI sandbox: a standalone, 1:1 interactive reconstruction of the
	 * chat-history UI from self-contained Mock components.
	 *
	 * This route imports nothing from the product: no stores, no database, no
	 * audio service, no LLM. The attempts below are a hardcoded, realistic live
	 * session (a target-language proverb, literal / idiomatic / word-for-word
	 * translations, idiomatic variants and inline grammar corrections). Card
	 * selection, translation toggles, tooltips and correction linking are all
	 * interactive; only the external backends are simulated locally.
	 *
	 * Used by `npm run bundle:ui` to feed the isolated UI to an external AI for
	 * UX/UI refactoring. Not linked from the product nav.
	 */

	const CREATED = {
		first: '2026-09-14T08:02:00.000Z',
		second: '2026-09-14T08:09:30.000Z',
		third: '2026-09-14T08:17:45.000Z',
		fourth: '2026-09-14T08:26:10.000Z'
	};

	function translation(set: MockTranslationSet): MockTranslationSet {
		return { version: 2, ...set };
	}

	const sandboxAttempts: MockAttempt[] = [
		{
			id: 'sandbox-attempt-1',
			transcript:
				"Mon proverbe préféré est « Petit à petit, l'oiseau fait son nid ». Ça veut dire qu'il faut être patient, que les petites actions s'accumulent avec le temps. Et je pense que c'est vrai dans la vie de tous les jours.",
			correctedText:
				"Mon proverbe préféré est « Petit à petit, l'oiseau fait son nid ». Cela signifie qu'il faut être patient : les petites actions s'accumulent avec le temps. De plus, je pense que c'est vrai dans la vie de tous les jours.",
			naturalSpeech:
				"Mon proverbe préféré est « Petit à petit, l'oiseau fait son nid ». Cela signifie qu'il faut être patient : les petites actions s'accumulent avec le temps. De plus, je pense que c'est vrai dans la vie de tous les jours.",
			translation: "My favourite proverb is 'Little by little, the bird builds its nest'.",
			translations: translation({
				idiomatic:
					"My favourite proverb is 'Little by little, the bird builds its nest'. It means you have to be patient: small actions add up over time. What's more, I think that's true in everyday life.",
				idiomaticVariants: [
					"My favourite saying is 'Bit by bit, the bird builds its nest'. It means patience is key — small actions accumulate over time. And I believe that is true in daily life.",
					"My favourite proverb is 'Little by little, the bird makes its nest'. It means we must be patient, since small actions build up over time. I also think it holds true in everyday life."
				],
				literal:
					"My proverb preferred is 'Small to small, the bird makes its nest'. That wants to say that it is necessary to be patient, that the small actions accumulate with the time. And I think that it is true in the life of all the days.",
				wordForWord:
					"My proverb preferred is « Small to small, the bird makes its nest ». That wants to say that it needs to be patient, that the small actions themselves accumulate with the time. And I think that it is true in the life of all the days.",
				wordBreakdown: [
					{ source: 'Petit', target: 'little' },
					{ source: 'à', target: 'by' },
					{ source: 'petit', target: 'little' },
					{ source: "l'oiseau", target: 'the bird' },
					{ source: 'fait', target: 'makes' },
					{ source: 'son', target: 'its' },
					{ source: 'nid', target: 'nest' },
					{ source: "s'accumulent", target: 'themselves accumulate' },
					{ source: 'avec le temps', target: 'with the time' }
				]
			}),
			summary:
				'Rich, idiomatic answer with a real proverb. Main upgrade: split the overloaded "que… que" explanation and replace the flat connector "Et" with a discourse marker.',
			corrections: [
				{
					id: 'sandbox-corr-1-1',
					attemptId: 'sandbox-attempt-1',
					category: 'style',
					severity: 'suggestion',
					label: 'Vocabulary upgrade',
					original: 'Ça veut dire',
					replacement: 'Cela signifie',
					replacementTranslation: 'That means',
					explanation:
						'"Ça veut dire" is fine in speech but flat in a formal answer. "Cela signifie" is the neutral written equivalent.',
					speakText: 'Cela signifie que les petites actions s\'accumulent avec le temps.',
					examStatus: 'allowed',
					formalAlternatives: ['Cela veut dire', 'Autrement dit'],
					sortOrder: 0,
					createdAt: CREATED.first
				},
				{
					id: 'sandbox-corr-1-2',
					attemptId: 'sandbox-attempt-1',
					category: 'grammar',
					severity: 'warning',
					label: 'Que-clause overload',
					original: 'patient, que les petites actions',
					replacement: 'patient : les petites actions',
					replacementTranslation: 'patient: small actions',
					explanation:
						'Two que-clauses chained after "il faut être patient" read as a run-on. A colon separates the explanation cleanly.',
					speakText:
						"Il faut être patient : les petites actions s'accumulent avec le temps.",
					examStatus: 'avoid',
					formalAlternatives: ['patient, car les petites actions', 'patient ; en effet, les actions'],
					sortOrder: 1,
					createdAt: CREATED.first
				},
				{
					id: 'sandbox-corr-1-3',
					attemptId: 'sandbox-attempt-1',
					category: 'register',
					severity: 'suggestion',
					label: 'Connector',
					original: 'Et je pense',
					replacement: 'De plus, je pense',
					replacementTranslation: 'What is more, I think',
					explanation:
						'"Et" is a weak opener. "De plus" signals an added point and sounds more considered.',
					speakText: 'De plus, je pense que c\'est vrai dans la vie de tous les jours.',
					examStatus: 'use-sparingly',
					formalAlternatives: ['En outre', 'Par ailleurs'],
					sortOrder: 2,
					createdAt: CREATED.first
				}
			],
			durationSec: 41.6,
			wordCount: 47,
			createdAt: CREATED.first,
			audioUrl: null,
			ttsVoice: 'piper-tom-medium'
		},
		{
			id: 'sandbox-attempt-2',
			transcript:
				"Hier, je suis allé au marché et j'ai acheter des légumes pour faire une ratatouille. J'ai vue une belle exposition de photos, mais il y a beaucoup de monde et c'était très sympa.",
			correctedText:
				"Hier, je suis allé au marché et j'ai acheté des légumes pour faire une ratatouille. J'ai vu une belle exposition de photos, mais il y avait beaucoup de monde et c'était très agréable.",
			naturalSpeech:
				"Hier, je suis allé au marché et j'ai acheté des légumes pour faire une ratatouille. J'ai vu une belle exposition de photos, mais il y avait beaucoup de monde et c'était très agréable.",
			translation:
				'Yesterday I went to the market and bought some vegetables to make a ratatouille.',
			translations: translation({
				idiomatic:
					'Yesterday I went to the market and bought some vegetables to make a ratatouille. I saw a lovely photo exhibition, but there were a lot of people and it was really pleasant.',
				idiomaticVariants: [
					'Yesterday I went to the market and picked up some vegetables for a ratatouille. I saw a beautiful photography exhibition; it was crowded, but really enjoyable.',
					'Yesterday, I went to the market and bought vegetables to make a ratatouille. I saw a lovely exhibition of photographs — lots of people, but a very nice time.'
				],
				literal:
					'Yesterday, I went to the market and I have bought vegetables for to make a ratatouille. I saw a beautiful exhibition of photos, but there is a lot of people and it was very agreeable.',
				wordForWord:
					'Yesterday, I am gone to-the market and I have to-buy of-the vegetables for to-make a ratatouille. I have seen a beautiful exposition of photos, but it there has many of world and it was very nice.',
				wordBreakdown: [
					{ source: 'Hier', target: 'Yesterday' },
					{ source: "j'ai acheter", target: 'I have to-buy' },
					{ source: 'des légumes', target: 'of-the vegetables' },
					{ source: 'une ratatouille', target: 'a ratatouille' },
					{ source: "J'ai vue", target: 'I have seen' },
					{ source: 'beaucoup de monde', target: 'many of world' },
					{ source: 'très sympa', target: 'very nice' }
				]
			}),
			summary:
				'Clear narrative, but three agreement/tense slips and one register downgrade. Fix the past participles first — they are the errors an examiner notices fastest.',
			corrections: [
				{
					id: 'sandbox-corr-2-1',
					attemptId: 'sandbox-attempt-2',
					category: 'grammar',
					severity: 'error',
					label: 'Participe passé',
					original: "j'ai acheter",
					replacement: "j'ai acheté",
					replacementTranslation: 'I bought',
					explanation:
						'After the auxiliary "avoir", the past participle is "acheté" (not the infinitive "acheter").',
					speakText: "J'ai acheté des légumes au marché.",
					examStatus: 'strictly-avoid',
					formalAlternatives: ["je me suis procuré", "j'ai acquis"],
					sortOrder: 0,
					createdAt: CREATED.second
				},
				{
					id: 'sandbox-corr-2-2',
					attemptId: 'sandbox-attempt-2',
					category: 'grammar',
					severity: 'error',
					label: 'Participe passé',
					original: "J'ai vue",
					replacement: "J'ai vu",
					replacementTranslation: 'I saw',
					explanation:
						'With "avoir", the participle does not agree with the subject, so it stays "vu".',
					speakText: "J'ai vu une belle exposition de photos.",
					examStatus: 'strictly-avoid',
					formalAlternatives: ["J'ai aperçu", "J'ai remarqué"],
					sortOrder: 1,
					createdAt: CREATED.second
				},
				{
					id: 'sandbox-corr-2-3',
					attemptId: 'sandbox-attempt-2',
					category: 'grammar',
					severity: 'warning',
					label: 'Concordance des temps',
					original: 'il y a beaucoup de monde',
					replacement: 'il y avait beaucoup de monde',
					replacementTranslation: 'there were a lot of people',
					explanation:
						'The rest of the anecdote is in the past, so the present "il y a" breaks the timeline.',
					speakText: 'Il y avait beaucoup de monde.',
					examStatus: 'avoid',
					formalAlternatives: ['la foule était dense', 'il y avait foule'],
					sortOrder: 2,
					createdAt: CREATED.second
				},
				{
					id: 'sandbox-corr-2-4',
					attemptId: 'sandbox-attempt-2',
					category: 'register',
					severity: 'warning',
					label: 'Register',
					original: 'très sympa',
					replacement: 'très agréable',
					replacementTranslation: 'very pleasant',
					explanation:
						'"Sympa" is familiar. In an exam answer "agréable" or "convivial" keeps the same warmth at the right register.',
					speakText: "C'était très agréable.",
					examStatus: 'use-sparingly',
					formalAlternatives: ['fort plaisant', 'convivial'],
					sortOrder: 3,
					createdAt: CREATED.second
				}
			],
			durationSec: 34.2,
			wordCount: 38,
			createdAt: CREATED.second,
			audioUrl: null,
			ttsVoice: 'piper-tom-medium'
		},
		{
			id: 'sandbox-attempt-3',
			transcript:
				"Alors, euh, je pense que, bah, l'école est importante parce que ça aide les enfants à grandir. En fait, euh, il faut plus de professeurs et des classes plus petites.",
			correctedText:
				"Je pense que l'école est importante parce qu'elle aide les enfants à grandir. En fait, il faudrait plus de professeurs et des classes plus petites.",
			naturalSpeech:
				"Je pense que l'école est importante parce qu'elle aide les enfants à grandir. En fait, il faudrait plus de professeurs et des classes plus petites.",
			translation:
				'I think school is important because it helps children grow. In fact, we need more teachers and smaller classes.',
			translations: translation({
				idiomatic:
					'I think school is important because it helps children grow. In fact, we need more teachers and smaller classes.',
				idiomaticVariants: [
					'School matters because it helps children grow. Actually, we need more teachers and smaller classes.',
					'I believe school is important, since it helps children to grow. As a matter of fact, there should be more teachers and smaller classes.'
				],
				literal:
					'I think that school is important because that it helps the children to grow. In fact, it needs more of teachers and of classes more small.',
				wordForWord:
					'I think that, school is important because that it helps the children to grow. In fact, it needs more of professors and of classes more small.',
				wordBreakdown: [
					{ source: 'Alors', target: 'So' },
					{ source: 'euh', target: 'uh' },
					{ source: 'bah', target: 'well' },
					{ source: "l'école", target: 'the school' },
					{ source: 'ça aide', target: 'that helps' },
					{ source: 'il faut', target: 'it needs' },
					{ source: 'plus de professeurs', target: 'more of professors' }
				]
			}),
			summary:
				'Good opinion, buried under fillers and a soft verb. Cut the "euh/bah" and switch "il faut" to "il faudrait" for a suggestion.',
			corrections: [
				{
					id: 'sandbox-corr-3-1',
					attemptId: 'sandbox-attempt-3',
					category: 'filler',
					severity: 'warning',
					label: 'Filler',
					original: 'euh',
					replacement: '(silence)',
					replacementTranslation: 'Remove it',
					explanation:
						'Verbal filler. A short pause carries the same meaning without the hesitation sound.',
					speakText: "Je pense que l'école est importante.",
					examStatus: 'strictly-avoid',
					formalAlternatives: ['(pause)', 'Enfin'],
					sortOrder: 0,
					createdAt: CREATED.third
				},
				{
					id: 'sandbox-corr-3-2',
					attemptId: 'sandbox-attempt-3',
					category: 'filler',
					severity: 'warning',
					label: 'Filler',
					original: 'bah',
					replacement: '(silence)',
					replacementTranslation: 'Remove it',
					explanation: '"Bah" is a spoken hedging sound; it adds nothing to the argument.',
					speakText: "Je pense que l'école est importante.",
					examStatus: 'strictly-avoid',
					formalAlternatives: ['(pause)', 'disons'],
					sortOrder: 1,
					createdAt: CREATED.third
				},
				{
					id: 'sandbox-corr-3-3',
					attemptId: 'sandbox-attempt-3',
					category: 'register',
					severity: 'suggestion',
					label: 'Register',
					original: 'parce que ça aide',
					replacement: "parce qu'elle aide",
					replacementTranslation: 'because it helps',
					explanation:
						'"Ça" is casual; a pronoun that agrees with "l\'école" is more precise and formal.',
					speakText: "L'école est importante parce qu'elle aide les enfants à grandir.",
					examStatus: 'use-sparingly',
					formalAlternatives: ['car elle favorise', 'puisqu\'elle contribue à'],
					sortOrder: 2,
					createdAt: CREATED.third
				},
				{
					id: 'sandbox-corr-3-4',
					attemptId: 'sandbox-attempt-3',
					category: 'register',
					severity: 'suggestion',
					label: 'Modality',
					original: 'il faut',
					replacement: 'il faudrait',
					replacementTranslation: 'there should be',
					explanation:
						'The conditional softens a recommendation and is the normal register for proposals.',
					speakText: 'Il faudrait plus de professeurs.',
					examStatus: 'allowed',
					formalAlternatives: ['il conviendrait de', 'il serait souhaitable de'],
					sortOrder: 3,
					createdAt: CREATED.third
				},
				{
					id: 'sandbox-corr-3-5',
					attemptId: 'sandbox-attempt-3',
					category: 'style',
					severity: 'suggestion',
					label: 'Connector',
					original: 'et des classes plus petites',
					replacement: 'ainsi que des classes plus petites',
					replacementTranslation: 'as well as smaller classes',
					explanation:
						'"Et" flattens the list. "Ainsi que" links two demands without repeating the verb.',
					speakText: 'Plus de professeurs, ainsi que des classes plus petites.',
					examStatus: 'allowed',
					formalAlternatives: ['de même que', 'tout comme'],
					sortOrder: 4,
					createdAt: CREATED.third
				}
			],
			durationSec: 29.8,
			wordCount: 33,
			createdAt: CREATED.third,
			audioUrl: null,
			ttsVoice: 'piper-tom-medium'
		},
		{
			id: 'sandbox-attempt-4',
			transcript:
				"Je voudrais parler de l'environnement. Dans mon pays, on doit faire plus pour réduire la pollution. Les gens jettent leurs déchets par terre, c'est nul. On doit changer nos habitudes.",
			correctedText:
				"Je voudrais parler de l'environnement. Dans mon pays, nous devons en faire davantage pour réduire la pollution. Les gens jettent leurs déchets par terre, ce qui est regrettable. Nous devons changer nos habitudes.",
			naturalSpeech:
				"Je voudrais parler de l'environnement. Dans mon pays, nous devons en faire davantage pour réduire la pollution. Les gens jettent leurs déchets par terre, ce qui est regrettable. Nous devons changer nos habitudes.",
			translation:
				'I would like to talk about the environment. In my country, we have to do more to reduce pollution.',
			translations: translation({
				idiomatic:
					"I'd like to talk about the environment. In my country, we need to do more to reduce pollution. People throw their rubbish on the ground, which is a shame. We need to change our habits.",
				idiomaticVariants: [
					'I would like to discuss the environment. In my country, we must do more to cut pollution. People drop their litter on the ground — that is disgraceful. We must change our habits.',
					"I'd like to speak about the environment. Where I live, we have to do more to reduce pollution. People toss their waste on the ground; it's a scandal. We have to change the way we live."
				],
				literal:
					'I would like to speak of the environment. In my country, one must do more for to reduce the pollution. The people throw their waste by earth, it is null. One must change our habits.',
				wordForWord:
					'I would-want to-speak of the environment. In my country, one must to-do more for to-reduce the pollution. The people throw their wastes by ground, it is null. One must to-change our habits.',
				wordBreakdown: [
					{ source: 'Je voudrais', target: 'I would-want' },
					{ source: "jettent", target: 'throw' },
					{ source: 'leurs déchets', target: 'their wastes' },
					{ source: 'par terre', target: 'by ground' },
					{ source: "c'est nul", target: 'it is null' },
					{ source: 'nos habitudes', target: 'our habits' }
				]
			}),
			summary:
				'Strong topic and a clear opinion. The weak points are the impersonal "on", the anglicised "faire plus", and the casual "c\'est nul" — all three read as spoken rather than examined French.',
			corrections: [
				{
					id: 'sandbox-corr-4-1',
					attemptId: 'sandbox-attempt-4',
					category: 'register',
					severity: 'warning',
					label: 'Impersonal on',
					original: 'on doit',
					replacement: 'nous devons',
					replacementTranslation: 'we must',
					explanation:
						'"On" is heard constantly in speech but is marked as informal in an exam. "Nous" makes the position explicit.',
					speakText: 'Dans mon pays, nous devons en faire davantage.',
					examStatus: 'strictly-avoid',
					formalAlternatives: ['il nous faut', 'nous sommes tenus de'],
					sortOrder: 0,
					createdAt: CREATED.fourth
				},
				{
					id: 'sandbox-corr-4-2',
					attemptId: 'sandbox-attempt-4',
					category: 'style',
					severity: 'suggestion',
					label: 'Vocabulary upgrade',
					original: 'faire plus',
					replacement: 'en faire davantage',
					replacementTranslation: 'do more',
					explanation:
						'"Faire plus" is a calque of "do more". "En faire davantage" is the idiomatic French collocation.',
					speakText: 'Nous devons en faire davantage pour réduire la pollution.',
					examStatus: 'allowed',
					formalAlternatives: ['redoubler d\'efforts', 'accentuer nos efforts'],
					sortOrder: 1,
					createdAt: CREATED.fourth
				},
				{
					id: 'sandbox-corr-4-3',
					attemptId: 'sandbox-attempt-4',
					category: 'register',
					severity: 'error',
					label: 'Register',
					original: "c'est nul",
					replacement: 'ce qui est regrettable',
					replacementTranslation: 'which is regrettable',
					explanation:
						'"C\'est nul" is slang and self-standing. Replacing it with a relative clause keeps the sentence flowing and formal.',
					speakText: 'Les gens jettent leurs déchets par terre, ce qui est regrettable.',
					examStatus: 'strictly-avoid',
					formalAlternatives: ['ce qui est déplorable', 'ce qui est inacceptable'],
					sortOrder: 2,
					createdAt: CREATED.fourth
				},
				{
					id: 'sandbox-corr-4-4',
					attemptId: 'sandbox-attempt-4',
					category: 'grammar',
					severity: 'warning',
					label: 'Concordance',
					original: 'changer nos habitudes',
					replacement: 'changer nos habitudes',
					replacementTranslation: 'change our habits',
					explanation:
						'Kept as-is, but note the subject: after "nous devons" the possessive "nos" agrees, whereas with "on" it does not.',
					speakText: 'Nous devons changer nos habitudes.',
					examStatus: 'allowed',
					formalAlternatives: ['modifier nos comportements', 'adopter de nouveaux réflexes'],
					sortOrder: 3,
					createdAt: CREATED.fourth
				}
			],
			durationSec: 38.4,
			wordCount: 40,
			createdAt: CREATED.fourth,
			audioUrl: null,
			ttsVoice: 'piper-tom-medium'
		}
	];

	let activeAttemptId = $state<string | null>(sandboxAttempts.at(-1)?.id ?? null);
	let activeCorrectionId = $state<string | null>(null);

	const active = $derived(
		sandboxAttempts.find((attempt) => attempt.id === activeAttemptId) ?? null
	);

	/** Clicking a correction in the feedback panel toggles its transcript mark. */
	function toggleCorrection(correctionId: string) {
		activeCorrectionId = activeCorrectionId === correctionId ? null : correctionId;
	}
</script>

<svelte:head><title>UI Sandbox · onspot</title></svelte:head>

<div class="grid h-full grid-cols-[minmax(0,1fr)_380px]">
	<section class="flex min-w-0 flex-col overflow-hidden">
		<header class="flex items-center justify-between gap-4 border-b px-8 py-4">
			<div class="min-w-0">
				<h1 class="truncate font-serif text-lg font-medium">UI sandbox · chat history</h1>
				<p class="truncate text-xs text-muted-foreground">
					Interactive clone · click cards, toggles, tooltips and corrections
				</p>
			</div>
			<span
				class="rounded-md bg-[var(--brand-soft)] px-2 py-1 text-[10px] font-semibold tracking-widest text-[var(--brand)] uppercase"
			>
				Standalone
			</span>
		</header>

		<div class="relative min-h-0 flex-1">
			<MockAttemptStream attempts={sandboxAttempts} bind:activeAttemptId bind:activeCorrectionId />
		</div>
	</section>

	<MockFeedbackPanel
		attempts={sandboxAttempts}
		{active}
		{activeCorrectionId}
		onToggleCorrection={toggleCorrection}
	/>
</div>
