<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	/**
	 * The floating meaning of the word under the pointer, the last tapped one,
	 * or a selected range. It lives on <body>: takes sit in a scrolling,
	 * 3D-transformed list, which would clip a label inside the card or misplace a
	 * fixed one. floating-ui keeps it beside its anchor, flips it near an edge,
	 * and follows the anchor while the list scrolls.
	 */
	import {
		autoUpdate,
		computePosition,
		flip,
		offset,
		shift,
		type ReferenceElement
	} from '@floating-ui/dom';

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
	}

	let { anchor, text, detail, isStatus = false, placement = 'top' }: Props = $props();

	/** Space between the word and the label, and between the label and the viewport edge. */
	const GAP_PX = 6;
	const EDGE_PADDING_PX = 8;

	let label = $state<HTMLElement | null>(null);
	let x = $state(0);
	let y = $state(0);

	function moveToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	$effect(() => {
		if (!anchor || !label) return;
		const reference = anchor;
		const floating = label;
		const side = placement;

		const place = () =>
			void computePosition(reference, floating, {
				strategy: 'fixed',
				placement: side,
				middleware: [offset(GAP_PX), flip(), shift({ padding: EDGE_PADDING_PX })]
			}).then((position) => {
				x = position.x;
				y = position.y;
			});

		return autoUpdate(reference, floating, place);
	});
</script>

{#if anchor && text}
	<span
		use:moveToBody
		bind:this={label}
		class="word-gloss"
		dir="auto"
		class:is-status={isStatus}
		role="tooltip"
		style:left={`${x}px`}
		style:top={`${y}px`}
	>
		{text}
		{#if detail}<span class="word-gloss-detail">{detail}</span>{/if}
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
