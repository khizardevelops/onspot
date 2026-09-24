<script lang="ts">
	import type { Snippet } from 'svelte';

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

<!-- Responsive row: stacked on narrow cards, label left / control right otherwise. -->
<div class="setting-row border-b py-3.5 last:border-b-0">
	<div class="flex flex-col gap-2 @md/field-group:flex-row @md/field-group:items-center @md/field-group:gap-6">
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			{#if htmlFor}
				<label for={htmlFor} class="text-sm leading-snug font-medium">{label}</label>
			{:else}
				<p class="text-sm leading-snug font-medium">{label}</p>
			{/if}
			{#if hint}<p class="max-w-sm text-xs leading-normal text-muted-foreground">{hint}</p>{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2 @md/field-group:justify-end">
			{@render children()}
		</div>
	</div>
	{#if below}{@render below()}{/if}
</div>

<style>
	.setting-row {
		border-color: var(--border);
	}
</style>
