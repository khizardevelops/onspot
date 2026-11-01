<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * One spoken track of an attempt card (what you said, the correct version,
	 * the explanation): a play button and a label above the text it reads.
	 *
	 * A track given a `peekHeight` folds: one button turns it through hidden,
	 * part (a window of a few lines the text scrolls in) and full. Part is
	 * offered only when the text is clearly taller than that, so a short text
	 * just opens and closes.
	 */
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { quickCollapse, quickTooltip } from '#lib/neo.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoTooltip } from '@dvcol/neo-svelte/floating/tooltips';
	import { ChevronDown, ChevronsDown, ChevronUp, Loader2, Pause, Volume2 } from '@lucide/svelte';

	/** How much of a folding track is on screen. */
	type Extent = 'hidden' | 'part' | 'full';

	interface Props {
		/** Visible label, e.g. "You said". */
		label: string;
		/** What the play button plays, for its accessible name, e.g. "what you said". */
		audioName: string;
		playing: boolean;
		loading: boolean;
		/**
		 * Why this track has no audio right now, or null when it has. The button
		 * stays clickable so a tap explains the reason instead of doing nothing.
		 */
		unavailableReason?: string | null;
		onToggle: () => void;
		/**
		 * Height in px of the partial view, a few lines of the track's text. A
		 * track without it does not fold.
		 */
		peekHeight?: number;
		/** How a folding track starts: partly open when its text is long enough, or fully open. */
		defaultExtent?: 'part' | 'full';
		/** Optional status next to the label, e.g. a "Correct" pill. */
		badge?: Snippet;
		/** Optional controls at the end of the label row, before the fold button. */
		actions?: Snippet;
		children: Snippet;
	}

	let {
		label,
		audioName,
		playing,
		loading,
		unavailableReason = null,
		onToggle,
		peekHeight,
		defaultExtent = 'full',
		badge,
		actions,
		children
	}: Props = $props();

	/**
	 * The partial view is offered only when the text is at least this much
	 * taller than it: scrolling a window for a line or two helps nobody.
	 */
	const PART_WORTH_RATIO = 1.4;

	/** Scroll positions this close to an edge count as at it (sub-pixel rounding, a last half line). */
	const SCROLL_EDGE_PX = 4;

	const bodyId = $props.id();
	const folds = $derived(peekHeight !== undefined);

	/** The learner's last choice; until they make one, the track starts at `defaultExtent`. */
	let chosenExtent = $state<Extent | null>(null);
	/** The text's natural height, last measured while it was on screen. */
	let contentHeight = $state(0);

	const canShowPart = $derived(folds && contentHeight > (peekHeight ?? 0) * PART_WORTH_RATIO);
	const extent = $derived.by((): Extent => {
		if (!folds) return 'full';

		const wanted = chosenExtent ?? defaultExtent;
		return wanted === 'part' && !canShowPart ? 'full' : wanted;
	});

	/** Hidden → part (when offered) → full → hidden. */
	const nextExtent = $derived.by((): Extent => {
		if (extent === 'hidden') return canShowPart ? 'part' : 'full';
		if (extent === 'part') return 'full';
		return 'hidden';
	});

	/** The fold button says what it does next; the text itself shows where it is now. */
	const FOLD_ACTIONS = {
		part: { icon: ChevronDown, tooltip: 'Show part', describe: (name: string) => `Show part of ${name}` },
		full: { icon: ChevronsDown, tooltip: 'Show all', describe: (name: string) => `Show all of ${name}` },
		hidden: { icon: ChevronUp, tooltip: 'Hide', describe: (name: string) => `Hide ${name}` }
	} as const;

	const foldAction = $derived.by(() => {
		const opensFully = extent === 'hidden' && nextExtent === 'full';
		if (opensFully) return { icon: ChevronDown, tooltip: 'Show', describe: (name: string) => `Show ${name}` };
		return FOLD_ACTIONS[nextExtent];
	});

	function fold(): void {
		chosenExtent = nextExtent;

		// A window opens at the top of the text.
		textAboveWindow = false;
		textBelowWindow = true;
	}

	/** Whether the partial view's window has text out of sight above or below it, for the fades at its edges. */
	let textAboveWindow = $state(false);
	let textBelowWindow = $state(true);

	function readWindowScroll(event: Event): void {
		const textWindow = event.currentTarget as HTMLElement;
		textAboveWindow = textWindow.scrollTop > SCROLL_EDGE_PX;
		textBelowWindow = textWindow.scrollTop + textWindow.clientHeight < textWindow.scrollHeight - SCROLL_EDGE_PX;
	}

	/** Keeps the natural height while the text is hidden (it is not rendered then). */
	function measureContent(height: number): void {
		if (height > 0) contentHeight = height;
	}

	const buttonLabel = $derived.by(() => {
		if (unavailableReason) return `Play ${audioName} (unavailable: ${unavailableReason})`;
		if (loading) return `Preparing ${audioName}`;
		return playing ? `Pause ${audioName}` : `Play ${audioName}`;
	});

	const tooltipText = $derived(unavailableReason ?? (playing ? 'Pause' : `Play ${audioName}`));
</script>

<div class="attempt-track min-w-0" data-extent={extent}>
	<div class="flex min-h-7 items-center gap-1.5">
		<NeoTooltip tooltip={tooltipText} {...quickTooltip}>
			<NeoButton
				text
				rounded
				class="track-play {unavailableReason ? 'unavailable' : ''}"
				aria-label={buttonLabel}
				aria-disabled={unavailableReason ? 'true' : undefined}
				aria-busy={loading}
				onclick={onToggle}
			>
				{#snippet icon()}
					{#if loading}<Loader2 size={15} class="animate-spin" />{:else if playing}<Pause size={15} />{:else}<Volume2 size={15} />{/if}
				{/snippet}
			</NeoButton>
		</NeoTooltip>
		<p class="eyebrow">{label}</p>
		{@render badge?.()}

		{#if actions || folds}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{@render actions?.()}
				{#if folds}
					<NeoTooltip tooltip={foldAction.tooltip} {...quickTooltip}>
						<NeoButton
							text
							rounded
							class="track-fold"
							aria-label={foldAction.describe(audioName)}
							aria-expanded={extent !== 'hidden'}
							aria-controls={bodyId}
							onclick={fold}
						>
							{#snippet icon()}<foldAction.icon size={16} />{/snippet}
						</NeoButton>
					</NeoTooltip>
				{/if}
			</div>
		{/if}
	</div>

	{#if extent !== 'hidden'}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			id={bodyId}
			class="track-body mt-0.5 min-w-0"
			class:part={extent === 'part'}
			class:text-above={textAboveWindow}
			class:text-below={textBelowWindow}
			style:--peek-height={peekHeight === undefined ? undefined : `${peekHeight}px`}
			onscroll={readWindowScroll}
			transition:slide={quickCollapse}
		>
			<div bind:offsetHeight={() => contentHeight, measureContent}>
				{@render children()}
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.neo-button.track-play) {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		color: var(--brand);
	}
	/* Unavailable audio is still explained on click, so it dims rather than disables. */
	:global(.neo-button.track-play.unavailable) { color: var(--muted-foreground); }

	:global(.neo-button.track-fold) {
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
		color: var(--muted-foreground);
	}
	/* A fingertip needs more than the 28px a pointer does. */
	@media (pointer: coarse) {
		:global(html[neo-theme-root] .neo-button.track-play),
		:global(html[neo-theme-root] .neo-button.track-fold) {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}

	/*
	 * Partly open: a window of a few lines the text scrolls in. Its edges fade
	 * where there is more text out of sight, as a page does under a fold, and
	 * stay sharp at the start and end of the text.
	 */
	.track-body.part {
		--fade-above: 0px;
		--fade-below: 0px;
		max-height: var(--peek-height);
		overflow-y: auto;
		/* No scrollbar: the fades already say there is more, and a bar only crowds the text. */
		scrollbar-width: none;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent,
			#000 var(--fade-above),
			#000 calc(100% - var(--fade-below)),
			transparent
		);
		mask-image: linear-gradient(
			to bottom,
			transparent,
			#000 var(--fade-above),
			#000 calc(100% - var(--fade-below)),
			transparent
		);
	}
	.track-body.part::-webkit-scrollbar {
		display: none;
	}
	.track-body.part.text-above {
		--fade-above: 1.5rem;
	}
	.track-body.part.text-below {
		--fade-below: 2.75rem;
	}
</style>
