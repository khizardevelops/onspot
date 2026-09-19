<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Field from '$lib/components/ui/field';

	interface Props {
		label: string;
		/** Id of the control the label names. */
		for?: string;
		/** Secondary line under the label. */
		hint?: string;
		children: Snippet;
		/** Extra content under the whole row, e.g. a helper message for the control. */
		below?: Snippet;
	}

	let { label, for: htmlFor, hint, children, below }: Props = $props();
</script>

<!-- A shadcn Field in responsive orientation: stacked on narrow cards, label left / control right otherwise. -->
<div class="border-b py-3.5 last:border-b-0">
	<Field.Field
		orientation="responsive"
		class="gap-2 @md/field-group:gap-6 @md/field-group:has-[>[data-slot=field-content]]:items-center"
	>
		<Field.Content>
			{#if htmlFor}
				<Field.Label for={htmlFor}>{label}</Field.Label>
			{:else}
				<Field.Title>{label}</Field.Title>
			{/if}
			{#if hint}<Field.Description class="max-w-sm text-xs">{hint}</Field.Description>{/if}
		</Field.Content>
		<div class="flex shrink-0 items-center gap-2 @md/field-group:justify-end">
			{@render children()}
		</div>
	</Field.Field>
	{#if below}{@render below()}{/if}
</div>
