<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import type { Snippet } from 'svelte';
	import PaperSegmentedControl from '#lib/components/PaperSegmentedControl.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import type { ProcessingTarget } from '#lib/stores/processing.js';

	interface Props {
		id: ProcessingTarget;
		title: string;
		hint: string;
		mode: 'local' | 'cloud';
		status: string;
		ready: boolean;
		open: boolean;
		onToggle: () => void;
		onModeChange: (value: string) => void;
		children: Snippet;
	}

	let {
		id,
		title,
		hint,
		mode,
		status,
		ready,
		open,
		onToggle,
		onModeChange,
		children
	}: Props = $props();

	/*
	 * A row's settings are built the first time it opens, then kept (so closing
	 * it can animate and it reopens at once). All three used to be built with
	 * the Settings page, closed, which made opening Settings slow.
	 */
	let hasOpened = $state(false);
	$effect.pre(() => {
		if (open) hasOpened = true;
	});
</script>

<div class="capability" {id}>
	<div class="capability-header">
		<button
			type="button"
			class="capability-summary"
			aria-expanded={open}
			aria-controls={`${id}-detail`}
			onclick={onToggle}
		>
			<span class="min-w-0 flex-1 text-left">
				<span class="flex flex-wrap items-center gap-2">
					<span class="text-sm font-medium">{title}</span>
					<span class="status-text" data-ready={ready}>{status}</span>
				</span>
				<span class="mt-0.5 block text-xs leading-normal text-muted-foreground">{hint}</span>
			</span>
		</button>

		<div class="capability-controls">
			<PaperSegmentedControl
				value={mode}
				options={[
					{ value: 'local', label: 'Local' },
					{ value: 'cloud', label: 'Cloud' }
				]}
				ariaLabel={`${title} processing`}
				size="sm"
				onValueChange={onModeChange}
			/>
			<button
				type="button"
				class="capability-chevron"
				aria-label={open ? `Hide ${title} settings` : `Show ${title} settings`}
				aria-expanded={open}
				aria-controls={`${id}-detail`}
				onclick={onToggle}
			>
				<ChevronDown class="size-4 transition-transform {open ? 'rotate-180' : ''}" />
			</button>
		</div>
	</div>

	<div id={`${id}-detail`} class="capability-detail" data-open={open} inert={!open}>
		<div class="capability-detail-inner">
			{#if hasOpened}{@render children()}{/if}
		</div>
	</div>
</div>

<style>
	.capability-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem 0;
	}
	.capability-summary {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.capability-summary:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
		border-radius: 8px;
	}
	.capability-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
	}
	.capability-controls :global(.segmented) {
		flex-shrink: 0;
	}
	.capability-chevron {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.capability-chevron:hover {
		color: var(--foreground);
	}
	.capability-chevron:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.status-text {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.status-text[data-ready='true'] {
		color: var(--good);
	}
	.capability-detail {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 160ms ease;
	}
	.capability-detail[data-open='true'] {
		grid-template-rows: 1fr;
	}
	/*
	 * The 0fr/1fr collapse needs `overflow: hidden`, which also cut off the
	 * raised neo controls' shadows and the inset panel's right corners at the
	 * content edge. The clip box reaches out by neo's large shadow margin and is
	 * padded back, so the content stays aligned with the row above while the
	 * shadows have room (the card's 20–28px side padding holds the extra 18px).
	 * The value is neo's default `--neo-shadow-margin-lg`; the variable itself
	 * is reset to 0 inside the settings card, so it cannot be read here.
	 */
	.capability-detail-inner {
		--shadow-room: 1.125rem;

		overflow: hidden;
		min-height: 0;
		margin-inline: calc(-1 * var(--shadow-room));
		padding-inline: var(--shadow-room);
	}
	@media (min-width: 640px) {
		.capability-header {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 1.5rem;
		}
		.capability-controls {
			width: auto;
			flex: 0 0 auto;
			justify-content: flex-start;
		}
		.capability-summary {
			width: auto;
			flex: 1 1 auto;
			align-items: center;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.capability-detail {
			transition: none;
		}
	}
</style>
