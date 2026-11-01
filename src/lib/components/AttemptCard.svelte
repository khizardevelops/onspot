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
		ensurePhraseMeaning,
		ensureWordGlosses,
		followUpQuestion,
		translationsCurrent as areTranslationsCurrent,
		wordGlossesFor
	} from '#lib/stores/practice.js';
	import { appSettings } from '#lib/stores/settings.js';
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

	/*
	 * A long section can be partly open: its first lines, enough to recognise
	 * the take without pushing the explanation screens down. Long takes start
	 * that way; the explanation (played aloud as the card arrives) starts open.
	 */
	const PEEK_TEXT_LINES = 6;
	const PEEK_EXPLANATION_LINES = 5;
	/** The explanation's type: 15px with relaxed leading (keep in step with its class below). */
	const EXPLANATION_FONT_PX = 15;
	const EXPLANATION_LINE_HEIGHT = 1.625;
	const textPeekHeight = $derived(Math.round(PEEK_TEXT_LINES * transcriptSize * transcriptFit.lineHeight));
	const explanationPeekHeight = Math.round(PEEK_EXPLANATION_LINES * EXPLANATION_FONT_PX * EXPLANATION_LINE_HEIGHT);

	let showSegments = $state(false);
	let rerendering = $state(false);
	let generatingTranslations = $state(false);
	let translationError = $state<string | null>(null);
	let showIdiomaticVariants = $state(false);
	let showWordBreakdown = $state(false);
	/** Off until the learner picks a translation: nothing is translated (or paid for) unasked. */
	let translationView = $state<TranslationView>('off');

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

	const question = $derived(followUpQuestion(attempt));

	/** Hover meanings and selection translations for one of this take's texts. */
	function meaningsOf(text: string) {
		return {
			glosses: wordGlossesFor(attempt, text, $appSettings.instructionLanguage),
			requestGlosses: (wordIndex: number) => ensureWordGlosses(attempt.id, text, wordIndex),
			requestPhrase: (start: number, end: number, phrase: string) => ensurePhraseMeaning(attempt.id, text, start, end, phrase)
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

	const translationLabel = $derived.by(() => {
		if (translationView === 'off') return 'Translate';
		if (translationView === 'all') return 'Compare';
		return TRANSLATION_OPTIONS.find((option) => option.id === translationView)?.label ?? 'Translate';
	});

	const visibleTranslations = $derived.by(() => {
		if (translationView === 'off') return [];
		if (translationView === 'all') {
			return [
				{ kind: 'idiomatic', label: 'Idiomatic', value: translations.idiomatic, italic: false },
				{ kind: 'literal', label: 'Literal', value: translations.literal, italic: false },
				{ kind: 'wordForWord', label: 'Word-for-word', value: translations.wordForWord, italic: true }
			].filter((entry) => entry.value);
		}
		const value = translations[translationView];
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
		else if (key === 'replay') void playRecording(attempt.id);
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
		if (generatingTranslations) return false;
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
		showIdiomaticVariants = false;
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
		if (trackLoading(kind)) return;

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
		if (segmentPlaying(position)) togglePlay();
		else void playSegment(attempt.id, text, position);
	}

	async function rerender(voice: string): Promise<void> {
		if (!voice || voice === selectedVoice || rerendering) return;
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

<!-- An index card: its paper, rules and edges are styled below; the pile adds tape and shadow. -->
<NeoCard
	data-card-surface
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
				peekHeight={textPeekHeight}
				defaultExtent="part"
			>
				{#snippet badge()}
					{#if saidCorrectly}
						<NeoPill size="small" rounded elevation={0} tinted color="success" class="correct-pill"><Check size={11} /> Correct</NeoPill>
					{/if}
				{/snippet}
				<div style:font-size={`${transcriptSize}px`} style:line-height={transcriptFit.lineHeight}>
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
					peekHeight={textPeekHeight}
				>
					{#snippet actions()}
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
					<!-- Same size as the transcript, so the two read as a pair. -->
					<div class="font-serif" style:font-size={`${transcriptSize}px`} style:line-height={transcriptFit.lineHeight}>
						{#if showsParts}
							<CorrectedPassages
								text={attempt.correctedText}
								passages={correctedParts.passages}
								changedWords={correctedParts.changedWords}
								removedBefore={correctedParts.removedBefore}
								{...meaningsOf(attempt.correctedText)}
							/>
						{:else}
							<Transcript
								text={attempt.correctedText}
								changedWords={correctedParts.changedWords}
								removedBefore={correctedParts.removedBefore}
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
						class="text-[0.9375rem] leading-relaxed [text-wrap:pretty]"
					/>
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
				<div class="flex min-h-7 items-center gap-1.5">
					<span class="translation-mark grid size-7 shrink-0 place-items-center" aria-hidden="true"><Languages size={14} /></span>
					<p class="eyebrow">Translation</p>
					<!-- Takes the note off again; the style menu above still brings it back. -->
					<NeoButton text rounded class="card-icon-button note-close" aria-label="Hide translation" title="Hide translation" onclick={() => void chooseTranslation('off')}>
						{#snippet icon()}<X size={15} />{/snippet}
					</NeoButton>
				</div>

				{#if generatingTranslations}
					<p class="pencil-note mt-1 flex items-center gap-2"><Loader2 class="size-3.5 animate-spin" /> Writing the translations…</p>
				{:else if visibleTranslations.length === 0}
					<!-- Shown but not (or no longer) translated, e.g. after the language of instruction changed: the learner decides. -->
					<p class="pencil-note mt-1">
						<button type="button" class="pencil-link" onclick={() => void requestTranslations(false)}>Translate into {instructionName}</button>
					</p>
				{:else}
					<!-- One ruled row per translation: tag, text, and that row's own toggle on its first line. -->
					<ul class="translation-rows">
						{#each visibleTranslations as translation (translation.kind)}
							<li class="translation-row">
								<span class="translation-label">{translation.label}</span>
								<div class="translation-body min-w-0">
									<p class="translation-text" class:word-for-word={translation.italic} dir="auto">{translation.value}</p>
									{#if translation.kind === 'idiomatic' && translations.idiomaticVariants.length > 0}
										<NeoCollapse transition={quickCollapse} bind:open={showIdiomaticVariants}>
											{#each translations.idiomaticVariants as variant (variant)}
												<p class="translation-text translation-alternative" dir="auto"><span class="or-mark">or</span> {variant}</p>
											{/each}
										</NeoCollapse>
									{/if}
								</div>
								<div class="translation-toggle">
									{#if translation.kind === 'idiomatic' && translations.idiomaticVariants.length > 0}
										<button type="button" class="pencil-link" aria-expanded={showIdiomaticVariants} onclick={() => (showIdiomaticVariants = !showIdiomaticVariants)}>
											{showIdiomaticVariants ? 'Hide' : `+${translations.idiomaticVariants.length}`} alternative{translations.idiomaticVariants.length === 1 ? '' : 's'}
										</button>
									{:else if translation.kind === 'wordForWord'}
										<button type="button" class="pencil-link" aria-expanded={showWordBreakdown} onclick={() => void toggleWordBreakdown(!showWordBreakdown)}>
											{showWordBreakdown ? 'Hide each word' : 'Each word'}
										</button>
									{/if}
								</div>
								{#if translation.kind === 'wordForWord'}
									<!-- The word list takes the note's full width, so more columns fit. -->
									<div class="vocab-span">
										<NeoCollapse transition={quickCollapse} open={showWordBreakdown}>
											{#if vocabulary.length > 0}
												<!-- A vocabulary list from a notebook: the word, a dotted leader, its meaning. -->
												<ol class="vocab-list">
													{#each vocabulary as item, position (`${item.source}-${position}`)}
														<li class="vocab-entry">
															<span class="vocab-source">{item.source}</span>
															<span class="vocab-leader" aria-hidden="true"></span>
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
		--neo-card-border-radius: var(--attempt-radius, 6px);
		border-radius: var(--attempt-radius, 6px);
		overflow: visible;
	}
	:global([data-theme='dark'] .neo-card.attempt-card) {
		--index-card: #24211c;
		--index-hairline: rgb(255 240 215 / 0.07);
		--index-edge: rgb(0 0 0 / 0.32);
		--index-rule: rgb(170 190 225 / 0.08);
		--index-red-rule: rgb(224 103 90 / 0.42);
	}
	/* Out-ranks neo's own card surface and shadow rules. */
	:global(html[neo-theme-root] .neo-card.neo-card.attempt-card) {
		background-color: var(--index-card);
		background-image: var(--paper-key, none);
		background-size: cover;
		background-blend-mode: var(--key-blend);
		box-shadow:
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
	/* "Whole text" / "Fixes only": a pencil toggle a fingertip can still hit. */
	@media (pointer: coarse) {
		.view-toggle {
			min-height: var(--touch-target);
		}
	}
	:global(.menu-check) { color: var(--primary); flex-shrink: 0; }
	/*
	 * The translation is a yellow sticky note stuck on the card, so it reads at
	 * once as something added to the take, not part of it: its own paper over
	 * the ruled lines, a soft lift at the bottom, a folded corner. Each
	 * variant's label sits in the note's margin (above the text on phones).
	 */
	.card-translation {
		--note-paper: #fff6bf;
		--note-paper-shade: #f8e9a0;
		--note-label: #8a6a1f;
		--note-tag: #a8791c;
		--note-tag-ink: #fffaf0;
		--note-rule: rgb(138 106 31 / 0.28);
		--note-shadow: rgb(110 85 20 / 0.28);
		position: relative;
		padding: 0.5rem 0.875rem 0.875rem 0.625rem;
		border-radius: 2px 2px 3px 3px;
		background: linear-gradient(175deg, var(--note-paper) 55%, var(--note-paper-shade));
		box-shadow:
			0 1px 1px rgb(0 0 0 / 0.05),
			0 8px 14px -8px var(--note-shadow);
	}
	:global([data-theme='dark']) .card-translation {
		--note-paper: #3a3322;
		--note-paper-shade: #312b1c;
		--note-label: #d9b865;
		--note-tag: #d9b865;
		--note-tag-ink: #2a2414;
		--note-rule: rgb(217 184 101 / 0.22);
		--note-shadow: rgb(0 0 0 / 0.55);
	}
	/* The folded bottom-right corner. */
	.card-translation::after {
		content: '';
		position: absolute;
		right: 0;
		bottom: 0;
		width: 18px;
		height: 18px;
		background: linear-gradient(135deg, var(--note-paper-shade) 50%, color-mix(in srgb, var(--note-shadow) 60%, transparent) 50%, transparent 72%);
		border-top-left-radius: 3px;
		pointer-events: none;
	}
	.translation-mark {
		color: var(--note-label);
	}
	/* At the note's right edge (the button's own styles reset margin utilities). */
	:global(.neo-card.attempt-card .neo-button.card-icon-button.note-close) {
		margin-inline-start: auto;
		color: var(--note-label);
	}
	@media (pointer: coarse) {
		:global(.neo-card.attempt-card .neo-button.card-icon-button.note-close) {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
	.card-translation :global(.eyebrow) {
		color: var(--note-label);
	}
	.translation-rows {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr) max-content;
		column-gap: 0.875rem;
		margin: 0.125rem 0 0 0.5rem;
		padding: 0;
		list-style: none;
	}
	/* Each row underlined across the note, so a toggle at its end reads as that row's. */
	.translation-row {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: start;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--note-rule);
	}
	.translation-row:last-child {
		border-bottom: 0;
	}
	/* A solid tag, like a label-maker strip, so each variant's name stands out. */
	.translation-label {
		justify-self: start;
		margin-top: 0.2rem;
		padding: 0.125rem 0.4rem;
		border-radius: 3px;
		background: var(--note-tag);
		color: var(--note-tag-ink);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		line-height: 1.4;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.translation-toggle {
		justify-self: end;
		padding-top: 0.1rem;
	}
	.vocab-span {
		grid-column: 1 / -1;
	}
	.translation-text {
		font-size: 0.9375rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.translation-text.word-for-word {
		color: var(--muted-foreground);
		font-style: italic;
	}
	.translation-alternative {
		color: var(--muted-foreground);
	}
	.or-mark {
		margin-right: 0.25rem;
		color: var(--faint);
		font-style: italic;
	}
	.pencil-note {
		color: var(--muted-foreground);
		font-size: 0.8125rem;
	}
	/* Phones: the tag and its toggle share the first line; the text goes below them. */
	@media (max-width: 640px) {
		.translation-rows {
			grid-template-columns: minmax(0, 1fr) max-content;
			margin-left: 0;
		}
		.translation-label {
			grid-column: 1;
			grid-row: 1;
			margin-top: 0;
		}
		.translation-toggle {
			grid-column: 2;
			grid-row: 1;
		}
		.translation-body {
			grid-column: 1 / -1;
			grid-row: 2;
			margin-top: 0.25rem;
		}
		.vocab-span {
			grid-row: 3;
		}
	}

	/* "Each word": a vocabulary list from a notebook, in up to four columns. */
	.vocab-list {
		columns: 4 8rem;
		column-gap: 1.75rem;
		margin: 0.375rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.8125rem;
	}
	.vocab-entry {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		line-height: 1.75;
		break-inside: avoid;
	}
	.vocab-source {
		font-family: var(--font-serif);
		font-weight: 600;
	}
	.vocab-leader {
		flex: 1;
		min-width: 0.75rem;
		border-bottom: 1px dotted color-mix(in srgb, var(--faint) 70%, transparent);
	}
	.vocab-target {
		color: var(--muted-foreground);
		text-align: right;
	}
</style>
