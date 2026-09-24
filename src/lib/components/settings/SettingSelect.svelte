<script lang="ts">
	import { quickSelect } from '$lib/neo';
	import { NeoSelect } from '@dvcol/neo-svelte/inputs';

	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		id: string;
		/** Accessible name of the select. */
		label: string;
		options: Option[];
		value: string;
		onchange: (value: string) => void;
		/** Extra width classes; the default fills a narrow row and is 18rem wide otherwise. */
		class?: string;
	}

	let { id, label, options, value, onchange, class: className = '@md/field-group:w-72' }: Props = $props();
</script>

<div class="setting-select w-full {className}">
	<NeoSelect
		{id}
		{options}
		bind:value={() => value, (next) => {
			if (typeof next === 'string' && next !== value) onchange(next);
		}}
		rounded
		width="100%"
		aria-label={label}
		containerProps={{ 'aria-label': label, 'aria-haspopup': 'listbox' }}
		{...quickSelect}
		listProps={{ ...quickSelect.listProps, 'aria-label': label }}
	/>
</div>

<style>
	.setting-select :global(.neo-input) {
		text-overflow: ellipsis;
	}
</style>
