<script lang="ts">
	import { quickSelect } from '$lib/neo';
	import { NeoSelect } from '@dvcol/neo-svelte/inputs';

	interface Option {
		value: string;
		label: string;
		/** Secondary line in the open list only; the closed field shows just the label. */
		description?: string;
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
	<!-- The id goes on the visible trigger, so the row's <label for> focuses and opens it;
	     neo's own id lands on a hidden, inert display input. -->
	<NeoSelect
		id={`${id}-value`}
		{options}
		bind:value={() => value, (next) => {
			if (typeof next === 'string' && next !== value) onchange(next);
		}}
		rounded
		width="100%"
		aria-label={label}
		containerProps={{ id, 'aria-label': label, 'aria-haspopup': 'listbox' }}
		{...quickSelect}
		listProps={{ ...quickSelect.listProps, 'aria-label': label }}
	/>
</div>

<style>
	.setting-select :global(.neo-input) {
		text-overflow: ellipsis;
	}
</style>
