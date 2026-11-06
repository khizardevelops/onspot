<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { quickCollapse } from '#lib/neo.js';
	import { fade, fly, slide } from 'svelte/transition';
	import type { AttemptTrackKind, AttemptView } from '#lib/stores/practice.js';
	import {
		ensureAttemptTranslations,
		explanationAudioUnavailable,
		playAttemptTrack,
		playRecording,
		playSegment,
		setAttemptVoice,
		speakText,
		ensurePhraseMeaning,
		ensureWordGlosses,
		followUpQuestion,
		translationsCurrent as areTranslationsCurrent,
		wordGlossesFor
	} from '#lib/stores/practice.js';
	import { appSettings } from '#lib/stores/settings.js';
	import { currentTextDevice, textScaleFor, type TakeLength } from '#lib/stores/textSize.svelte.js';
	import { practiceSession } from '#lib/stores/practiceSession.js';
	import { getInstructionLanguage, getLanguage } from '#lib/languages/index.js';
	import { listLocalVoices } from '#lib/speech/tts/service.js';
	import { splitSentences } from '#lib/utils/segments.js';
	import { correctedPassages } from '#lib/utils/correctedPassages.js';
	import { fitFontSize } from '#lib/utils/fitText.js';
	import { layoutLength, sameWords } from '#lib/utils/words.js';
	import { audioActivity, togglePlay } from '#lib/stores/audio.js';
	import Transcript from './Transcript.svelte';
	import CorrectedPassages from './CorrectedPassages.svelte';
	import AttemptTrack from './AttemptTrack.svelte';
	import ExplanationText from './ExplanationText.svelte';
	import AudioBar from './AudioBar.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoPill } from '@dvcol/neo-svelte/pill';
	import {
		Check,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		Ellipsis,
		Languages,
		ListMusic,
		Loader2,
		Pause,
		Play,
		RotateCcw,
		Volume2,
		X
	} from '@lucide/svelte';

	interface Props {
		attempt: AttemptView;
		index: number;
		active: boolean;
		activeCorrectionId?: string | null;
		onSelectCorrection?: (attemptId: string, correctionId: string) => void;
	}

	let { attempt, index, active, activeCorrectionId = null, onSelectCorrection }: Props = $props();
	/*
	 * A take of a sample session (Settings → Text size's live preview) starts
	 * with every text open (all three translations and each word) so each can
	 * be sized, and does no real work: no audio, no provider, no saving; its
	 * words are plain text, without meanings to look up.
	 */
	const live = practiceSession().live;
	const showsEveryText = !live;
	type TranslationView = 'off' | 'idiomatic' | 'literal' | 'wordForWord' | 'all';

	const voices = $derived(listLocalVoices($appSettings.targetLanguage));

	/*
	 * Takes run from a sentence to several minutes of speech. Short takes read
	 * large; longer ones shrink toward the floor so the card keeps its height,
	 * and only past the floor does the card grow taller.
	 */
	const TRANSCRIPT_FIT = {
		min: 15,
		max: 24,
		targetHeight: 190,
		advance: 0.47,
		lineHeight: 1.6
	} as const;
	/*
	 * Narrow cards (phones) get smaller display type and tighter lines: at the
	 * desktop sizes a single sentence filled six lines of a phone screen. The
	 * floor stays at the 15px reading size of the rest of the card.
	 */
	const COMPACT_TRANSCRIPT_FIT = {
		min: 15,
		max: 19,
		targetHeight: 120,
		advance: 0.47,
		lineHeight: 1.45
	} as const;
	const COMPACT_TEXT_WIDTH_PX = 480;
	let transcriptWidth = $state(0);
	const transcriptFit = $derived(
		transcriptWidth > 0 && transcriptWidth < COMPACT_TEXT_WIDTH_PX ? COMPACT_TRANSCRIPT_FIT : TRANSCRIPT_FIT
	);
	const transcriptSize = $derived(
		// Japanese glyphs are about twice as wide as Latin ones.
		fitFontSize(layoutLength(attempt.transcript), transcriptWidth, transcriptFit)
	);
	/**
	 * A take whose text is at the floor of its fit is a long take; the learner
	 * sets the sizes of long and short takes apart (Settings → Text size). The
	 * card says which it is in `data-take-length`, which picks its sizes.
	 */
	const takeLength = $derived<TakeLength>(transcriptSize <= transcriptFit.min ? 'long' : 'short');
	const textVariant = $derived({ device: currentTextDevice(), length: takeLength });

	/*
	 * A long section can be partly open: its first lines, enough to recognise
	 * the take without pushing the explanation screens down. Long takes start
	 * that way; the explanation (played aloud as the card arrives) starts open.
	 */
	const PEEK_TEXT_LINES = 6;
	const PEEK_EXPLANATION_LINES = 5;
	/** The explanation's type: 15px with relaxed leading (keep in step with `.explanation-size` below). */
	const EXPLANATION_FONT_PX = 15;
	const EXPLANATION_LINE_HEIGHT = 1.625;

	/*
	 * Each section reads at the learner's text size for it (Settings → Text
	 * size); a partly open section still shows the same number of lines.
	 */
	function peekHeight(lines: number, fontPx: number, lineHeight: number): number {
		return Math.round(lines * fontPx * lineHeight);
	}
	const saidPeekHeight = $derived(
		peekHeight(PEEK_TEXT_LINES, transcriptSize * textScaleFor('said', textVariant), transcriptFit.lineHeight)
	);
	const correctedPeekHeight = $derived(
		peekHeight(PEEK_TEXT_LINES, transcriptSize * textScaleFor('corrected', textVariant), transcriptFit.lineHeight)
	);
	const explanationPeekHeight = $derived(
		peekHeight(PEEK_EXPLANATION_LINES, EXPLANATION_FONT_PX * textScaleFor('explanation', textVariant), EXPLANATION_LINE_HEIGHT)
	);

	let showSegments = $state(false);
	let rerendering = $state(false);
	let generatingTranslations = $state(false);
	let translationError = $state<string | null>(null);
	let showWordBreakdown = $state(showsEveryText);
	/** Which idiomatic variant is on screen; variants are pages, the primary translation first. */
	let idiomaticPageIndex = $state(0);
	/** Off until the learner picks a translation: nothing is translated (or paid for) unasked. */
	let translationView = $state<TranslationView>(showsEveryText ? 'all' : 'off');

	const language = $derived(getLanguage($appSettings.targetLanguage));
	const languageName = $derived(language?.name ?? 'target language');
	/** The language the learner is taught in: translations, meanings and explanations are in it. */
	const instructionName = $derived(getInstructionLanguage($appSettings.instructionLanguage).name);

	/*
	 * The correct version only gets its own row when it says something
	 * different; a take with nothing to fix says so with a pill instead of
	 * repeating the same sentence.
	 */
	const correctVersionDiffers = $derived(
		Boolean(attempt.correctedText) && !sameWords(attempt.transcript, attempt.correctedText)
	);
	const hasErrors = $derived(attempt.corrections.some((correction) => correction.severity === 'error'));
	const saidCorrectly = $derived(!correctVersionDiffers && !hasErrors);

	/*
	 * "Did you mean to say?" shows only the corrected parts, each in its
	 * sentence, unless the learner asks for the whole text, or the parts are
	 * the whole text anyway.
	 */
	const correctedParts = $derived(correctVersionDiffers ? correctedPassages(attempt.transcript, attempt.correctedText) : null);
	const canShowParts = $derived(Boolean(correctedParts && correctedParts.passages.length > 0 && !correctedParts.coversWholeText));
	let showWholeCorrection = $state(false);
	const showsParts = $derived(canShowParts && !showWholeCorrection);

	/*
	 * With its changes shown (the default), the correct version marks each fix
	 * and strikes through what it replaces or drops; hidden, it is the clean
	 * text to say. Either way, whole or as the fixed parts.
	 */
	let showCorrectionChanges = $state(true);
	const correctionMarks = $derived(
		showCorrectionChanges && correctedParts
			? {
					changedWords: correctedParts.changedWords,
					removedBefore: correctedParts.removedBefore,
					replacedBefore: correctedParts.replacedBefore
				}
			: {}
	);

	const question = $derived(followUpQuestion(attempt));

	/** Hover meanings, selection translations and read-aloud for one of this take's texts (all in the studied language). */
	function meaningsOf(text: string) {
		if (!live) return {};
		return {
			glosses: wordGlossesFor(attempt, text, $appSettings.instructionLanguage),
			requestGlosses: (wordIndex: number) => ensureWordGlosses(attempt.id, text, wordIndex),
			requestPhrase: (start: number, end: number, phrase: string) => ensurePhraseMeaning(attempt.id, text, start, end, phrase),
			speak: (words: string) => void speakText(words)
		};
	}

	const explanationUnavailableReason = $derived($explanationAudioUnavailable);
	const TRANSLATION_OPTIONS = $derived<{ id: TranslationView; label: string; detail: string }[]>([
		{ id: 'idiomatic', label: 'Idiomatic', detail: `Natural ${instructionName} with the same meaning` },
		{ id: 'literal', label: 'Literal', detail: `${instructionName} that follows the ${languageName} structure` },
		{ id: 'wordForWord', label: 'Word-for-word', detail: 'Each word in the original order' },
		{ id: 'all', label: 'Compare all three', detail: 'See the differences side by side' },
		{ id: 'off', label: 'Hide translation', detail: `Keep the focus on your ${languageName}` }
	]);

	/*
	 * Translations are of the correct version ("Did you mean to say?"), which is
	 * the transcript itself when nothing needed fixing. Sets from older versions
	 * translated the raw transcript, so they are not shown; they are replaced
	 * when a translation is asked for.
	 */
	const translationsCurrent = $derived(areTranslationsCurrent(attempt.translations, $appSettings.instructionLanguage));
	const translations = $derived(
		translationsCurrent
			? {
					idiomatic: attempt.translations?.idiomatic ?? '',
					idiomaticVariants: attempt.translations?.idiomaticVariants ?? [],
					literal: attempt.translations?.literal || '',
					wordForWord: attempt.translations?.wordForWord || '',
					wordBreakdown: attempt.translations?.wordBreakdown ?? []
				}
			: { idiomatic: '', idiomaticVariants: [], literal: '', wordForWord: '', wordBreakdown: [] }
	);

	/** Every rendering of the idiomatic meaning: the primary translation is page 1. */
	const idiomaticPages = $derived([translations.idiomatic, ...translations.idiomaticVariants].filter(Boolean));
	const currentIdiomatic = $derived(idiomaticPages[idiomaticPageIndex] ?? translations.idiomatic);
	$effect(() => {
		// A new translation view or a regenerated set starts on the first variant.
		translationView;
		translations.idiomatic;
		translations.idiomaticVariants;
		idiomaticPageIndex = 0;
	});
	$effect(() => {
		// Never leave the pager on a page a shorter regenerated set no longer has.
		if (idiomaticPageIndex >= idiomaticPages.length) idiomaticPageIndex = 0;
	});

	function stepIdiomaticPage(step: number): void {
		const count = idiomaticPages.length;
		if (count < 2) return;
		idiomaticPageIndex = (idiomaticPageIndex + step + count) % count;
	}

	const translationLabel = $derived.by(() => {
		if (translationView === 'off') return 'Translate';
		if (translationView === 'all') return 'Compare';
		return TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? 'Translate';
	});

	const visibleTranslations = $derived.by(() => {
		if (translationView === 'off') return [];
		if (translationView === 'all') {
			return [
				{ kind: 'idiomatic', label: 'Idiomatic', value: currentIdiomatic, italic: false },
				{ kind: 'literal', label: 'Literal', value: translations.literal, italic: false },
				{ kind: 'wordForWord', label: 'Word-for-word', value: translations.wordForWord, italic: true }
			].filter((entry) => entry.value);
		}
		const value = translationView === 'idiomatic' ? currentIdiomatic : translations[translationView];
		const label = TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? '';
		return value
			? [{ kind: translationView, label, value, italic: translationView === 'wordForWord' }]
			: [];
	});

	/** The word list without lone punctuation ("," → ","), which only takes rows. */
	const vocabulary = $derived(translations.wordBreakdown.filter((item) => /[\p{L}\p{N}]/u.test(item.source)));

	const segments = $derived(splitSentences(attempt.correctedText || attempt.transcript));
	const selectedVoice = $derived(attempt.ttsVoice ?? $appSettings.ttsVoice);

	/* Menu values are namespaced so one onSelect can route every action. */
	const translationItems = $derived<NeoMenuItem[]>([
		{
			value: 'translation-style',
			label: 'Translation style',
			section: true,
			divider: { bottom: true },
			items: TRANSLATION_OPTIONS.map((option) => ({
				value: `view:${option.id}`,
				label: option.label,
				description: option.detail,
				after: optionCheck
			}))
		},
		{ value: 'regenerate', label: 'Regenerate saved translations', before: menuIcon }
	]);

	const actionItems = $derived<NeoMenuItem[]>([
		{ value: 'replay', label: 'Replay your recording', before: menuIcon },
		{ value: 'segments', label: 'Sentence playback', before: menuIcon, after: optionCheck },
		...($appSettings.ttsMode === 'local'
			? [
					{
						value: 'voice',
						label: 'Text-to-speech voice',
						before: menuIcon,
						items: voices.map((voice) => ({ value: `voice:${voice.id}`, label: voice.label, after: optionCheck }))
					}
				]
			: [])
	]);

	function isChecked(value: unknown): boolean {
		const key = String(value);
		if (key === 'segments') return showSegments;
		if (key.startsWith('view:')) return key.slice(5) === translationView;
		if (key.startsWith('voice:')) return key.slice(6) === selectedVoice;
		return false;
	}

	function onMenuSelect(item: NeoMenuItem): void {
		const key = String(item.value);
		if (key === 'regenerate') void regenerateTranslations();
		else if (key === 'replay') {
			if (live) void playRecording(attempt.id);
		}
		else if (key === 'segments') showSegments = !showSegments;
		else if (key.startsWith('view:')) void chooseTranslation(key.slice(5));
		else if (key.startsWith('voice:')) void rerender(key.slice(6));
	}

	function needsGeneration(view: TranslationView): boolean {
		if (view === 'off') return false;
		if (!translationsCurrent) return true;
		if (view === 'all') return !translations.idiomatic || !translations.literal || !translations.wordForWord;
		return !translations[view];
	}

	async function requestTranslations(force: boolean): Promise<boolean> {
		translationError = null;
		if (!live || generatingTranslations) return false;
		generatingTranslations = true;
		try {
			await ensureAttemptTranslations(attempt.id, force);
			return true;
		} catch (error) {
			translationError = error instanceof Error ? error.message : 'Could not generate translations.';
			return false;
		} finally {
			generatingTranslations = false;
		}
	}

	async function chooseTranslation(value: string): Promise<void> {
		const view = value as TranslationView;
		const previous = translationView;
		translationView = view;
		translationError = null;
		if (needsGeneration(view) && !(await requestTranslations(false))) translationView = previous;
	}

	async function regenerateTranslations(): Promise<void> {
		idiomaticPageIndex = 0;
		showWordBreakdown = false;
		await requestTranslations(true);
	}

	async function toggleWordBreakdown(open: boolean): Promise<void> {
		if (!open) {
			showWordBreakdown = false;
			return;
		}
		if (translations.wordBreakdown.length === 0 && !(await requestTranslations(true))) return;
		showWordBreakdown = true;
	}

	function isCurrentTrack(kind: AttemptTrackKind): boolean {
		return $audioActivity.track?.attemptId === attempt.id && $audioActivity.track?.kind === kind;
	}

	function trackPlaying(kind: AttemptTrackKind): boolean {
		return $audioActivity.playing && isCurrentTrack(kind);
	}

	function trackLoading(kind: AttemptTrackKind): boolean {
		return $audioActivity.loading && isCurrentTrack(kind);
	}

	/** Pauses or resumes the track already loaded; otherwise synthesizes and plays it. */
	function toggleTrack(kind: AttemptTrackKind): void {
		if (!live || trackLoading(kind)) return;

		if (isCurrentTrack(kind) && $audioActivity.track?.url) togglePlay();
		else void playAttemptTrack(attempt.id, kind);
	}

	function segmentPlaying(position: number): boolean {
		return Boolean(
			$audioActivity.playing &&
				$audioActivity.track?.attemptId === attempt.id &&
				$audioActivity.track?.kind === 'segment' &&
				$audioActivity.track?.segmentIndex === position
		);
	}

	function toggleSegment(position: number, text: string): void {
		if (!live) return;
		if (segmentPlaying(position)) togglePlay();
		else void playSegment(attempt.id, text, position);
	}

	async function rerender(voice: string): Promise<void> {
		if (!live || !voice || voice === selectedVoice || rerendering) return;
		rerendering = true;
		try {
			await setAttemptVoice(attempt.id, voice);
		} finally {
			rerendering = false;
		}
	}
</script>

{#snippet menuIcon({ item }: { item: { value: unknown } })}
	{#if item.value === 'segments'}<ListMusic size={16} />{:else if item.value === 'voice'}<Volume2 size={16} />{:else}<RotateCcw size={16} />{/if}
{/snippet}

{#snippet optionCheck({ item }: { item: { value: unknown } })}
	<Check size={15} class="menu-check {isChecked(item.value) ? '' : 'invisible'}" aria-hidden="true" />
{/snippet}

<!-- The variant's label-maker tag, wherever its row is headed (note header or its own row). -->
{#snippet translationTag(label: string)}
	<span class="translation-label">{label}</span>
{/snippet}

<!-- The note's right-hand control: variant pager, or the word breakdown's disclosure. -->
{#snippet translationToggle(translation: { kind: string })}
	{#if translation.kind === 'idiomatic' && idiomaticPages.length > 1}
		<div class="variant-controls" role="group" aria-label="Translation variants">
			<NeoButton
				text
				rounded
				class="variant-step"
				aria-label="Previous translation variant"
				title="Previous translation variant"
				onclick={() => stepIdiomaticPage(-1)}
			>
				{#snippet icon()}<ChevronLeft size={14} />{/snippet}
			</NeoButton>
			<span class="variant-count">{idiomaticPageIndex + 1} / {idiomaticPages.length}</span>
			<NeoButton
				text
				rounded
				class="variant-step"
				aria-label="Next translation variant"
				title="Next translation variant"
				onclick={() => stepIdiomaticPage(1)}
			>
				{#snippet icon()}<ChevronRight size={14} />{/snippet}
			</NeoButton>
		</div>
	{:else if translation.kind === 'wordForWord'}
		<button type="button" class="pencil-link" aria-expanded={showWordBreakdown} onclick={() => void toggleWordBreakdown(!showWordBreakdown)}>
			{showWordBreakdown ? 'Hide each word' : 'Each word'}
		</button>
	{/if}
{/snippet}

<!-- An index card: its paper, rules and edges are styled below; the pile adds tape and shadow. -->
<NeoCard
	data-card-surface
	data-take-length={takeLength}
	class="attempt-card relative w-full min-w-0"
	spacing="0"
	width="100%"
	elevation={0}
	hover={0}
	borderless
>
	<div class="index-card-header flex items-center justify-between gap-2 px-4 pt-3 pb-2 sm:px-5 sm:pt-3.5">
		<div class="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
			<NeoPill size="small" rounded elevation={active ? -1 : 1} color={active ? 'primary' : undefined} class="take-pill">Take {index}</NeoPill>
			<span class="text-faint">·</span>
			<span>{attempt.durationSec.toFixed(0)} sec</span>
			<span class="text-faint">·</span>
			<span>{attempt.wordCount} words</span>
		</div>

		<div class="flex shrink-0 items-center gap-1">
			<PopMenu items={translationItems} placement="bottom-end" onSelect={onMenuSelect} rounded>
				<NeoButton
					text={translationView === 'off'}
					rounded
					color={translationView !== 'off' ? 'primary' : undefined}
					class="translate-trigger {translationView !== 'off' ? 'on is-selected' : ''}"
					aria-label="Translation options"
				>
					{#snippet icon()}{#if generatingTranslations}<Loader2 size={14} class="animate-spin" />{:else}<Languages size={14} />{/if}{/snippet}
					<span class="hidden sm:inline">{generatingTranslations ? 'Working…' : translationLabel}</span>
					<ChevronDown size={12} />
				</NeoButton>
			</PopMenu>

			<PopMenu items={actionItems} placement="bottom-end" onSelect={onMenuSelect} rounded>
				<NeoButton text rounded class="card-icon-button" aria-label="More attempt actions">
					{#snippet icon()}<Ellipsis size={16} />{/snippet}
				</NeoButton>
			</PopMenu>
		</div>
	</div>

	<div class="index-card-lines px-4 pt-3 pb-3.5 sm:px-5 sm:pb-4">
		<!-- Measured here, always on screen: a hidden "You said" must not reset the shared text size. -->
		<div class="grid gap-3" bind:clientWidth={transcriptWidth}>
			<AttemptTrack
				label="You said"
				audioName="what you said"
				playing={trackPlaying('said')}
				loading={trackLoading('said')}
				onToggle={() => toggleTrack('said')}
				peekHeight={saidPeekHeight}
				defaultExtent="part"
			>
				{#snippet badge()}
					{#if saidCorrectly}
						<NeoPill size="small" rounded elevation={0} tinted color="success" class="correct-pill"><Check size={11} /> Correct</NeoPill>
					{/if}
				{/snippet}
				<div data-text-section="said" style:font-size={`calc(${transcriptSize}px * var(--text-scale-said, 1))`} style:line-height={transcriptFit.lineHeight}>
					<Transcript
						text={attempt.transcript}
						corrections={attempt.corrections}
						activeCorrectionId={active ? activeCorrectionId : null}
						onSelect={(correctionId) => onSelectCorrection?.(attempt.id, correctionId)}
						{...meaningsOf(attempt.transcript)}
						class="block break-words font-serif [text-wrap:pretty]"
					/>
				</div>
			</AttemptTrack>

			<!-- Only when the correct version says something different (see correctedParts). -->
			{#if correctedParts}
				<AttemptTrack
					label="Did you mean to say?"
					audioName="the correct version"
					playing={trackPlaying('corrected')}
					loading={trackLoading('corrected')}
					onToggle={() => toggleTrack('corrected')}
					peekHeight={correctedPeekHeight}
				>
					{#snippet actions()}
						<button
							type="button"
							class="pencil-link view-toggle"
							aria-label={showCorrectionChanges ? 'Show the clean correct version' : 'Show what changed from what you said'}
							onclick={() => (showCorrectionChanges = !showCorrectionChanges)}
						>
							{showCorrectionChanges ? 'Hide changes' : 'Show changes'}
						</button>
						{#if canShowParts}
							<button
								type="button"
								class="pencil-link view-toggle"
								aria-label={showWholeCorrection ? 'Show the fixes only' : 'Show the whole text'}
								onclick={() => (showWholeCorrection = !showWholeCorrection)}
							>
								{showWholeCorrection ? 'Fixes only' : 'Whole text'}
							</button>
						{/if}
					{/snippet}
					<!-- The transcript's size, so the two read as a pair, times the learner's own size for this section. -->
					<div
						class="font-serif"
						data-text-section="corrected"
						style:font-size={`calc(${transcriptSize}px * var(--text-scale-corrected, 1))`}
						style:line-height={transcriptFit.lineHeight}
					>
						{#if showsParts}
							<CorrectedPassages
								text={attempt.correctedText}
								passages={correctedParts.passages}
								{...correctionMarks}
								{...meaningsOf(attempt.correctedText)}
							/>
						{:else}
							<Transcript
								text={attempt.correctedText}
								{...correctionMarks}
								{...meaningsOf(attempt.correctedText)}
								class="block break-words [text-wrap:pretty]"
							/>
						{/if}
					</div>
				</AttemptTrack>
			{/if}

			{#if attempt.explanation || question}
				<AttemptTrack
					label="Explanation"
					audioName="the explanation"
					playing={trackPlaying('explanation')}
					loading={trackLoading('explanation')}
					unavailableReason={explanationUnavailableReason}
					onToggle={() => toggleTrack('explanation')}
					peekHeight={explanationPeekHeight}
				>
					<div class="explanation-size">
						<ExplanationText
							markup={attempt.explanation}
							{question}
							translation={attempt.followUp?.translation ?? ''}
							targetLocale={language?.locale ?? 'und'}
							instructionLanguage={instructionName}
							followUpAudio={{
								playing: trackPlaying('followUp'),
								loading: trackLoading('followUp'),
								onToggle: () => toggleTrack('followUp')
							}}
							questionMeanings={meaningsOf(question)}
							translationShown={showsEveryText}
							class="leading-relaxed [text-wrap:pretty]"
						/>
					</div>
				</AttemptTrack>
			{/if}
		</div>

		{#if active}
			<div in:slide={{ duration: 170, axis: 'y' }} out:fade={{ duration: 130 }}>
				<AudioBar attemptId={attempt.id} />
			</div>
		{/if}

		{#if translationError}
			<div class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--error-soft)] px-3 py-2" role="alert" in:fly={{ y: 6, duration: 240 }} out:fade={{ duration: 120 }}>
				<p class="text-sm text-[var(--error)]">{translationError}</p>
				<NeoButton rounded class="retry-button" onclick={() => void requestTranslations(true)}>Retry</NeoButton>
			</div>
		{/if}

		{#if translationView !== 'off'}
			<!-- A sticky note stuck on the card: clearly not the take's own text. -->
			<section class="card-translation mt-4 min-w-0" aria-label="Translation" aria-live="polite" in:slide={{ duration: 170 }} out:fade={{ duration: 140 }}>
				<div class="translation-heading">
					<!-- Takes the note off again; the style menu above still brings it back. It leads the
					     header so the variant's own control can sit at the card's far right. -->
					<NeoButton text rounded class="card-icon-button note-close" aria-label="Hide translation" title="Hide translation" onclick={() => void chooseTranslation('off')}>
						{#snippet icon()}<X size={15} />{/snippet}
					</NeoButton>
					<span class="translation-mark grid size-7 shrink-0 place-items-center" aria-hidden="true"><Languages size={14} /></span>
					<p class="eyebrow">Translation</p>
					<!-- One variant: its tag and disclosure share this line, above the text. -->
					{#if visibleTranslations.length === 1}
						{@const only = visibleTranslations[0]}
						{@render translationTag(only.label)}
						<div class="translation-toggle">{@render translationToggle(only)}</div>
					{/if}
				</div>

				{#if generatingTranslations}
					<p class="pencil-note mt-1 flex items-center gap-2"><Loader2 class="size-3.5 animate-spin" /> Writing the translations…</p>
				{:else if visibleTranslations.length === 0}
					<!-- Shown but not (or no longer) translated, e.g. after the language of instruction changed: the learner decides. -->
					<p class="pencil-note mt-1">
						<button type="button" class="pencil-link" onclick={() => void requestTranslations(false)}>Translate into {instructionName}</button>
					</p>
				{:else}
					<!-- One block per variant; with several, each gets its own tag line above its text. -->
					<ul class="translation-rows" data-text-section="translation">
						{#each visibleTranslations as translation (translation.kind)}
							<li class="translation-row">
								{#if visibleTranslations.length > 1}
									<div class="translation-row-head">
										{@render translationTag(translation.label)}
										<div class="translation-toggle">{@render translationToggle(translation)}</div>
									</div>
								{/if}
								<div class="translation-body min-w-0">
									<p class="translation-text" class:word-for-word={translation.italic} dir="auto" aria-live="polite">{#if translation.kind === 'idiomatic' && idiomaticPageIndex > 0}<span class="or-mark">or</span>{/if}{translation.value}</p>
								</div>
								{#if translation.kind === 'wordForWord'}
									<div class="vocab-span">
										<NeoCollapse transition={quickCollapse} open={showWordBreakdown}>
											{#if vocabulary.length > 0}
												<!-- Each pair is a column: the source word above, its meaning below, joined by a rule. -->
												<ol class="vocab-list" data-text-section="words">
													{#each vocabulary as item, position (`${item.source}-${position}`)}
														<li class="vocab-entry">
															<span class="vocab-source">{item.source}</span>
															<span class="vocab-rule" aria-hidden="true"></span>
															<span class="vocab-target" dir="auto">{item.target}</span>
														</li>
													{/each}
												</ol>
											{/if}
										</NeoCollapse>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if showSegments && segments.length > 1}
			<div class="mt-3" in:slide={{ duration: 170 }} out:fade={{ duration: 140 }}>
				<NeoDivider style="margin: 0 0 0.625rem" /><!-- neo folds a multi-value `margin` prop into its height calc() -->
				<p class="eyebrow mb-2"><ListMusic class="size-3.5" /> Sentence playback</p>
				<div class="space-y-1">
					{#each segments as segment, position (position)}
						<div class="flex min-w-0 items-start gap-2 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]">
							<NeoButton text rounded class="card-icon-button segment-button mt-0.5 shrink-0" aria-label={`${segmentPlaying(position) ? 'Pause' : 'Play'} sentence ${position + 1}`} onclick={() => toggleSegment(position, segment)}>
								{#snippet icon()}{#if segmentPlaying(position)}<Pause size={14} />{:else}<Play size={14} />{/if}{/snippet}
							</NeoButton>
							<p class="min-w-0 font-serif text-sm leading-relaxed break-words">{segment}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if rerendering}
			<p class="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite"><Loader2 class="size-3.5 animate-spin" /> Preparing the new voice…</p>
		{/if}
	</div>
</NeoCard>

<style>
	/*
	 * Each take is an index card: warm card stock with the app's fine paper
	 * grain, nearly square corners, a red rule under the header, faint blue
	 * lines below it, and edges a little darker with age. The lines are on the
	 * card's body, so they scroll with the text of a long take.
	 */
	:global(.neo-card.attempt-card) {
		--index-card: #fffdf7;
		--index-hairline: rgb(120 100 70 / 0.14);
		--index-edge: rgb(139 100 50 / 0.07);
		--index-rule: rgb(110 140 185 / 0.17);
		--index-red-rule: rgb(214 88 80 / 0.5);
		--index-highlight: transparent;
		--neo-card-border-radius: var(--attempt-radius, 6px);
		border-radius: var(--attempt-radius, 6px);
		overflow: visible;
	}
	:global([data-theme='dark'] .neo-card.attempt-card) {
		/* Clearly above the dark paper, with a lit top edge where a shadow cannot show. */
		--index-card: #2b2721;
		--index-hairline: rgb(255 240 215 / 0.13);
		--index-edge: rgb(0 0 0 / 0.45);
		--index-rule: rgb(170 190 225 / 0.11);
		--index-red-rule: rgb(232 120 108 / 0.55);
		--index-highlight: rgb(255 245 225 / 0.1);
	}
	/* Out-ranks neo's own card surface and shadow rules. */
	:global(html[neo-theme-root] .neo-card.neo-card.attempt-card) {
		background-color: var(--index-card);
		background-image: var(--paper-key, none);
		background-size: cover;
		background-blend-mode: var(--key-blend);
		box-shadow:
			inset 0 1px 0 var(--index-highlight),
			inset 0 0 0 1px var(--index-hairline),
			inset 0 0 36px var(--index-edge);
	}
	:global(.neo-card.attempt-card .neo-card-content) { overflow: visible; }
	.index-card-header {
		border-bottom: 1.5px solid var(--index-red-rule);
	}
	.index-card-lines {
		--rule-gap: 1.75rem;
		background-image: repeating-linear-gradient(
			to bottom,
			transparent 0 calc(var(--rule-gap) - 1px),
			var(--index-rule) calc(var(--rule-gap) - 1px) var(--rule-gap)
		);
	}
	:global(.neo-card.attempt-card .neo-pill.take-pill) {
		height: 20px;
		padding: 0 8px;
		font-size: 10px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	:global(.neo-card.attempt-card .neo-button.card-icon-button) {
		width: 32px;
		height: 32px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	:global(.neo-card.attempt-card .neo-button.segment-button) { color: var(--brand); }
	:global(.neo-card.attempt-card .neo-pill.correct-pill) {
		height: 18px;
		gap: 3px;
		padding: 0 7px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	:global(.neo-card.attempt-card .neo-button.translate-trigger) {
		height: 32px;
		padding: 0 10px;
		gap: 6px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	:global(.neo-card.attempt-card .neo-button.translate-trigger:not(.on)) { color: var(--muted-foreground); }
	:global(.neo-card.attempt-card .neo-button.retry-button) { height: 28px; padding: 0 10px; font-size: 0.75rem; }
	/* Two pencil links side by side must read as two, not one phrase. */
	.view-toggle + .view-toggle {
		margin-left: 0.5rem;
	}
	/* "Hide changes" / "Show changes" and "Whole text" / "Fixes only": pencil toggles a fingertip can still hit. */
	@media (pointer: coarse) {
		.view-toggle {
			min-height: var(--touch-target);
		}
	}
	:global(.menu-check) { color: var(--primary); flex-shrink: 0; }
	/*
	 * The translation is a sticky note stuck on the card: pastel paper, a strip
	 * of washi tape, a folded corner and a slight tilt. Its header is a tool
	 * bar, the variant's name is the active ink tab, the translation is
	 * typewriter text, and each word pair is joined by red stitched thread.
	 */
	/* The explanation and its follow-up question: 15px (EXPLANATION_FONT_PX); ExplanationText scales each by the learner's size for it. */
	.explanation-size {
		font-size: 0.9375rem;
	}

	.card-translation {
		--note-paper: #fef3c7;
		--note-paper-shade: #f7e7ad;
		--note-ink: #1c1917;
		--note-muted: #6b6459;
		--note-label: #8a6a1f;
		--note-tag: #1c1917;
		--note-tag-ink: #fef3c7;
		--note-rule: rgb(80 65 35 / 0.22);
		--note-stitch: #b91c1c;
		--note-link: #1d4ed8;
		--note-tape: rgb(255 252 240 / 0.58);
		--note-tape-line: rgb(80 60 30 / 0.14);
		--note-shadow: rgb(110 85 20 / 0.3);
		position: relative;
		padding: 0.6rem 1rem 1rem 0.75rem;
		border-radius: 2px;
		background: linear-gradient(175deg, var(--note-paper) 58%, var(--note-paper-shade));
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.08),
			0 12px 24px -10px var(--note-shadow),
			inset -4px -4px 12px rgb(0 0 0 / 0.03);
		transform: rotate(-0.4deg);
	}
	:global([data-theme='dark']) .card-translation {
		--note-paper: #3a3322;
		--note-paper-shade: #312b1c;
		--note-ink: #f4ead2;
		--note-muted: #cbbd9c;
		--note-label: #d9b865;
		--note-tag: #e8dfc6;
		--note-tag-ink: #2a2414;
		--note-rule: rgb(217 184 101 / 0.22);
		--note-stitch: #e08a7a;
		--note-link: #9bc2ff;
		--note-tape: rgb(220 205 175 / 0.18);
		--note-tape-line: rgb(255 245 225 / 0.12);
		--note-shadow: rgb(0 0 0 / 0.55);
	}
	/* A strip of washi tape holding the note to the take. */
	.card-translation::before {
		content: '';
		position: absolute;
		top: -9px;
		left: 18px;
		z-index: 2;
		width: 64px;
		height: 18px;
		border: 1px dashed var(--note-tape-line);
		background-color: var(--note-tape);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
		transform: rotate(-2deg);
		pointer-events: none;
	}
	/* The folded bottom-right corner. */
	.card-translation::after {
		content: '';
		position: absolute;
		right: 0;
		bottom: 0;
		width: 22px;
		height: 22px;
		background: linear-gradient(135deg, var(--note-paper-shade) 50%, color-mix(in srgb, var(--note-shadow) 60%, transparent) 50%, transparent 72%);
		border-top-left-radius: 3px;
		box-shadow: -2px -2px 4px rgb(0 0 0 / 0.05);
		pointer-events: none;
	}
	.translation-mark {
		color: var(--note-label);
	}
	/* Leads the note's toolbar, clear of the variant control at the far right. */
	:global(.neo-card.attempt-card .neo-button.card-icon-button.note-close) {
		color: var(--note-label);
	}
	@media (pointer: coarse) {
		:global(.neo-card.attempt-card .neo-button.card-icon-button.note-close) {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
	.card-translation :global(.eyebrow) {
		color: var(--note-muted);
	}
	/* The note's first line: the translation label, the variant's tag and its toggle, then close. */
	.translation-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		min-height: 1.75rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px dashed color-mix(in srgb, var(--note-rule) 90%, transparent);
	}
	.translation-heading .translation-toggle {
		display: flex;
		align-items: center;
		/* The variant's control sits at the card's right edge, with the close beside it. */
		margin-inline-start: auto;
	}
	.translation-rows {
		margin: 0.25rem 0 0 0.5rem;
		padding: 0;
		list-style: none;
	}
	/* Each variant underlined across the note; the text runs the note's full width below its tag line. */
	.translation-row {
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--note-rule);
	}
	.translation-row:last-child {
		border-bottom: 0;
	}
	.translation-row-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.translation-row-head .translation-toggle {
		margin-inline-start: auto;
	}
	/* The active variant, like the dark tab in the sticky-note mockup. */
	.translation-label {
		padding: 0.125rem 0.45rem;
		border-radius: 3px;
		background: var(--note-tag);
		color: var(--note-tag-ink);
		box-shadow: 1px 1px 0 rgb(0 0 0 / 0.2);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		line-height: 1.4;
		text-transform: uppercase;
		white-space: nowrap;
		transform: rotate(-1deg);
	}
	.translation-toggle {
		display: flex;
		align-items: center;
		white-space: nowrap;
	}
	/* The variant's disclosure, handwritten on the note in wavy blue ink. */
	.card-translation .pencil-link {
		font-family: 'Caveat', cursive;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--note-link);
		text-decoration: underline wavy var(--note-link);
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}
	.vocab-span {
		min-width: 0;
	}
	.translation-body {
		margin-top: 0.3rem;
	}
	.translation-text {
		color: var(--note-ink);
		font-family: 'Courier Prime', var(--font-mono), monospace;
		font-size: calc(1.05rem * var(--text-scale-translation, 1));
		font-weight: 400;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.translation-text.word-for-word {
		color: var(--note-ink);
		font-style: normal;
	}
	/* Translation variants page one at a time; the pager lives in the note header. */
	.variant-controls {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.variant-count {
		color: var(--note-muted);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
	}
	:global(.neo-card.attempt-card .neo-button.variant-step) {
		width: 24px;
		height: 24px;
		padding: 0;
		justify-content: center;
		color: var(--note-link);
	}
	@media (pointer: coarse) {
		:global(.neo-card.attempt-card .neo-button.variant-step) {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
	.or-mark {
		margin-right: 0.25rem;
		color: var(--note-muted);
		font-style: italic;
	}
	.pencil-note {
		color: var(--note-muted);
		font-size: 0.8125rem;
	}
	/* Phones: tighten the header so the label, tag, toggle and close share one line. */
	@media (max-width: 640px) {
		.card-translation {
			transform: none;
		}
		.translation-rows {
			margin-left: 0;
		}
		.translation-heading {
			gap: 0.2rem;
		}
		/* The label still names the note; dropping the decorative mark leaves room for "Hide each word". */
		.translation-heading .translation-mark {
			display: none;
		}
		.translation-heading .eyebrow {
			letter-spacing: 0.1em;
		}
		.translation-heading .translation-label {
			padding-inline: 0.25rem;
			letter-spacing: 0.08em;
		}
		.translation-heading .pencil-link {
			font-size: 0.8rem;
		}
	}

	/*
	 * "Each word": each pair is its own column, the source word above its
	 * translation and a short rule between them. The pairs read left to right
	 * like the sentence they came from, which a vertical list could not show.
	 */
	.vocab-list {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: center;
		gap: 0.75rem 1.25rem;
		margin: 0.5rem 0 0;
		padding: 0.25rem 0.25rem 0;
		list-style: none;
		font-size: calc(0.875rem * var(--text-scale-words, 1));
	}
	.vocab-entry {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
	}
	.vocab-source {
		color: var(--note-ink);
		font-family: 'Courier Prime', var(--font-mono), monospace;
		font-size: 1.08em;
		font-weight: 700;
		line-height: 1.35;
		text-align: center;
		overflow-wrap: anywhere;
	}
	/* A clean connector joining the source word to its meaning: one thin line, fading at both ends. */
	.vocab-rule {
		flex: 0 0 auto;
		width: 1.5px;
		height: 1.15rem;
		background: linear-gradient(
			to bottom,
			transparent,
			color-mix(in srgb, var(--note-stitch) 78%, transparent) 18%,
			color-mix(in srgb, var(--note-stitch) 78%, transparent) 82%,
			transparent
		);
	}
	.vocab-target {
		color: var(--note-muted);
		font-size: 0.9em;
		font-style: italic;
		font-weight: 700;
		line-height: 1.35;
		text-align: center;
		overflow-wrap: anywhere;
	}
	@media (max-width: 640px) {
		.vocab-list {
			gap: 0.6rem 1rem;
			padding-inline: 0;
		}
	}
</style>
