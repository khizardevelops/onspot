<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts" module>
	/** One take on the timeline. */
	export interface TimelineEntry {
		id: string;
		/** The take's number, as its card shows it. */
		take: number;
		/** What the learner said. */
		text: string;
	}
</script>

<script lang="ts">
	/**
	 * A strip of aged paper taped beside the attempt stack: a mini-map of the
	 * session, newest take first (like the pile, and so the ink dot moves down as
	 * the learner scrolls down). Collapsed, it shows a pencil tick per take and a
	 * red ink dot that follows the stack as it scrolls. Hovered (or reached with the keyboard), it
	 * slides out and shows each take's number and what was said. Clicking a take
	 * brings its card to the top of the stack.
	 *
	 * Touch has no hover: the first tap opens the paper, a tap on a take jumps to
	 * it and closes it, and a tap anywhere else (or a swipe towards the edge it
	 * is taped to) closes it. On phones there is no strip at all: a button in
	 * the top bar opens the paper (`open` is bindable, and that button carries
	 * `data-timeline-toggle`).
	 */
	import { SwipeToDismiss } from '#lib/gestures/swipeToDismiss.js';

	interface Props {
		entries: TimelineEntry[];
		/** The stack's continuous position, in cards (see `cardStack.ts`). */
		position: number;
		/** Brings the card at this index to the top. */
		onJump: (index: number) => void;
		/** The paper is slid out (a tap, or a button elsewhere); hovering opens it without this. */
		open?: boolean;
	}

	let { entries, position, onJump, open = $bindable(false) }: Props = $props();

	/** Items have a fixed height, so the ink dot is placed by arithmetic, between ticks while scrolling. */
	const ITEM_HEIGHT_PX = 32;
	const ITEM_GAP_PX = 4;
	const ITEM_STEP_PX = ITEM_HEIGHT_PX + ITEM_GAP_PX;
	const PLAYHEAD_SIZE_PX = 8;
	/** The paper's top and bottom padding (see `.timeline-paper`). */
	const PAPER_PADDING_PX = 16;

	let paper = $state<HTMLElement | null>(null);
	let sheet = $state<HTMLElement | null>(null);
	/** What slides: the paper with its tape and shadow. */
	let lift = $state<HTMLElement | null>(null);
	/** The current tap opened the paper, so the click it ends with must not also jump. */
	let openingTap = false;

	/** Takes in the order they are listed: newest first. `index` is still the take's place in the stack. */
	const rows = $derived(entries.map((entry, index) => ({ entry, index })).reverse());

	/** The row a stack position falls on; fractional between two takes. */
	function rowOf(stackPosition: number): number {
		return entries.length - 1 - stackPosition;
	}

	const closestIndex = $derived(Math.round(position));
	const playheadOffset = $derived(rowOf(position) * ITEM_STEP_PX + ITEM_HEIGHT_PX / 2 - PLAYHEAD_SIZE_PX / 2);

	function paddedTakeNumber(take: number): string {
		return String(take).padStart(2, '0');
	}

	/** A tap on the closed strip only opens it. */
	function pressSheet(event: PointerEvent): void {
		openingTap = event.pointerType === 'touch' && !open;
		if (openingTap) open = true;
	}

	function chooseTake(index: number): void {
		if (openingTap) {
			openingTap = false;
			return;
		}
		open = false;
		onJump(index);
	}

	// A tap outside the opened paper, or Escape, closes it. The button that toggles it handles its own taps.
	$effect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			const target = event.target as Element;
			if (!sheet?.contains(target) && !target.closest?.('[data-timeline-toggle]')) open = false;
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') open = false;
		};
		window.addEventListener('pointerdown', closeOutside);
		window.addEventListener('keydown', closeOnEscape);
		return () => {
			window.removeEventListener('pointerdown', closeOutside);
			window.removeEventListener('keydown', closeOnEscape);
		};
	});

	// The opened paper swipes back to the right-hand edge it is taped to (touch screens).
	$effect(() => {
		if (!sheet) return;
		const edgeSwipe = new SwipeToDismiss({
			direction: 'right',
			surface: () => lift,
			enabled: () => open,
			onDismiss: () => (open = false)
		});
		return edgeSwipe.listen(sheet);
	});

	/*
	 * The paper's height and scroll offset, kept as they change (a resize
	 * observer and its scroll events). Reading them back from the element
	 * forced a layout of the whole page while Practice was still being built,
	 * and again on every take the stack passed.
	 */
	let paperContent = $state<DOMRectReadOnly | null>(null);
	/** The paper's inner height (padding included, as `clientHeight`); 0 while it is not displayed. */
	const paperHeight = $derived(paperContent && paperContent.height > 0 ? paperContent.height + 2 * PAPER_PADDING_PX : 0);
	let paperScrollTop = 0;

	/**
	 * A long session does not fit the paper; it scrolls so the current take
	 * stays in view. It runs again on opening: on phones the paper is not
	 * displayed until then, so it could not scroll before.
	 */
	$effect(() => {
		const row = rowOf(closestIndex);
		const opening = open;
		if (!paper || row < 0) return;
		// Not displayed (a phone's closed paper): there is nothing to scroll, and it opens at the top.
		if (paperHeight === 0) {
			paperScrollTop = 0;
			return;
		}

		const itemTop = PAPER_PADDING_PX + row * ITEM_STEP_PX;
		const itemBottom = itemTop + ITEM_HEIGHT_PX;
		const scrollTop = paperScrollTop;

		let target = scrollTop;
		if (itemTop - PAPER_PADDING_PX < scrollTop) target = itemTop - PAPER_PADDING_PX;
		else if (itemBottom + PAPER_PADDING_PX > scrollTop + paperHeight) target = itemBottom + PAPER_PADDING_PX - paperHeight;
		if (target === scrollTop) return;

		// Opening shows the paper already at the current take; following the stack is smooth.
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		paper.scrollTo({ top: target, behavior: reducedMotion || opening ? 'auto' : 'smooth' });
	});
</script>

<nav id="paper-timeline" class="paper-timeline" class:is-open={open} aria-label="Takes in this session">
	<!-- The sheet is the hover area and never moves; only the lift inside it slides out. -->
	<!-- svelte-ignore a11y_no_static_element_interactions (taps only open the paper; the takes are buttons) -->
	<div class="timeline-sheet" class:open bind:this={sheet} onpointerdown={pressSheet}>
		<div class="timeline-lift" bind:this={lift}>
			<div
				class="timeline-paper"
				bind:this={paper}
				bind:contentRect={paperContent}
				onscroll={() => (paperScrollTop = paper?.scrollTop ?? 0)}
			>
				<div class="timeline-track">
					<span class="ink-playhead" style:transform={`translateY(${playheadOffset}px)`} aria-hidden="true"></span>
					<ol class="timeline-items">
						{#each rows as { entry, index } (entry.id)}
							<li>
								<button
									type="button"
									class="timeline-item"
									class:active={index === closestIndex}
									aria-current={index === closestIndex ? 'step' : undefined}
									aria-label={`Take ${entry.take}: ${entry.text}`}
									onclick={() => chooseTake(index)}
								>
									<span class="tick-mark" aria-hidden="true"></span>
									<span class="timeline-number" aria-hidden="true">{paddedTakeNumber(entry.take)}</span>
									<span class="timeline-text" aria-hidden="true">{entry.text}</span>
								</button>
							</li>
						{/each}
					</ol>
				</div>
			</div>
		</div>
	</div>
</nav>

<style>
	.paper-timeline {
		/* Aged paper, pencil and red ink; the dark theme redefines them below. */
		--paper-aged: #f4ebd9;
		--paper-edge: #d4c5a9;
		--paper-stain: 139 90 43;
		--paper-highlight: rgb(255 255 255 / 0.4);
		--margin-line: rgb(192 57 43 / 0.4);
		--tick-color: #a0a090;
		--number-ink: #8c8273;
		--pencil-ink: #4a4a4a;
		--accent-red: #c0392b;
		--tape-color: rgb(230 220 190 / 0.65);
		--scroll-thumb: #c0b59e;
		--collapsed-width: 36px;
		--expanded-width: min(300px, calc(100cqw - 48px));
		/* Where the pencil ticks, the red margin line and the ink dot sit on the collapsed strip. */
		--tick-inset: 12px;
		--margin-line-at: 32px;
		--playhead-inset: 10px;
		--settle: cubic-bezier(0.16, 1, 0.3, 1);
		/* The paper slides out and back this fast; its ink and labels change a little quicker. */
		--slide-duration: 220ms;
		--ink-duration: 160ms;

		/* The middle 60% of the stage, against its right edge. */
		position: absolute;
		top: 20%;
		bottom: 20%;
		right: var(--timeline-margin, var(--page-gutter));
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		pointer-events: none;
		/* Clicking to jump must never start a text selection. */
		-webkit-user-select: none;
		user-select: none;
	}
	:global([data-theme='dark']) .paper-timeline {
		--paper-aged: #2b261f;
		--paper-edge: #4a3f30;
		--paper-stain: 10 6 2;
		--paper-highlight: rgb(255 240 215 / 0.06);
		--margin-line: rgb(224 103 90 / 0.35);
		--tick-color: #6d6656;
		--number-ink: #a39882;
		--pencil-ink: #d8cfbd;
		--accent-red: #e0675a;
		--tape-color: rgb(200 185 150 / 0.28);
		--scroll-thumb: #5a5040;
	}

	/*
	 * The hover area. It never transforms: if the element under the pointer
	 * slid away from it, the hover would end, the paper would slide back under
	 * the pointer and hover again, over and over.
	 */
	.timeline-sheet {
		display: flex;
		flex-direction: column;
		max-height: 100%;
		pointer-events: auto;
	}
	/* The lift carries the shadow and the slide: `clip-path` on the paper would cut off a box-shadow. */
	.timeline-lift {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		filter: drop-shadow(-15px 15px 20px rgb(0 0 0 / 0.18));
		transition:
			filter var(--slide-duration) var(--settle),
			transform var(--slide-duration) var(--settle);
	}
	/* Masking tape holding the paper to the edge of the screen. */
	.timeline-lift::before {
		content: '';
		position: absolute;
		top: 10px;
		right: 0;
		z-index: 2;
		width: 40px;
		height: 20px;
		background-color: var(--tape-color);
		box-shadow: 0 2px 4px rgb(0 0 0 / 0.1);
		transform: rotate(2deg) translateX(10px);
		pointer-events: none;
	}

	.timeline-paper {
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: var(--collapsed-width);
		padding: 16px 0;
		overflow: hidden;
		overscroll-behavior: contain;
		border: 1px solid var(--paper-edge);
		border-right: none;
		border-radius: 4px 0 0 4px;
		background-color: var(--paper-aged);
		background-image:
			radial-gradient(circle at 80% 20%, rgb(var(--paper-stain) / 0.08) 0%, transparent 40%),
			radial-gradient(circle at 20% 80%, rgb(var(--paper-stain) / 0.05) 0%, transparent 30%),
			linear-gradient(
				to right,
				transparent var(--margin-line-at),
				var(--margin-line) var(--margin-line-at),
				var(--margin-line) calc(var(--margin-line-at) + 2px),
				transparent calc(var(--margin-line-at) + 2px)
			),
			url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.06'/%3E%3C/svg%3E");
		box-shadow:
			inset 0 0 50px rgb(var(--paper-stain) / 0.12),
			inset 2px 0 0 var(--paper-highlight);
		/* The torn left edge. */
		clip-path: polygon(
			0% 2%, 100% 0%, 100% 100%, 0% 98%,
			1% 96%, 0% 94%, 2% 91%, 0% 88%,
			1% 85%, 0% 82%, 2% 79%, 0% 76%,
			1% 73%, 0% 70%, 2% 67%, 0% 64%,
			1% 61%, 0% 58%, 2% 55%, 0% 52%,
			1% 49%, 0% 46%, 2% 43%, 0% 40%,
			1% 37%, 0% 34%, 2% 31%, 0% 28%,
			1% 25%, 0% 22%, 2% 19%, 0% 16%,
			1% 13%, 0% 10%, 2% 7%, 0% 4%
		);
		transition: width var(--slide-duration) var(--settle);
	}
	.timeline-paper::-webkit-scrollbar { width: 6px; }
	.timeline-paper::-webkit-scrollbar-track { background: rgb(0 0 0 / 0.05); border-radius: 4px; }
	.timeline-paper::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border: 0; border-radius: 4px; }

	/*
	 * Hovered (only where a pointer can hover), reached with the keyboard, or
	 * opened by a tap: the paper lifts off the screen and slides out.
	 */
	@media (hover: hover) {
		.timeline-sheet:hover .timeline-lift {
			filter: drop-shadow(-25px 25px 30px rgb(0 0 0 / 0.3));
			transform: scale(1.03) translateX(-12px);
		}
		.timeline-sheet:hover .timeline-paper {
			width: var(--expanded-width);
			padding: 16px 12px 16px 0;
			overflow-x: hidden;
			overflow-y: auto;
			box-shadow:
				inset 0 0 60px rgb(var(--paper-stain) / 0.15),
				inset 2px 0 0 var(--paper-highlight);
		}
		.timeline-sheet:hover :is(.timeline-number, .timeline-text) {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.timeline-sheet:is(.open, :has(:focus-visible)) .timeline-lift {
		filter: drop-shadow(-25px 25px 30px rgb(0 0 0 / 0.3));
		transform: scale(1.03) translateX(-12px);
	}
	.timeline-sheet:is(.open, :has(:focus-visible)) .timeline-paper {
		width: var(--expanded-width);
		padding: 16px 12px 16px 0;
		overflow-x: hidden;
		overflow-y: auto;
		box-shadow:
			inset 0 0 60px rgb(var(--paper-stain) / 0.15),
			inset 2px 0 0 var(--paper-highlight);
	}

	.timeline-track {
		position: relative;
	}
	.timeline-items {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.timeline-item {
		display: flex;
		align-items: center;
		width: 100%;
		height: 32px;
		padding: 0 10px 0 0;
		border: 0;
		background: transparent;
		color: var(--pencil-ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--ink-duration);
	}
	.timeline-item:hover {
		background-color: rgb(var(--paper-stain) / 0.05);
	}
	/* The paper's torn edge would clip the app's outer focus ring. */
	.paper-timeline .timeline-item:focus-visible {
		outline-offset: -2px !important;
	}

	.tick-mark {
		flex-shrink: 0;
		width: 12px;
		height: 2px;
		margin-left: var(--tick-inset);
		border-radius: 2px;
		background-color: var(--tick-color);
		transition:
			width var(--ink-duration) ease,
			height var(--ink-duration) ease,
			background-color var(--ink-duration) ease;
	}
	.timeline-number {
		flex-shrink: 0;
		margin-left: 10px;
		color: var(--number-ink);
		font-family: 'Courier Prime', 'Courier New', Courier, monospace;
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		opacity: 0;
		transform: translateX(-5px);
		transition:
			opacity var(--ink-duration) ease,
			transform var(--ink-duration) ease,
			color var(--ink-duration) ease;
	}
	.timeline-text {
		min-width: 0;
		margin-left: 8px;
		overflow: hidden;
		color: var(--pencil-ink);
		font-family: 'Caveat', 'Comic Sans MS', cursive;
		font-size: 18px;
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0;
		transform: translateX(-10px);
		transition:
			opacity var(--ink-duration) ease,
			transform var(--ink-duration) ease,
			color var(--ink-duration) ease;
	}
	.timeline-sheet:is(.open, :has(:focus-visible)) :is(.timeline-number, .timeline-text) {
		opacity: 1;
		transform: translateX(0);
	}

	.timeline-item.active .tick-mark {
		width: 20px;
		height: 3px;
		background-color: var(--accent-red);
		box-shadow: 0 1px 2px rgb(192 57 43 / 0.3);
	}
	.timeline-item.active .timeline-number {
		color: var(--accent-red);
	}
	.timeline-item.active .timeline-text {
		color: var(--accent-red);
		font-weight: 700;
	}

	/* Red ink with a slight bleed, following the stack between the ticks. */
	.ink-playhead {
		position: absolute;
		top: 0;
		left: var(--playhead-inset);
		z-index: 1;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--accent-red);
		box-shadow: 0 1px 3px rgb(192 57 43 / 0.5);
		filter: blur(0.3px);
		pointer-events: none;
		transition: transform var(--ink-duration) var(--settle);
	}

	/*
	 * Phones: no strip beside the cards. The paper only appears when the bar's
	 * button opens it, rising from just above the bar at the bottom.
	 */
	@media (max-width: 640px) {
		.paper-timeline {
			top: 20%;
			bottom: 8px;
			align-items: flex-end;
		}
		.paper-timeline:not(.is-open) {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.timeline-lift,
		.timeline-paper,
		.tick-mark,
		.timeline-number,
		.timeline-text,
		.ink-playhead {
			transition-duration: 1ms;
		}
	}
</style>
