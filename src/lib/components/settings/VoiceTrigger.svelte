<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';

	interface Props {
		/** Id of the trigger, so the Settings row's label focuses it. */
		id: string;
		/** The chosen voice's name, or a call to choose one. */
		label: string;
		/** Second line: size, accent, character, … */
		detail?: string;
		/** Whether what it opens is showing. */
		expanded: boolean;
		/** `dialog` for a pop-up picker; `panel` for the voice library beside the settings. */
		opens: 'dialog' | 'panel';
		/** Id of the element it opens, when that element is in the page. */
		controls?: string;
		onclick: () => void;
	}

	let { id, label, detail, expanded, opens, controls, onclick }: Props = $props();
</script>

<button
	type="button"
	{id}
	class="voice-trigger"
	aria-haspopup={opens === 'dialog' ? 'dialog' : undefined}
	aria-expanded={expanded}
	aria-controls={controls}
	{onclick}
>
	<span class="min-w-0 flex-1 text-left">
		<span class="block truncate text-sm font-medium">{label}</span>
		{#if detail}
			<span class="voice-trigger-detail">{detail}</span>
		{/if}
	</span>
	{#if opens === 'panel'}
		<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	{:else}
		<ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	{/if}
</button>

<style>
	.voice-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.5rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--control-line);
		border-radius: 14px;
		background: var(--control);
		color: inherit;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}
	.voice-trigger:hover {
		background: var(--control-hover);
	}
	.voice-trigger[aria-expanded='true'] {
		border-color: var(--primary);
	}
	.voice-trigger:focus-visible {
		outline: 2px solid var(--focus-ring, var(--primary));
		outline-offset: 2px;
	}
	.voice-trigger-detail {
		display: block;
		margin-top: 0.125rem;
		overflow: hidden;
		font-size: 0.75rem;
		line-height: 1.1rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		/* --muted-foreground is 4.49:1 on the control surface in light mode. */
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
</style>
