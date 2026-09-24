<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { NeoPassword, type NeoPasswordProps } from '@dvcol/neo-svelte/inputs';
	import { Eye, EyeOff } from '@lucide/svelte';

	interface Props {
		id: string;
		value: string;
		placeholder?: string;
		/** Accessible name of the reveal toggle's subject, e.g. "Groq API key". */
		label: string;
	}

	let { id, value = $bindable(), placeholder = 'Paste your key', label }: Props = $props();

	// neo-svelte 1.2.0 types the non-pin password as `NeoPasswordProps<false>`, which intersects
	// with `Record<string, never>` and rejects every prop; the component itself accepts them.
	const Password = NeoPassword as unknown as Component<
		Omit<NeoPasswordProps<true>, 'pin' | 'icon'> & { icon?: Snippet<[{ show: boolean }]> },
		object,
		'value'
	>;
</script>

<div class="secret-input w-full @md/field-group:w-72">
	<Password
		{id}
		bind:value
		{placeholder}
		autocomplete="off"
		spellcheck={false}
		rounded
		pressed
		elevation={-2}
		width="100%"
		buttonProps={{ 'aria-label': `Show ${label}`, title: `Show or hide ${label}`, 'aria-controls': id }}
	>
		{#snippet icon({ show })}
			{#if show}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
		{/snippet}
	</Password>
</div>

<style>
	.secret-input :global(input) {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		letter-spacing: 0.025em;
	}
	.secret-input :global(input::placeholder) {
		font-family: var(--font-sans);
		letter-spacing: normal;
	}
</style>
