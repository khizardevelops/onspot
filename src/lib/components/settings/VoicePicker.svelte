<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { NeoDialog } from '@dvcol/neo-svelte/floating/dialog';
	import { quickDialog } from '#lib/neo.js';
	import { NeoButton } from '@dvcol/neo-svelte/buttons';
	import { NeoInput } from '@dvcol/neo-svelte/inputs';
	import { closeOnBack } from '#lib/platform/backButton.svelte.js';
	import { Check, ChevronDown, X } from '@lucide/svelte';

	export interface VoiceOption {
		value: string;
		label: string;
		/** Second line: accent, character, download size, … */
		description?: string;
	}

	interface Props {
		/** Id of the trigger, so the Settings row's label focuses it. */
		id: string;
		/** Dialog title and accessible name, e.g. "ElevenLabs voice". */
		title: string;
		options: VoiceOption[];
		value: string;
		onchange: (value: string) => void;
		/** Rendered in the dialog footer, e.g. the section's preview button. */
		footer?: Snippet;
		/** Muted note under the footer, e.g. a refresh result. */
		note?: string;
	}

	let { id, title, options, value, onchange, footer, note }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let dialogRoot = $state<HTMLElement | null>(null);
	let listElement = $state<HTMLElement | null>(null);
	/**
	 * neo's dialog focuses its first control (the close button) after a 100ms
	 * debounce, so this lands after that and never steals focus back from a
	 * learner who has already moved on.
	 */
	function focusSearch(attempts = 3): void {
		if (!open) return;
		const field = dialogRoot?.querySelector<HTMLInputElement>('input#voice-picker-search');
		if (!field) return;
		const active = document.activeElement;
		const movedOn =
			active instanceof HTMLElement &&
			active !== field &&
			Boolean(dialogRoot?.contains(active)) &&
			!active.classList.contains('voice-dialog-close');
		if (movedOn) return;
		field.focus();
		if (document.activeElement === field || attempts <= 0) return;
		setTimeout(() => focusSearch(attempts - 1), 80);
	}

	const current = $derived(options.find((option) => option.value === value));
	const searchable = $derived(options.length > 6);
	const filtered = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter(
			(option) =>
				option.label.toLowerCase().includes(needle) ||
				option.description?.toLowerCase().includes(needle)
		);
	});

	closeOnBack(() => open, () => (open = false));

	async function show(): Promise<void> {
		query = '';
		open = true;
		await tick();
		// Only a fine pointer: focusing the field on a phone pops the keyboard
		// over a list the learner usually just wants to scan.
		if (searchable && matchMedia('(pointer: fine)').matches) {
			setTimeout(() => focusSearch(), 130);
		}
	}

	/** Arrow keys walk the options, so a long list is not a Tab marathon. */
	function onListKeydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
			return;
		}
		const items = [...(listElement?.querySelectorAll<HTMLButtonElement>('.voice-option') ?? [])];
		if (items.length === 0) return;
		const active = document.activeElement;
		const typing = active instanceof HTMLInputElement;
		// Home/End belong to the text field while someone is typing a search.
		if (typing && (event.key === 'Home' || event.key === 'End')) return;
		event.preventDefault();
		if (event.key === 'Home') return items[0].focus();
		if (event.key === 'End') return items.at(-1)?.focus();
		const index = items.indexOf(active as HTMLButtonElement);
		if (index === -1) return items[0].focus();
		const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
		items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
	}

	function choose(next: string): void {
		if (!next) return;
		onchange(next);
	}

	// Listen on the dialog node rather than a template handler: the keys belong to
	// the picker as a whole (search field included), not to one inner element.
	$effect(() => {
		if (!open || !dialogRoot) return;
		const node = dialogRoot;
		node.addEventListener('keydown', onListKeydown);
		return () => node.removeEventListener('keydown', onListKeydown);
	});
</script>

<button
	type="button"
	{id}
	class="voice-trigger"
	aria-haspopup="dialog"
	aria-expanded={open}
	onclick={() => void show()}
>
	<span class="min-w-0 flex-1 text-left">
		<span class="block truncate text-sm font-medium">{current?.label ?? 'Choose a voice'}</span>
		{#if current?.description}
			<span class="voice-trigger-detail">{current.description}</span>
		{/if}
	</span>
	<ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
</button>

<NeoDialog
	{...quickDialog}
	bind:open
	portal
	rounded
	filled
	elevation={3}
	width={{ max: 'min(31rem, calc(100vw - 2rem))' }}
	padding="0"
	aria-labelledby="voice-picker-title"
	aria-describedby="voice-picker-description"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={dialogRoot} class="voice-dialog" data-voice-picker>
		<header class="voice-dialog-header">
			<div class="min-w-0 flex-1">
				<h2 id="voice-picker-title" class="voice-dialog-title">{title}</h2>
				<p id="voice-picker-description" class="voice-dialog-description">
					Pick the voice spoken replies use. You can preview before you practise.
				</p>
			</div>
			<button
				type="button"
				class="voice-dialog-close"
				aria-label="Close voice picker"
				onclick={() => (open = false)}
			>
				<X class="size-4" aria-hidden="true" />
			</button>
		</header>

		{#if searchable}
			<div class="voice-dialog-search">
				<NeoInput
					id="voice-picker-search"
					rounded
					pressed
					elevation={-2}
					width="100%"
					placeholder="Search by name or accent"
					aria-label="Search voices"
					value={query}
					oninput={(event: Event) => (query = (event.target as HTMLInputElement).value)}
				/>
			</div>
		{/if}

		<div
			bind:this={listElement}
			class="voice-dialog-list"
			role="group"
			aria-labelledby="voice-picker-title"
		>
			{#each filtered as option (option.value)}
				{@const selected = option.value === value}
				<button
					type="button"
					class="voice-option"
					data-selected={selected}
					aria-pressed={selected}
					onclick={() => choose(option.value)}
				>
					<span class="min-w-0 flex-1 text-left">
						<span class="voice-option-label">
							{option.label}
							{#if selected}<span class="voice-option-selected">Selected</span>{/if}
						</span>
						{#if option.description}
							<span class="voice-option-detail">{option.description}</span>
						{/if}
					</span>
					{#if selected}
						<Check class="size-4 shrink-0 text-[var(--good)]" aria-hidden="true" />
					{/if}
				</button>
			{:else}
				<p class="voice-dialog-empty">
					No voice matches “{query.trim()}”. Clear the search to see every voice.
				</p>
			{/each}
		</div>

		<footer class="voice-dialog-footer">
			{#if note}
				<p class="voice-dialog-note">{note}</p>
			{/if}
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if footer}{@render footer()}{/if}
				<NeoButton rounded color="primary" onclick={() => (open = false)}>Done</NeoButton>
			</div>
		</footer>
	</div>
</NeoDialog>

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
	.voice-dialog {
		display: flex;
		flex-direction: column;
		max-height: min(38rem, calc(100dvh - 4rem));
		padding: 1.25rem 0 0;
	}
	.voice-dialog-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		flex: 0 0 auto;
		padding: 0 1.25rem 0.875rem;
	}
	.voice-dialog-title {
		margin: 0;
		font-family: var(--font-serif, inherit);
		font-size: 1.0625rem;
		line-height: 1.4;
		font-weight: 600;
	}
	.voice-dialog-description {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.voice-dialog-close {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 9px;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.voice-dialog-close:hover {
		color: var(--foreground);
		background: var(--control);
	}
	.voice-dialog-close:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.voice-dialog-search {
		flex: 0 0 auto;
		padding: 0 1.25rem 0.75rem;
	}
	.voice-dialog-list {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.375rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		min-height: 0;
		padding: 0.125rem 1.25rem 0.75rem;
	}
	.voice-option {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 12px;
		background: var(--surface-2);
		color: inherit;
		cursor: pointer;
		text-align: left;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}
	.voice-option:hover {
		background: var(--control);
	}
	.voice-option[data-selected='true'] {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 10%, var(--surface-2));
	}
	.voice-option:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.voice-option-label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.3;
	}
	.voice-option-selected {
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--good);
	}
	.voice-option-detail {
		display: block;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.35;
		/* Stronger than --muted-foreground: the 12px detail line must clear AA on
		   both the plain and the tinted selected row, where muted falls to ~3.9:1. */
		color: color-mix(in srgb, var(--foreground) 62%, var(--muted-foreground));
	}
	.voice-dialog-empty {
		padding: 1.5rem 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.voice-dialog-footer {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem 1.25rem 1.25rem;
		border-top: 1px solid var(--border);
	}
	.voice-dialog-note {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	@media (min-width: 640px) {
		.voice-dialog-note {
			text-align: right;
		}
	}
</style>
