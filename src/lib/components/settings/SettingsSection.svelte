<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';

	interface Props {
		id: string;
		title: string;
		children: Snippet;
	}

	let { id, title, children }: Props = $props();
</script>

<section class="mb-9 scroll-mt-6" aria-labelledby={`${id}-title`}>
	<h2 id={`${id}-title`} class="mb-2.5 px-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
		{title}
	</h2>
	<Card.Root class="gap-0 rounded-[20px] py-2">
		<Card.Content class="px-5 sm:px-7">
			<!-- The group is the container the rows' responsive layout queries. -->
			<Field.Group class="gap-0">
				{@render children()}
			</Field.Group>
		</Card.Content>
	</Card.Root>
</section>

