<script lang="ts">
	import { quickCollapse, quickTooltip } from '#lib/neo.js';
	import { fade, fly, slide } from 'svelte/transition';
	import type { AttemptView } from '#lib/stores/practice.js';
	import {
		ensureAttemptTranslations,
		playAttempt,
		playRecording,
		playSegment,
		setAttemptVoice
	} from '#lib/stores/practice.js';
	import { appSettings } from '#lib/stores/settings.js';
	import { getLanguage } from '#lib/languages/index.js';
	import { listLocalVoices } from '#lib/adapters/tts/service.js';
	import { splitSentences } from '#lib/utils/segments.js';
	import { fitFontSize } from '#lib/utils/fitText.js';
	import { layoutLength } from '#lib/utils/words.js';
	import { audioActivity, togglePlay } from '#lib/stores/audio.js';
	import Transcript from './Transcript.svelte';
	import AudioBar from './AudioBar.svelte';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoCard } from '@dvcol/neo-svelte/cards';
	import { NeoCollapse } from '@dvcol/neo-svelte/collapse';
	import { NeoDivider } from '@dvcol/neo-svelte/divider';
	import type { NeoMenuItem } from '@dvcol/neo-svelte/floating/menu';
	import PopMenu from '#lib/components/PopMenu.svelte';
	import { NeoTooltip } from '@dvcol/neo-svelte/floating/tooltips';
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
		Volume2
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
	let transcriptWidth = $state(0);
	const transcriptSize = $derived(
		// Japanese glyphs are about twice as wide as Latin ones.
		fitFontSize(layoutLength(attempt.transcript), transcriptWidth, TRANSCRIPT_FIT)
	);
	let showSegments = $state(false);
	let rerendering = $state(false);
	let generatingTranslations = $state(false);
	let translationError = $state<string | null>(null);
	let showIdiomaticVariants = $state(false);
	let showWordBreakdown = $state(false);
	let translationView = $state<TranslationView>(
		$appSettings.translationMode === 'all'
			? 'all'
			: $appSettings.translationMode === 'idiomatic'
				? 'idiomatic'
				: 'off'
	);

	const languageName = $derived(getLanguage($appSettings.targetLanguage)?.name ?? 'target language');
	const TRANSLATION_OPTIONS = $derived<{ id: TranslationView; label: string; detail: string }[]>([
		{ id: 'idiomatic', label: 'Idiomatic', detail: 'Natural English with the same meaning' },
		{ id: 'literal', label: 'Literal', detail: `English that follows the ${languageName} structure` },
		{ id: 'wordForWord', label: 'Word-for-word', detail: 'Each word in the original order' },
		{ id: 'all', label: 'Compare all three', detail: 'See the differences side by side' },
		{ id: 'off', label: 'Hide translation', detail: `Keep the focus on your ${languageName}` }
	]);

	const translations = $derived({
		idiomatic: attempt.translations?.idiomatic || attempt.translation,
		idiomaticVariants: attempt.translations?.idiomaticVariants ?? [],
		literal: attempt.translations?.literal || '',
		wordForWord: attempt.translations?.wordForWord || '',
		wordBreakdown: attempt.translations?.wordBreakdown ?? []
	});

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

	const segments = $derived(
		splitSentences(attempt.naturalSpeech || attempt.correctedText || attempt.transcript)
	);
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
						label: 'Read-back voice',
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
		if (attempt.translations?.version !== 2) return true;
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

	function attemptPlaying(): boolean {
		return Boolean(
			$audioActivity.playing &&
				$audioActivity.track?.attemptId === attempt.id &&
				$audioActivity.track?.kind === 'attempt'
		);
	}

	function toggleAttemptAudio(): void {
		if (attemptPlaying()) togglePlay();
		else void playAttempt(attempt.id);
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

{#snippet detailChip(kind: string)}
	{#if kind === 'idiomatic' && translations.idiomaticVariants.length > 0}
		<NeoButton
			rounded
			elevation={1}
			scale={false}
			class="inline-chip"
			aria-expanded={showIdiomaticVariants}
			onclick={() => (showIdiomaticVariants = !showIdiomaticVariants)}
		>
			{showIdiomaticVariants ? 'Hide' : `+${translations.idiomaticVariants.length}`} alternative{translations.idiomaticVariants.length === 1 ? '' : 's'}
			<ChevronDown class="size-3 transition-transform duration-300 {showIdiomaticVariants ? 'rotate-180' : ''}" />
		</NeoButton>
	{:else if kind === 'wordForWord'}
		<NeoButton
			rounded
			elevation={1}
			scale={false}
			class="inline-chip"
			aria-expanded={showWordBreakdown}
			onclick={() => void toggleWordBreakdown(!showWordBreakdown)}
		>
			Word breakdown
			<ChevronDown class="size-3 transition-transform duration-300 {showWordBreakdown ? 'rotate-180' : ''}" />
		</NeoButton>
	{/if}
{/snippet}

<NeoCard
	data-card-surface
	class="attempt-card relative w-full min-w-0 {active ? 'active-card' : ''}"
	spacing="0"
	width="100%"
	elevation={active ? 2 : 1}
	hover={active ? 0 : 1}
	rounded
	glass
	borderless
>
	<div class="flex items-center justify-between gap-2 px-4 pt-3 pb-0 sm:px-5 sm:pt-3.5">
		<div class="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
			<NeoPill size="small" rounded elevation={active ? -1 : 1} color={active ? 'primary' : undefined} class="take-pill">Take {index}</NeoPill>
			<span class="text-faint">·</span>
			<span>{attempt.durationSec.toFixed(0)} sec</span>
			<span class="text-faint">·</span>
			<span>{attempt.wordCount} words</span>
		</div>

		<div class="flex shrink-0 items-center gap-1">
			<NeoTooltip tooltip={attemptPlaying() ? 'Pause' : 'Play natural version'} {...quickTooltip}>
				<NeoButton
					text
					rounded
					class="card-icon-button play-button"
					aria-label={attemptPlaying() ? 'Pause natural version' : 'Play natural version'}
					onclick={toggleAttemptAudio}
				>
					{#snippet icon()}{#if attemptPlaying()}<Pause size={16} />{:else}<Volume2 size={16} />{/if}{/snippet}
				</NeoButton>
			</NeoTooltip>

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

	<div class="px-4 pt-2 pb-3.5 sm:px-5 sm:pb-4">
		<div
			bind:clientWidth={transcriptWidth}
			class="transcript-fit"
			style:font-size={`${transcriptSize}px`}
			style:line-height={TRANSCRIPT_FIT.lineHeight}
		>
			<Transcript
				text={attempt.transcript}
				corrections={attempt.corrections}
				activeCorrectionId={active ? activeCorrectionId : null}
				onSelect={(correctionId) => onSelectCorrection?.(attempt.id, correctionId)}
				class="block break-words font-serif [text-wrap:pretty]"
			/>
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
			<div class="mt-3 min-w-0" aria-live="polite" in:slide={{ duration: 170 }} out:fade={{ duration: 140 }}>
				<NeoDivider style="margin: 0 0 0.625rem" /><!-- neo folds a multi-value `margin` prop into its height calc() -->
				{#if generatingTranslations}
					<p class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin text-[var(--brand)]" /> Generating and saving translations…</p>
				{:else}
					<div class="grid gap-2">
						{#each visibleTranslations as translation (translation.label)}
							<div class="translation-surface min-w-0 rounded-xl px-3 py-2" in:fly={{ y: 5, duration: 150 }}>
								<!-- Secondary detail takes space that is already there: the label row, or the text's first line. -->
								{#if visibleTranslations.length > 1}
									<div class="flex min-h-5 items-center justify-between gap-2">
										<p class="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">{translation.label}</p>
										{@render detailChip(translation.kind)}
									</div>
								{/if}
								<p class="text-sm leading-relaxed break-words {visibleTranslations.length > 1 ? 'mt-0.5' : ''} {translation.italic ? 'text-muted-foreground italic' : ''}">
									{#if visibleTranslations.length === 1}<span class="float-right ml-2">{@render detailChip(translation.kind)}</span>{/if}{translation.value}
								</p>
							</div>
						{/each}
					</div>

					{#if (translationView === 'idiomatic' || translationView === 'all') && translations.idiomaticVariants.length > 0}
						<NeoCollapse transition={quickCollapse} bind:open={showIdiomaticVariants}>
								<div class="grid gap-2 pt-2 sm:grid-cols-2">
									{#each translations.idiomaticVariants as variant (variant)}
										<p class="translation-surface rounded-xl px-3 py-2 text-sm">{variant}</p>
									{/each}
								</div>
						</NeoCollapse>
					{/if}

					{#if translationView === 'wordForWord' || translationView === 'all'}
						<NeoCollapse transition={quickCollapse} open={showWordBreakdown}>
								{#if translations.wordBreakdown.length > 0}
									<dl class="translation-surface mt-2 grid grid-cols-[minmax(0,auto)_1fr] gap-x-3 gap-y-1.5 rounded-xl p-3 text-xs">
										{#each translations.wordBreakdown as item, position (`${item.source}-${position}`)}
											<dt class="font-medium break-words">{item.source}</dt><dd class="min-w-0 text-muted-foreground break-words">{item.target}</dd>
										{/each}
									</dl>
								{/if}
						</NeoCollapse>
					{/if}
				{/if}
			</div>
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
	/* The selected take: a glass neo card with a teal edge (it is the selected item). */
	/* One radius for the card, its shadow, its selection outline and its focus ring. */
	:global(.neo-card.attempt-card) {
		--neo-card-border-radius: var(--attempt-radius, 22px);
		border-radius: var(--attempt-radius, 22px);
		overflow: visible;
		transition: box-shadow 120ms ease;
	}
	:global(.neo-card.attempt-card .neo-card-content) { overflow: visible; }
	:global(.neo-card.attempt-card.active-card) {
		outline: 1.5px solid var(--brand);
		outline-offset: -1px;
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
	:global(.neo-card.attempt-card .neo-button.play-button:hover),
	:global(.neo-card.attempt-card .neo-button.segment-button) { color: var(--brand); }
	:global(.neo-card.attempt-card .neo-button.translate-trigger) {
		height: 32px;
		padding: 0 10px;
		gap: 6px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	:global(.neo-card.attempt-card .neo-button.translate-trigger:not(.on)) { color: var(--muted-foreground); }
	:global(.neo-card.attempt-card .neo-button.retry-button) { height: 28px; padding: 0 10px; font-size: 0.75rem; }
	:global(.menu-check) { color: var(--primary); flex-shrink: 0; }
	/*
	 * Translation surfaces are deliberately tinted with the brand colour. The
	 * neutral surface token is almost the page background, so a neutral box read
	 * as an accidental colour mismatch rather than a highlighted translation.
	 */
	.translation-surface {
		background: color-mix(in srgb, var(--brand) 8%, var(--card));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand) 20%, transparent);
	}
	/* A compact control chip for a translation's secondary detail. */
	:global(.neo-button.inline-chip) {
		gap: 3px;
		padding: 1px 8px;
		color: var(--on-control);
		font-size: 0.75rem;
		font-weight: 500;
		font-style: normal;
		line-height: 1.5;
		white-space: nowrap;
		border-radius: 999px;
	}
	@media (prefers-reduced-motion: reduce) { :global(.neo-card.attempt-card) { transition-duration: 1ms; } }
</style>
