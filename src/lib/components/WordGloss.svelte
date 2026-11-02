<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The floating meaning of the word under the pointer, the last tapped one,
	 * or a selected range. It lives on <body>: takes sit in a scrolling,
	 * 3D-transformed list, which would clip a label inside the card or misplace a
	 * fixed one. floating-ui keeps it beside its anchor, flips it near an edge,
	 * follows the anchor while the list scrolls, and hides while the anchor is
	 * scrolled out of sight (out of a partial view's window, say). It also hides
	 * while something is drawn over the anchor (a newer take dropped onto its
	 * card, a sheet), so the label never floats over unrelated text.
	 *
	 * A selection's label can also read its words aloud (`onSpeak`). That label
	 * takes the pointer, with a bridge over the gap to its words, so the pointer
	 * can travel from the words to the speaker without passing over anything
	 * that would replace it. A word's label lets the pointer through.
	 */
	import {
		autoUpdate,
		computePosition,
		flip,
		hide,
		offset,
		shift,
		type ReferenceElement
	} from '@floating-ui/dom';
	import { Volume2 } from '@lucide/svelte';

	interface Props {
		/** A word element, or a selection's box; nothing is shown without one. */
		anchor: ReferenceElement | null;
		/** What to show: the meaning, or a status such as "Translating…". */
		text: string;
		/** An optional second, quieter line. */
		detail?: string;
		/** Status text is styled quieter than a meaning. */
		isStatus?: boolean;
		/** Above a hovered word; below a selection, clear of the phone's selection menu. */
		placement?: 'top' | 'bottom';
		/** Reads the selected words aloud; without it there is no speaker button. */
		onSpeak?: () => void;
	}

	let { anchor, text, detail, isStatus = false, placement = 'top', onSpeak }: Props = $props();

	/** Space between the word and the label, and between the label and the viewport edge. */
	const GAP_PX = 6;
	const EDGE_PADDING_PX = 8;

	let label = $state<HTMLElement | null>(null);
	let x = $state(0);
	let y = $state(0);
	/** The anchor is scrolled out of every container that shows it, or something is drawn over it. */
	let anchorOutOfSight = $state(false);
	/** Where the label ended up: below or above its anchor (`flip` moves it where there is room). */
	let placedSide = $state<'top' | 'bottom'>('bottom');

	function moveToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	/**
	 * True when something else is drawn over the middle of the anchor's first
	 * line: a newer take dropped onto its card, a sheet, a dialog. floating-ui's
	 * `hide` only sees an anchor clipped by a scroller, and a buried card is
	 * not clipped, just covered. Hit testing passes through inert content, so
	 * the words of a card in the pile never count as showing.
	 */
	function isCovered(reference: ReferenceElement): boolean {
		const owner = reference instanceof Element ? reference : reference.contextElement;
		if (!owner) return false;

		const lines = Array.from(reference.getClientRects?.() ?? []).filter((box) => box.width > 0 && box.height > 0);
		const line = lines[0] ?? reference.getBoundingClientRect();
		const topmost = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
		return !topmost || !owner.contains(topmost);
	}

	$effect(() => {
		if (!anchor || !label) return;
		const reference = anchor;
		const floating = label;
		const side = placement;
		let nextFrame = 0;

		const place = () =>
			void computePosition(reference, floating, {
				strategy: 'fixed',
				placement: side,
				middleware: [offset(GAP_PX), flip(), shift({ padding: EDGE_PADDING_PX }), hide({ strategy: 'referenceHidden' })]
			}).then((position) => {
				x = position.x;
				y = position.y;
				anchorOutOfSight = (position.middlewareData.hide?.referenceHidden ?? false) || isCovered(reference);
				placedSide = position.placement.startsWith('top') ? 'top' : 'bottom';
			});

		// The takes' stack poses its cards in the frame after a scroll (see
		// AttemptStream). Placed only when the scroll arrives, the label would
		// trail its word by a frame and judge what covers it by the old poses,
		// so it is placed again in that frame, after the cards have moved.
		const placeNowAndInNextFrame = () => {
			place();
			cancelAnimationFrame(nextFrame);
			nextFrame = requestAnimationFrame(place);
		};

		const stopUpdating = autoUpdate(reference, floating, placeNowAndInNextFrame);
		return () => {
			stopUpdating();
			cancelAnimationFrame(nextFrame);
		};
	});
</script>

{#if anchor && text}
	<!-- Pressing a selection's label must not move the document's selection, or the selection (and this label) would go. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		use:moveToBody
		onmousedown={onSpeak ? (event) => event.preventDefault() : undefined}
		bind:this={label}
		class="word-gloss"
		class:holds-pointer={Boolean(onSpeak)}
		class:above={placedSide === 'top'}
		style:--gloss-gap={`${GAP_PX}px`}
		class:is-status={isStatus}
		class:out-of-sight={anchorOutOfSight}
		style:left={`${x}px`}
		style:top={`${y}px`}
	>
		<span class="word-gloss-text" dir="auto" role="tooltip">
			{text}
			{#if detail}<span class="word-gloss-detail">{detail}</span>{/if}
		</span>
		{#if onSpeak}
			<button type="button" class="word-gloss-speak" aria-label="Hear the selected words" title="Hear it" onclick={onSpeak}>
				<Volume2 size={13} strokeWidth={2} />
			</button>
		{/if}
	</span>
{/if}

<style>
	.word-gloss {
		position: fixed;
		z-index: 140;
		max-width: min(18rem, calc(100vw - 16px));
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		background: var(--foreground);
		color: var(--background);
		box-shadow: var(--shadow-sheet, 0 4px 14px rgb(0 0 0 / 0.18));
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.35;
		pointer-events: none;
		white-space: normal;
	}
	.word-gloss.out-of-sight {
		visibility: hidden;
	}
	/* A selection's label: the pointer stops on it, and on the gap between it and its words. */
	.word-gloss.holds-pointer {
		pointer-events: auto;
	}
	.word-gloss.holds-pointer::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: var(--gloss-gap);
	}
	.word-gloss.holds-pointer.above::before {
		top: 100%;
		bottom: auto;
	}
	/* As wide as the meaning plus the speaker, no wider. */
	.word-gloss:has(.word-gloss-speak) {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding-right: 0.25rem;
	}
	.word-gloss-speak {
		position: relative;
		display: grid;
		flex: none;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 0;
		border-radius: 0.25rem;
		background: transparent;
		color: inherit;
		opacity: 0.8;
	}
	.word-gloss-speak:hover {
		background: color-mix(in srgb, var(--background) 16%, transparent);
		opacity: 1;
	}
	.word-gloss-speak:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}
	/* Phones: the same small icon, with a target a finger can hit around it (36 px). */
	@media (hover: none) {
		.word-gloss-speak::after {
			content: '';
			position: absolute;
			inset: -0.5rem;
		}
	}
	.word-gloss-detail {
		display: block;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		font-weight: 400;
		opacity: 0.8;
	}
	.word-gloss.is-status {
		font-style: italic;
		font-weight: 400;
	}
</style>
