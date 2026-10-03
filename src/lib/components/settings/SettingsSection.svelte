<script lang="ts">
	import type { Snippet } from 'svelte';
	import { NeoCard } from '@dvcol/neo-svelte/cards';

	interface Props {
		id: string;
		title: string;
		children: Snippet;
	}

	let { id, title, children }: Props = $props();
</script>

<section {id} class="mb-9 scroll-mt-6" aria-labelledby={`${id}-title`}>
	<h2 id={`${id}-title`} class="section-title mb-2.5 px-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
		{title}
	</h2>
	<NeoCard class="settings-card" rounded glass elevation={2} spacing="0.5rem 0" width="100%" style="--neo-card-margin: 0">
		<!-- The group is the container the rows' responsive layout queries. -->
		<div class="@container/field-group flex w-full flex-col px-5 sm:px-7">
			{@render children()}
		</div>
	</NeoCard>
</section>

<style>
	/* neo's theme styles bare headings (size, weight, margin) outside any layer; restore ours. */
	h2.section-title {
		margin-bottom: 0.625rem;
		font-size: 0.75rem;
		line-height: 1rem;
		font-weight: 600;
	}
	section :global(.neo-card.settings-card) {
		border-radius: 20px;
		background-color: var(--sheet-frost);
		border-color: var(--sheet-line);
	}
</style>
