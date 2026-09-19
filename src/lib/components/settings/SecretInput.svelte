<script lang="ts">
	import * as InputGroup from '$lib/components/ui/input-group';
	import { Eye, EyeOff } from '@lucide/svelte';

	interface Props {
		id: string;
		value: string;
		placeholder?: string;
		/** Accessible name of the reveal toggle's subject, e.g. "Groq API key". */
		label: string;
	}

	let { id, value = $bindable(), placeholder = 'Paste your key', label }: Props = $props();
	let revealed = $state(false);
</script>

<InputGroup.Root class="h-9 w-full bg-background @md/field-group:w-72">
	<InputGroup.Input
		{id}
		type={revealed ? 'text' : 'password'}
		class="font-mono text-[0.8125rem] tracking-wide placeholder:font-sans placeholder:tracking-normal"
		autocomplete="off"
		spellcheck={false}
		{placeholder}
		bind:value
	/>
	<InputGroup.Addon align="inline-end">
		<InputGroup.Button
			size="icon-xs"
			aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
			aria-pressed={revealed}
			aria-controls={id}
			onclick={() => (revealed = !revealed)}
		>
			{#if revealed}<EyeOff />{:else}<Eye />{/if}
		</InputGroup.Button>
	</InputGroup.Addon>
</InputGroup.Root>
